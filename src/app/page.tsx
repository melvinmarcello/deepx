import { getWatchlist } from "@/server/db/watchlist";
import { getLatestMarketSnapshots, getPriorAvgVolumeByCoin, type StoredSnapshot } from "@/server/db/marketSnapshots";
import { getLatestDigest } from "@/server/db/digest";
import { getLatestRiskScores } from "@/server/db/riskScore";
import { getRecentNews } from "@/server/db/news";
import { getFlagCountsByCoin, getRecentFlags } from "@/server/db/onchain";
import { getPriceHistoryDayCount } from "@/server/db/priceHistory";
import { getRecentPipelineRuns } from "@/server/db/pipelineRuns";
import type {
  DigestEntry,
  NewsEvent,
  OnchainFlag,
  PipelineRun,
  RiskScore,
  WatchlistCoin,
} from "@/server/types";
import { buildScreener, computeBreadth, selectTradeIdeas, SETUP_LABELS } from "@/server/analytics/screener";
import { Screener } from "./screener";
import {
  explorerTxUrl,
  formatPct,
  formatPp,
  formatPrice,
  formatRelativeTime,
  formatUsd,
  shortAddress,
} from "./format";

// Always hit the DB/cache fresh - this is a live operational dashboard,
// not a page we want statically cached at build time.
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function settle<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    console.error("[dashboard] data fetch failed:", err);
    return fallback;
  }
}

async function getDashboardData() {
  const watchlist = await settle(getWatchlist(), [] as WatchlistCoin[]);

  // Read-only: the dashboard renders from Postgres and never makes an
  // outbound CoinMarketCap/Etherscan call, so a page load can't fail (or
  // burn API credits) because an upstream provider is unreachable.
  const [stored, digest, riskScores, news, flags, flagCounts, priorVol, historyDays, runs] =
    await Promise.all([
      settle(getLatestMarketSnapshots(), [] as StoredSnapshot[]),
      settle(getLatestDigest(), [] as DigestEntry[]),
      settle(getLatestRiskScores(), [] as RiskScore[]),
      settle(getRecentNews(50), [] as NewsEvent[]),
      settle(getRecentFlags(10), [] as OnchainFlag[]),
      settle(getFlagCountsByCoin(24), new Map<string, number>()),
      settle(getPriorAvgVolumeByCoin(6), new Map<string, number>()),
      settle(getPriceHistoryDayCount(), 0),
      settle(getRecentPipelineRuns(5), [] as PipelineRun[]),
    ]);

  const snapshots = stored.map((s) => s.snapshot);
  const capturedAt = stored.reduce<string | null>(
    (latest, s) => (latest == null || s.capturedAt > latest ? s.capturedAt : latest),
    null
  );
  const snapshotAgeHours =
    capturedAt != null ? (Date.now() - new Date(capturedAt).getTime()) / 3_600_000 : null;

  return {
    watchlist,
    snapshots,
    capturedAt,
    snapshotAgeHours,
    digest,
    riskScores,
    news,
    flags,
    flagCounts,
    priorVol,
    historyDays,
    runs,
  };
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "success":
      return "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30";
    case "partial":
      return "bg-amber-500/10 text-amber-300 ring-amber-500/30";
    case "failed":
      return "bg-red-500/10 text-red-300 ring-red-500/30";
    default:
      return "bg-zinc-500/10 text-zinc-400 ring-zinc-500/30";
  }
}

function pctClass(value: number | null | undefined): string {
  if (value == null) return "text-zinc-500";
  return value >= 0 ? "text-emerald-400" : "text-red-400";
}

