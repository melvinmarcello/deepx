import { getWatchlist } from "../db/watchlist";
import { fetchMarketSnapshots } from "../agents/marketData";
import { upsertDailyPriceAgg } from "../db/priceHistory";
import { runNewsAgent } from "../agents/news";
import { runOnchainAgent } from "../agents/onchain";
import { runRiskScoreAgent } from "../agents/riskScore";
import { runDigestAgent } from "../agents/digest";
import { createPipelineRun, finishPipelineRun } from "../db/pipelineRuns";
import type { MarketSnapshot } from "../types";

interface StepError {
  step: string;
  message: string;
}

export interface PipelineRunResult {
  runId: number;
  status: "success" | "partial" | "failed";
  errors: StepError[];
}

async function runStep<T>(
  step: string,
  errors: StepError[],
  fn: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] step "${step}" failed:`, message);
    errors.push({ step, message });
    return undefined;
  }
}

/**
 * Runs one full pipeline cycle. Each stage is isolated in its own
 * try/catch (via `runStep`) so that, e.g., CoinMarketCap or Etherscan
 * being unreachable only degrades that one stage - the rest of the
 * pipeline (news, risk scoring off existing data, digest ranking) still
 * runs, and the run is recorded as "partial" rather than "failed".
 *
 * Order matters: market data must run before on-chain (needs prices for
 * USD conversion) and before risk-scoring/digest (need the snapshot for
 * momentum/turnover); news and on-chain should run before risk-scoring
 * and digest (need recent flags/sentiment).
 */
export async function runPipeline(): Promise<PipelineRunResult> {
  const runId = await createPipelineRun();
  const errors: StepError[] = [];

  const watchlist = (await runStep("watchlist", errors, () => getWatchlist())) ?? [];

  let snapshots: MarketSnapshot[] = [];
  if (watchlist.length > 0) {
    snapshots =
      (await runStep("market-data", errors, async () => {
        const result = await fetchMarketSnapshots(
          watchlist.map((c) => ({ coinId: c.coinId, symbol: c.symbol }))
        );
        await upsertDailyPriceAgg(result);
        return result;
      })) ?? [];
  }

  await runStep("news", errors, () => runNewsAgent(watchlist));
  await runStep("onchain", errors, () => runOnchainAgent(watchlist, snapshots));
  await runStep("risk-score", errors, () => runRiskScoreAgent(watchlist, snapshots));
  await runStep("digest", errors, () => runDigestAgent(watchlist, snapshots));

  const status: PipelineRunResult["status"] =
    errors.length === 0 ? "success" : errors.length >= 5 ? "failed" : "partial";

  await finishPipelineRun(runId, status, errors);
  return { runId, status, errors };
}
