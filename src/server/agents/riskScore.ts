import { getRecentDailyCloses } from "../db/priceHistory";
import { getRecentFlagsForCoin } from "../db/onchain";
import { insertRiskScore } from "../db/riskScore";
import type { MarketSnapshot, WatchlistCoin } from "../types";

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Risk Scoring Agent - computes three 0-100 *risk* sub-scores per coin
 * (higher = riskier) purely from data the other agents have already
 * collected, plus a weighted composite. Makes no external API calls, so
 * it always runs regardless of CoinMarketCap/Etherscan connectivity - it
 * just scores whatever is already in Postgres/the latest snapshot batch.
 *
 *  - volatilityScore: stddev of daily % price changes over the last 14
 *    days of `daily_price_agg`, scaled. Falls back to |24h % change| *2
 *    when there isn't enough history yet (first days after a coin is added).
 *  - liquidityScore: derived from the 24h volume/market-cap turnover ratio
 *    - thin markets relative to their size score higher (riskier).
 *  - concentrationScore: sum of flagged on-chain transfer USD value in the
 *    last 24h as a fraction of 24h volume - heavy whale movement relative
 *    to total trading volume scores higher (riskier).
 */
export async function runRiskScoreAgent(
  watchlist: WatchlistCoin[],
  snapshots: MarketSnapshot[]
): Promise<{ scored: number }> {
  const snapshotByCoin = new Map(snapshots.map((s) => [s.coinId, s]));
  let scored = 0;

  for (const coin of watchlist) {
    const snapshot = snapshotByCoin.get(coin.coinId);

    const closes = await getRecentDailyCloses(coin.coinId, 14);
    const numericCloses = closes
      .map((c) => c.close)
      .filter((c): c is number => c != null)
      .reverse(); // oldest -> newest

    let volatilityScore: number;
    if (numericCloses.length >= 3) {
      const pctChanges: number[] = [];
      for (let i = 1; i < numericCloses.length; i++) {
        const prev = numericCloses[i - 1];
        if (prev) pctChanges.push(((numericCloses[i] - prev) / prev) * 100);
      }
      // ~25% daily stddev -> saturates at 100
      volatilityScore = clamp(stddev(pctChanges) * 4);
    } else {
      volatilityScore = clamp(Math.abs(snapshot?.priceChangePct24h ?? 0) * 2);
    }

    let liquidityScore = 50; // unknown -> neutral
    if (snapshot?.volume24hUsd != null && snapshot.marketCapUsd) {
      const turnover = snapshot.volume24hUsd / snapshot.marketCapUsd;
      // Healthy majors trade roughly 5-20% of market cap/day; well under
      // ~1% is thin/illiquid.
      liquidityScore = clamp(100 - turnover * 500);
    }

    const flags = await getRecentFlagsForCoin(coin.coinId, 24);
    const flaggedVolume = flags.reduce((sum, f) => sum + (f.usdValue ?? 0), 0);
    const concentrationScore = snapshot?.volume24hUsd
      ? clamp((flaggedVolume / snapshot.volume24hUsd) * 100)
      : 0;

    const compositeScore = clamp(
      volatilityScore * 0.4 + liquidityScore * 0.3 + concentrationScore * 0.3
    );

    await insertRiskScore({
      coinId: coin.coinId,
      volatilityScore,
      liquidityScore,
      concentrationScore,
      compositeScore,
    });
    scored++;
  }

  return { scored };
}