function Tile({
  label,
  value,
  sub,
  tone = "text-zinc-100",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

export default async function Home() {
  const {
    watchlist,
    snapshots,
    capturedAt,
    snapshotAgeHours,
    digest,
    riskScores,
    news,
    flags,
    flagCounts,
    priorVol,
    historyDays,
    runs,
  } = await getDashboardData();

  const rows = buildScreener({
    watchlist,
    snapshots,
    riskScores,
    news,
    flagCountByCoin: flagCounts,
    priceHistoryDays: historyDays,
    priorAvgVolumeByCoin: priorVol,
  });
  const breadth = computeBreadth(rows);
  const tradeIdeas = selectTradeIdeas(rows, { limit: 5, maxRisk: 55 });

  const symbolByCoin = new Map(watchlist.map((c) => [c.coinId, c.symbol]));
  const rationaleByCoin: Record<string, string> = {};
  for (const d of digest) {
    if (d.rationale) rationaleByCoin[d.coinId] = d.rationale;
  }

  const lastRun = runs[0];
  const ethRow = rows.find((r) => r.coinId === "ethereum");

  // Market regime: is this a broad risk-on tape, or a narrow one where only a
  // handful of names work? Determines whether momentum setups are worth taking.
  const breadthPct = breadth.total > 0 ? (breadth.advancers / breadth.total) * 100 : 0;
  const regime =
    breadth.total === 0
      ? { label: "No data", tone: "text-zinc-400", note: "Waiting on a successful market-data run." }
      : breadthPct >= 70
        ? {
            label: "Risk-on, broad",
            tone: "text-emerald-400",
            note: "Most of the watchlist is advancing — momentum setups have tailwind, but chase risk is high.",
          }
        : breadthPct >= 45
          ? {
              label: "Mixed / rotational",
              tone: "text-amber-400",
              note: "Gains are narrow — relative strength matters far more than absolute momentum here.",
            }
          : {
              label: "Risk-off",
              tone: "text-red-400",
              note: "Majority declining — long setups are low-probability; prefer cash or shorts.",
            };

  // Honest accounting of which inputs are actually usable right now.
  const scoredSentiment = news.filter((n) => n.sentimentScore != null && n.sentimentScore !== 0).length;
  const onchainCoverage = watchlist.filter(
    (c) => c.ethContractAddress || c.bscContractAddress
  ).length;
  const integrityIssues = [
    snapshots.length === 0
      ? "No stored market snapshots yet — run `npm run pipeline:run` (after `npm run db:migrate`) to populate the screener."
      : null,
    snapshotAgeHours != null && snapshotAgeHours > 6
      ? `Market data is ${snapshotAgeHours.toFixed(1)}h old — the last pipeline run may have failed to reach CoinMarketCap. Prices and momentum below are stale.`
      : null,
    historyDays < 5
      ? `Price history is ${historyDays} day(s) deep — realised volatility and drawdown metrics need ~14 days of runs before they mean anything.`
      : null,
    news.length > 0 && scoredSentiment === 0
      ? `Sentiment is unscored on all ${news.length} recent articles — the LLM classifier is falling back to neutral, so news contributes nothing to conviction.`
      : null,
    onchainCoverage < watchlist.length
      ? `On-chain flow is tracked for ${onchainCoverage} of ${watchlist.length} coins — the rest have no ETH/BSC contract, so whale flow is blind.`
      : null,
    snapshots.length < watchlist.length
      ? `Market data returned ${snapshots.length} of ${watchlist.length} coins.`
      : null,
  ].filter((x): x is string => x != null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50">DeepX</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Crypto market intelligence — {watchlist.length} coins tracked across momentum,
              liquidity, supply and flow
            </p>
          </div>
          <div className="text-right text-xs">
            <div className="flex items-center justify-end gap-2">
              <span className="text-zinc-500">Last pipeline run</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset ${statusBadgeClass(
                  lastRun?.status ?? "unknown"
                )}`}
              >
                {lastRun?.status ?? "never"}
              </span>
              <span className="text-zinc-400">
                {formatRelativeTime(lastRun?.finishedAt ?? lastRun?.startedAt)}
              </span>
            </div>
            <p className="mt-1.5 text-zinc-600">
              Market data as of{" "}
              <span className={snapshotAgeHours != null && snapshotAgeHours > 6 ? "text-amber-400" : ""}>
                {formatRelativeTime(capturedAt)}
              </span>{" "}
              · served from Postgres, no live API calls on render
            </p>
          </div>
        </header>

        <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Tile
            label="Regime"
            value={regime.label}
            sub={`${breadthPct.toFixed(0)}% of watchlist up`}
            tone={regime.tone}
          />
          <Tile
            label="BTC 24h"
            value={formatPct(breadth.benchmarkPct24h)}
            sub="Benchmark for alpha"
            tone={pctClass(breadth.benchmarkPct24h)}
          />
          <Tile
            label="ETH 24h"
            value={formatPct(ethRow?.pct24h ?? null)}
            sub="Majors bellwether"
            tone={pctClass(ethRow?.pct24h ?? null)}
          />
          <Tile
            label="Breadth"
            value={`${breadth.advancers} / ${breadth.total}`}
            sub={`${breadth.decliners} declining`}
          />
          <Tile
            label="Beating BTC"
            value={`${breadth.outperformingBenchmark} / ${breadth.total}`}
            sub="Positive 24h alpha"
          />
          <Tile
            label="Median 24h"
            value={formatPct(breadth.medianPct24h)}
            sub={`${formatUsd(breadth.totalVolume24hUsd)} total volume`}
            tone={pctClass(breadth.medianPct24h)}
          />
        </section>

        <p className="mt-3 text-xs text-zinc-500">
          <span className={`font-medium ${regime.tone}`}>{regime.label}:</span> {regime.note}
        </p>

        {integrityIssues.length > 0 && (
          <section className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              Data integrity — read before trading off this
            </h2>
            <ul className="mt-2 space-y-1 text-xs text-amber-200/70">
              {integrityIssues.map((issue) => (
                <li key={issue} className="flex gap-2">
                  <span className="text-amber-500/60">•</span>
                  {issue}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-5 rounded-lg border border-teal-500/20 bg-teal-500/[0.03]">
          <header className="flex flex-wrap items-end justify-between gap-2 border-b border-zinc-800 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold tracking-wide text-zinc-100">TRADE DESK</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Actionable setups only — conviction ≥ 50, liquid, risk ≤ 55, not extended
              </p>
            </div>
            <span className="text-[11px] text-zinc-600">{tradeIdeas.length} idea(s)</span>
          </header>
          {tradeIdeas.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">
              No actionable setups right now. Either the tape is mixed or every mover looks
              extended / thin — stay flat or wait for a pullback entry.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-900">
              {tradeIdeas.map((idea, i) => (
                <li
                  key={idea.coinId}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-5 text-xs text-zinc-600">{i + 1}</span>
                    <div>
                      <div className="font-semibold text-zinc-100">
                        {idea.symbol}{" "}
                        <span className="text-xs font-normal text-zinc-500">{idea.name}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-teal-300/80">
                        {SETUP_LABELS[idea.setup]}
                        {idea.volumeSpike != null && idea.volumeSpike >= 1.5
                          ? ` · vol ${idea.volumeSpike.toFixed(1)}× prior`
                          : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
                    <div className="text-right">
                      <div className="text-zinc-500">Price</div>
                      <div className="text-zinc-200">{formatPrice(idea.priceUsd)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-zinc-500">24h</div>
                      <div className={pctClass(idea.pct24h)}>{formatPct(idea.pct24h)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-zinc-500">α vs BTC</div>
                      <div className={pctClass(idea.relStrength24h)}>
                        {formatPp(idea.relStrength24h)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-zinc-500">Conviction</div>
                      <div className="font-medium text-emerald-300">
                        {idea.conviction?.toFixed(0) ?? "—"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-zinc-500">Capacity</div>
                      <div className="text-zinc-300">{formatUsd(idea.capacityUsd)}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-5">
          <Screener rows={rows} rationaleByCoin={rationaleByCoin} />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <section className="rounded-lg border border-zinc-800 bg-zinc-950">
            <header className="border-b border-zinc-800 px-4 py-3">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-100">NEWS FLOW</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                CoinDesk · Cointelegraph · The Block, attributed to the coin named earliest in the
                headline
              </p>
            </header>
            <ul className="divide-y divide-zinc-900">
              {news.slice(0, 10).map((n) => (
                <li key={n.id} className="px-4 py-2.5">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 w-12 shrink-0 text-xs font-semibold text-teal-300">
                      {symbolByCoin.get(n.coinId) ?? n.coinId}
                    </span>
                    <div className="min-w-0 flex-1">
                      <a
                        href={n.articleUrl ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-zinc-200 hover:text-teal-300"
                      >
                        {n.headline}
                      </a>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-600">
                        <span>{n.source}</span>
                        <span>·</span>
                        <span>{formatRelativeTime(n.publishedAt ?? n.ingestedAt)}</span>
                        {n.eventType && n.eventType !== "other" && (
                          <>
                            <span>·</span>
                            <span className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-400">
                              {String(n.eventType).replace(/_/g, " ")}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {news.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-zinc-500">
                  No news ingested yet — run the pipeline.
                </li>
              )}
            </ul>
          </section>

          <div className="space-y-5">
            <section className="rounded-lg border border-zinc-800 bg-zinc-950">
              <header className="border-b border-zinc-800 px-4 py-3">
                <h2 className="text-sm font-semibold tracking-wide text-zinc-100">
                  ON-CHAIN FLOW
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Large ERC-20/BEP-20 transfers — exchange inflows often precede selling
                </p>
              </header>
              <ul className="divide-y divide-zinc-900">
                {flags.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-teal-300">
                          {symbolByCoin.get(f.coinId) ?? f.coinId}
                        </span>
                        <span className="text-zinc-200">{formatUsd(f.usdValue)}</span>
                        {f.direction && (
                          <span
                            className={`rounded px-1 py-0.5 text-[10px] uppercase tracking-wide ${
                              f.direction === "to_exchange"
                                ? "bg-red-500/10 text-red-300"
                                : f.direction === "from_exchange"
                                  ? "bg-emerald-500/10 text-emerald-300"
                                  : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            {String(f.direction).replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-600">
                        {shortAddress(f.walletAddress)} · {formatRelativeTime(f.flaggedAt)}
                      </div>
                    </div>
                    <a
                      href={explorerTxUrl(f.chain, f.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-[11px] text-zinc-500 hover:text-teal-300"
                    >
                      tx ↗
                    </a>
                  </li>
                ))}
                {flags.length === 0 && (
                  <li className="px-4 py-8 text-center text-sm text-zinc-500">
                    No large transfers flagged in the tracked contracts.
                  </li>
                )}
              </ul>
            </section>

            <section className="rounded-lg border border-zinc-800 bg-zinc-950">
              <header className="border-b border-zinc-800 px-4 py-3">
                <h2 className="text-sm font-semibold tracking-wide text-zinc-100">
                  PIPELINE HEALTH
                </h2>
              </header>
              <ul className="divide-y divide-zinc-900 text-xs">
                {runs.map((run) => {
                  const errors = Array.isArray(run.errors) ? run.errors : [];
                  const durationMs =
                    run.finishedAt && run.startedAt
                      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
                      : null;
                  return (
                    <li key={run.id} className="flex items-center justify-between gap-3 px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ring-1 ring-inset ${statusBadgeClass(
                            run.status
                          )}`}
                        >
                          {run.status}
                        </span>
                        <span className="text-zinc-400">
                          {formatRelativeTime(run.finishedAt ?? run.startedAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-zinc-600">
                        {errors.length > 0 && (
                          <span className="text-amber-400">{errors.length} step error(s)</span>
                        )}
                        <span>{durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : "—"}</span>
                      </div>
                    </li>
                  );
                })}
                {runs.length === 0 && (
                  <li className="px-4 py-8 text-center text-sm text-zinc-500">No runs recorded.</li>
                )}
              </ul>
            </section>
          </div>
        </div>

        <footer className="mt-6 border-t border-zinc-800 pt-4 text-[11px] text-zinc-600">
          Conviction and risk are deterministic model outputs from public market data, not
          financial advice. Position capacity assumes you stay within 1% of a single day&apos;s
          traded volume.
        </footer>
      </div>
    </div>
  );
}
