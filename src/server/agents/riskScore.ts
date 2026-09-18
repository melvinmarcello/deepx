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
 *  - liquidityScore: derived from absolute 24h USD volume on a log scale -
 *    markets you cannot size into without moving the price score higher.
 *  - concentrationScore: sum of flagged on-chain transfer USD value in the
 *    last 24h as a fraction of 24h volume - heavy whale movement relative
 *    to total trading volume scores higher (riskier). Null (excluded from the
 *    composite) for coins whose contract we don't track.
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

    // Liquidity risk is about capacity to enter/exit, so it must be driven by
    // absolute traded volume. A turnover ratio cannot express this: BTC's
    // volume/market-cap is low precisely because its cap is enormous, yet it
    // is the most liquid asset in the market.
    let liquidityScore = 50; // unknown -> neutral
    const volume = snapshot?.volume24hUsd;
    if (volume != null && volume > 0) {
      // log10 scale: $10B/day -> 0 risk, $10M/day -> 75, $1M/day -> 100.
      liquidityScore = clamp((10 - Math.log10(volume)) * 25);
    }

    // Concentration is only *observable* for coins whose contract we track.
    // For everything else a score of 0 does not mean "no whale risk", it means
    // "we cannot see". Counting that as a real zero dragged every composite
    // down by ~30 points and made nothing ever look risky.
    const tracksContract = Boolean(coin.ethContractAddress || coin.bscContractAddress);
    let concentrationScore: number | null = null;
    if (tracksContract && snapshot?.volume24hUsd) {
      const flags = await getRecentFlagsForCoin(coin.coinId, 24);
      const flaggedVolume = flags.reduce((sum, f) => sum + (f.usdValue ?? 0), 0);
      concentrationScore = clamp((flaggedVolume / snapshot.volume24hUsd) * 100);
    }

    // Weights are renormalised over the sub-scores we could actually compute,
    // so an unobservable input dilutes confidence rather than the score.
    const parts: { score: number; weight: number }[] = [
      { score: volatilityScore, weight: 0.4 },
      { score: liquidityScore, weight: 0.3 },
      ...(concentrationScore != null
        ? [{ score: concentrationScore, weight: 0.3 }]
        : []),
    ];
    const weightSum = parts.reduce((sum, p) => sum + p.weight, 0);
    const compositeScore = clamp(
      parts.reduce((sum, p) => sum + p.score * p.weight, 0) / weightSum
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
