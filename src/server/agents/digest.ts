import { chatCompleteJSON } from "../integrations/nineRouter";
import { getLatestRiskScoreMap } from "../db/riskScore";
import { getRecentNewsForCoin } from "../db/news";
import { getRecentFlagsForCoin } from "../db/onchain";
import { clearDigestForToday, upsertDigestEntry } from "../db/digest";
import type { MarketSnapshot, WatchlistCoin } from "../types";

interface CoinSignal {
  coin: WatchlistCoin;
  snapshot?: MarketSnapshot;
  riskScore: number | null;
  newsCount: number;
  avgSentiment: number | null;
  flagCount: number;
  compositeSignalScore: number;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

async function buildSignals(
  watchlist: WatchlistCoin[],
  snapshots: MarketSnapshot[]
): Promise<CoinSignal[]> {
  const snapshotByCoin = new Map(snapshots.map((s) => [s.coinId, s]));
  const riskByCoin = await getLatestRiskScoreMap();

  const signals: CoinSignal[] = [];
  for (const coin of watchlist) {
    const snapshot = snapshotByCoin.get(coin.coinId);
    const news = await getRecentNewsForCoin(coin.coinId, 24);
    const flags = await getRecentFlagsForCoin(coin.coinId, 24);
    const riskScore = riskByCoin.get(coin.coinId) ?? null;

    const sentiments = news
      .map((n) => n.sentimentScore)
      .filter((s): s is number => s != null);
    const avgSentiment = sentiments.length
      ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length
      : null;

    // Rule-based composite: momentum + news sentiment, discounted by risk.
    // Purely used for ranking - the LLM only supplies the human-readable
    // rationale below, never the score itself, so ranking stays
    // deterministic even if 9Router is unreachable.
    const momentum = clamp(50 + (snapshot?.priceChangePct24h ?? 0) * 2);
    const sentimentComponent = clamp(50 + (avgSentiment ?? 0) * 50);
    const riskPenalty = riskScore ?? 30;
    const compositeSignalScore = clamp(
      momentum * 0.5 + sentimentComponent * 0.3 - riskPenalty * 0.2 + 20
    );

    signals.push({
      coin,
      snapshot,
      riskScore,
      newsCount: news.length,
      avgSentiment,
      flagCount: flags.length,
      compositeSignalScore,
    });
  }
  return signals;
}

function fallbackRationale(s: CoinSignal): string {
  const chg = s.snapshot?.priceChangePct24h;
  const parts = [
    chg != null
      ? `${chg >= 0 ? "Up" : "Down"} ${Math.abs(chg).toFixed(1)}% in 24h`
      : "No recent price data",
    s.newsCount
      ? `${s.newsCount} news mention(s) (avg sentiment ${(s.avgSentiment ?? 0).toFixed(2)})`
      : null,
    s.flagCount ? `${s.flagCount} large on-chain transfer(s) flagged` : null,
    s.riskScore != null ? `risk score ${s.riskScore.toFixed(0)}/100` : null,
  ].filter(Boolean);
  return parts.join("; ") + ".";
}

async function generateRationales(top: CoinSignal[]): Promise<Map<string, string>> {
  const result = await chatCompleteJSON<Record<string, string>>(
    "orchestrator",
    [
      {
        role: "system",
        content:
          "You are a crypto market analyst. Given ranked coin signals, write a one-sentence " +
          "rationale per coin explaining why it stands out today. Reply with ONLY JSON mapping " +
          'coinId -> rationale string, e.g. {"bitcoin": "..."}.',
      },
      {
        role: "user",
        content: JSON.stringify(
          top.map((s) => ({
            coinId: s.coin.coinId,
            symbol: s.coin.symbol,
            priceChangePct24h: s.snapshot?.priceChangePct24h ?? null,
            volume24hUsd: s.snapshot?.volume24hUsd ?? null,
            riskScore: s.riskScore,
            newsCount: s.newsCount,
            avgSentiment: s.avgSentiment,
            onchainFlagCount: s.flagCount,
          }))
        ),
      },
    ],
    { timeoutMs: 25_000 }
  );

  const map = new Map<string, string>();
  if (result) {
    for (const [coinId, rationale] of Object.entries(result)) {
      if (typeof rationale === "string") map.set(coinId, rationale);
    }
  }
  return map;
}

const DIGEST_SIZE = 10;

/**
 * Daily Digest Agent (orchestrator) - ranks watchlist coins by a
 * deterministic, rule-based composite signal score (momentum + news
 * sentiment - risk), then asks the 9Router "orchestrator" combo for a
 * one-line human-readable rationale per top coin. If that LLM call fails
 * (router unreachable/times out), falls back to an auto-generated
 * templated rationale from the same signal data - the ranking itself
 * never depends on the LLM being reachable.
 */
export async function runDigestAgent(
  watchlist: WatchlistCoin[],
  snapshots: MarketSnapshot[]
): Promise<{ ranked: number }> {
  if (watchlist.length === 0) return { ranked: 0 };

  const signals = await buildSignals(watchlist, snapshots);
  signals.sort((a, b) => b.compositeSignalScore - a.compositeSignalScore);
  const top = signals.slice(0, DIGEST_SIZE);

  // Replace the whole day's ranking so coins that fell out of the top-N
  // do not linger with stale/duplicated ranks.
  await clearDigestForToday();

  const rationales = await generateRationales(top);

  for (const [i, s] of top.entries()) {
    await upsertDigestEntry({
      coinId: s.coin.coinId,
      rank: i + 1,
      rationale: rationales.get(s.coin.coinId) ?? fallbackRationale(s),
      riskScore: s.riskScore,
      compositeSignalScore: s.compositeSignalScore,
    });
  }

  return { ranked: top.length };
}
