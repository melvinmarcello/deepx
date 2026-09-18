import type { MarketSnapshot, NewsEvent, RiskScore, WatchlistCoin } from "../types";

/**
 * Screener analytics
 * -------------------------------------------------------------------------
 * Turns raw market snapshots into decision-grade metrics for a discretionary
 * trader/analyst. Design rules followed here:
 *
 *  1. Never fabricate a number. If an input is missing, the metric is `null`
 *     and the UI shows "—" rather than silently defaulting to a neutral
 *     value (the previous digest scored missing news as sentiment 50/100,
 *     which quietly turned the score into "24h price change" alone).
 *  2. Every score exposes its components so the analyst can see *why* a coin
 *     ranks where it does, instead of trusting a black-box number.
 *  3. Liquidity is measured in absolute USD (capacity to enter/exit), not as
 *     a volume/market-cap ratio. Turnover is a separate *participation*
 *     signal, not a liquidity proxy.
 */

export type LiquidityTier = "deep" | "good" | "moderate" | "thin" | "illiquid";

export type TrendState =
  | "aligned_up"
  | "pullback_in_uptrend"
  | "bounce_in_downtrend"
  | "stalling"
  | "aligned_down"
  | "mixed";

export type Setup =
  | "trend_continuation"
  | "pullback_entry"
  | "extended_wait"
  | "counter_trend_bounce"
  | "downtrend_avoid"
  | "too_thin"
  | "no_edge";

export type Confidence = "high" | "medium" | "low";

export interface ScreenerRow {
  coinId: string;
  symbol: string;
  name: string;

  priceUsd: number | null;
  pct1h: number | null;
  pct24h: number | null;
  pct7d: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;

  /** 24h/7d performance minus the benchmark's (BTC) - i.e. alpha, not beta. */
  relStrength24h: number | null;
  relStrength7d: number | null;

  /** volume24h / marketCap - market participation, NOT liquidity. */
  turnover: number | null;
  liquidityTier: LiquidityTier | null;
  /** Position size that stays within 1% of one day's traded volume. */
  capacityUsd: number | null;

  /** circulating / total supply. Low float => future unlock/dilution overhang. */
  floatRatio: number | null;

  /** Share of the 7d move that happened in the last 24h (chasing risk). */
  moveConcentration: number | null;

  /**
   * Current 24h volume ÷ average of prior stored snapshots.
   * >1.5 with positive alpha is usually the earliest tradable tell.
   */
  volumeSpike: number | null;

  trendState: TrendState;
  setup: Setup;

  /** 0-100, higher = more attractive. Null when there is too little data. */
  conviction: number | null;
  convictionParts: { label: string; value: number; weight: number }[];

  riskScore: number | null;
  volatilityScore: number | null;

  newsCount: number;
  avgSentiment: number | null;
  flagCount: number;

  confidence: Confidence;
  /** Human-readable reasons the analyst should distrust/verify this row. */
  caveats: string[];
}

const BENCHMARK_COIN_ID = "bitcoin";

/** Minimum share of the conviction model's weight that must have real data. */
const MIN_WEIGHT_FOR_SCORE = 0.5;

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

/** Maps absolute 24h USD volume to a tradability tier. */
export function liquidityTierOf(volume24hUsd: number | null): LiquidityTier | null {
  if (volume24hUsd == null || !Number.isFinite(volume24hUsd)) return null;
  if (volume24hUsd >= 1_000_000_000) return "deep";
  if (volume24hUsd >= 250_000_000) return "good";
  if (volume24hUsd >= 50_000_000) return "moderate";
  if (volume24hUsd >= 10_000_000) return "thin";
  return "illiquid";
}

function liquidityPoints(tier: LiquidityTier | null): number | null {
  switch (tier) {
    case "deep":
      return 100;
    case "good":
      return 80;
    case "moderate":
      return 55;
    case "thin":
      return 25;
    case "illiquid":
      return 0;
    default:
      return null;
  }
}

function classifyTrend(
  pct1h: number | null,
  pct24h: number | null,
  pct7d: number | null
): TrendState {
  if (pct24h == null || pct7d == null) return "mixed";
  const shortUp = pct24h > 0;
  const mediumUp = pct7d > 0;
  const immediateUp = pct1h == null ? shortUp : pct1h > 0;

  if (mediumUp && shortUp && immediateUp) return "aligned_up";
  if (mediumUp && shortUp && !immediateUp) return "stalling";
  if (mediumUp && !shortUp) return "pullback_in_uptrend";
  if (!mediumUp && shortUp) return "bounce_in_downtrend";
  if (!mediumUp && !shortUp && !immediateUp) return "aligned_down";
  return "mixed";
}

/**
 * Turnover scored as participation quality: a healthy, tradable move has
 * real volume behind it, but extreme turnover (>60% of market cap in a day)
 * is usually a speculative blow-off rather than accumulation.
 */
function participationPoints(turnover: number | null): number | null {
  if (turnover == null) return null;
  if (turnover >= 0.6) return 35; // blow-off / rotation risk
  if (turnover >= 0.15) return 100; // strong, healthy participation
  if (turnover >= 0.05) return 80;
  if (turnover >= 0.02) return 60;
  if (turnover >= 0.005) return 35;
  return 15; // dormant
}

function floatPoints(floatRatio: number | null): number | null {
  if (floatRatio == null) return null;
  if (floatRatio >= 0.9) return 100;
  if (floatRatio >= 0.7) return 85;
  if (floatRatio >= 0.5) return 65;
  if (floatRatio >= 0.3) return 40;
  return 20; // heavy unlock overhang ahead
}

function trendPoints(state: TrendState): number {
  switch (state) {
    case "aligned_up":
      return 100;
    case "stalling":
      return 65;
    case "pullback_in_uptrend":
      return 75; // constructive: uptrend intact, better entry
    case "bounce_in_downtrend":
      return 35;
    case "aligned_down":
      return 10;
    default:
      return 45;
  }
}

/** Maps relative strength (percentage points vs BTC) onto 0-100. */
function relStrengthPoints(rs24h: number | null, rs7d: number | null): number | null {
  const parts: number[] = [];
  if (rs24h != null) parts.push(clamp(50 + rs24h * 3));
  if (rs7d != null) parts.push(clamp(50 + rs7d * 1.5));
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

function classifySetup(row: {
  liquidityTier: LiquidityTier | null;
  trendState: TrendState;
  relStrength24h: number | null;
  pct24h: number | null;
  moveConcentration: number | null;
  turnover: number | null;
}): Setup {
  if (row.liquidityTier === "illiquid" || row.liquidityTier === "thin") {
    return "too_thin";
  }

  const extended =
    row.moveConcentration != null &&
    row.moveConcentration >= 0.7 &&
    (row.pct24h ?? 0) >= 10;
  if (extended) return "extended_wait";

  if (row.trendState === "aligned_down") return "downtrend_avoid";
  if (row.trendState === "bounce_in_downtrend") return "counter_trend_bounce";
  if (row.trendState === "pullback_in_uptrend") return "pullback_entry";
  if (row.trendState === "aligned_up" && (row.relStrength24h ?? 0) > 0) {
    return "trend_continuation";
  }
  return "no_edge";
}

export interface BuildScreenerInput {
  watchlist: WatchlistCoin[];
  snapshots: MarketSnapshot[];
  riskScores: RiskScore[];
  news: NewsEvent[];
  flagCountByCoin: Map<string, number>;
  /** Days of daily_price_agg history available (global). */
  priceHistoryDays: number;
  /** Prior average 24h volumes by coinId (for spike detection). */
  priorAvgVolumeByCoin?: Map<string, number>;
}

export function buildScreener(input: BuildScreenerInput): ScreenerRow[] {
  const {
    watchlist,
    snapshots,
    riskScores,
    news,
    flagCountByCoin,
    priceHistoryDays,
    priorAvgVolumeByCoin = new Map(),
  } = input;

  const snapshotByCoin = new Map(snapshots.map((s) => [s.coinId, s]));
  const riskByCoin = new Map(riskScores.map((r) => [r.coinId, r]));
  const benchmark = snapshotByCoin.get(BENCHMARK_COIN_ID);

  const newsByCoin = new Map<string, NewsEvent[]>();
  for (const n of news) {
    newsByCoin.set(n.coinId, [...(newsByCoin.get(n.coinId) ?? []), n]);
  }

  const rows: ScreenerRow[] = [];

  for (const coin of watchlist) {
    const snap = snapshotByCoin.get(coin.coinId);
    const risk = riskByCoin.get(coin.coinId);
    const coinNews = newsByCoin.get(coin.coinId) ?? [];
    const caveats: string[] = [];

    const pct1h = snap?.priceChangePct1h ?? null;
    const pct24h = snap?.priceChangePct24h ?? null;
    const pct7d = snap?.priceChangePct7d ?? null;
    const volume24hUsd = snap?.volume24hUsd ?? null;
    const marketCapUsd = snap?.marketCapUsd ?? null;

    const isBenchmark = coin.coinId === BENCHMARK_COIN_ID;
    const relStrength24h =
      pct24h != null && benchmark?.priceChangePct24h != null && !isBenchmark
        ? pct24h - benchmark.priceChangePct24h
        : isBenchmark
          ? 0
          : null;
    const relStrength7d =
      pct7d != null && benchmark?.priceChangePct7d != null && !isBenchmark
        ? pct7d - benchmark.priceChangePct7d
        : isBenchmark
          ? 0
          : null;

    const turnover =
      volume24hUsd != null && marketCapUsd ? volume24hUsd / marketCapUsd : null;
    const liquidityTier = liquidityTierOf(volume24hUsd);
    const capacityUsd = volume24hUsd != null ? volume24hUsd * 0.01 : null;

    const floatRatio =
      snap?.circulatingSupply != null && snap?.totalSupply
        ? snap.circulatingSupply / snap.totalSupply
        : null;

    const moveConcentration =
      pct24h != null && pct7d != null && Math.abs(pct7d) > 0.5
        ? Math.min(Math.abs(pct24h) / Math.abs(pct7d), 3)
        : null;

    const priorVol = priorAvgVolumeByCoin.get(coin.coinId);
    const volumeSpike =
      volume24hUsd != null && priorVol != null && priorVol > 0
        ? volume24hUsd / priorVol
        : null;

    const trendState = classifyTrend(pct1h, pct24h, pct7d);

    const sentiments = coinNews
      .map((n) => n.sentimentScore)
      .filter((s): s is number => s != null && s !== 0);
    const avgSentiment = sentiments.length
      ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length
      : null;

    // --- Conviction: only count components we actually have data for, then
    // renormalise by the available weight. A coin with no news is not
    // "neutral", it simply has one fewer input.
    const components: { label: string; points: number | null; weight: number }[] = [
      { label: "Rel. strength vs BTC", points: relStrengthPoints(relStrength24h, relStrength7d), weight: 0.35 },
      { label: "Trend alignment", points: pct24h != null && pct7d != null ? trendPoints(trendState) : null, weight: 0.25 },
      { label: "Participation", points: participationPoints(turnover), weight: 0.15 },
      { label: "Liquidity capacity", points: liquidityPoints(liquidityTier), weight: 0.15 },
      { label: "Float quality", points: floatPoints(floatRatio), weight: 0.1 },
    ];

    const available = components.filter((c) => c.points != null);
    const totalWeight = available.reduce((sum, c) => sum + c.weight, 0);
    // Renormalising a single component by its own weight would just echo that
    // component - a coin with nothing but a liquidity reading would score 100
    // and look like the best idea on the board. Below half the model's weight
    // we report no score at all rather than a confident-looking one.
    let conviction =
      totalWeight >= MIN_WEIGHT_FOR_SCORE
        ? available.reduce((sum, c) => sum + (c.points as number) * c.weight, 0) / totalWeight
        : null;

    // Penalty: buying after the move has already happened.
    if (conviction != null && moveConcentration != null && moveConcentration >= 0.7 && (pct24h ?? 0) >= 10) {
      conviction = clamp(conviction - 15);
    }
    // Penalty: confirmed negative news flow.
    if (conviction != null && avgSentiment != null && avgSentiment < -0.2) {
      conviction = clamp(conviction - 10);
    }

    // Bonus: volume expanding with the move (confirmation, not just price).
    if (conviction != null && volumeSpike != null && volumeSpike >= 1.5 && (pct24h ?? 0) > 0) {
      conviction = clamp(conviction + 8);
    }

    const setup = classifySetup({
      liquidityTier,
      trendState,
      relStrength24h,
      pct24h,
      moveConcentration,
      turnover,
    });

    // --- Honest confidence reporting
    if (!snap) caveats.push("No market snapshot - CoinMarketCap fetch missed this coin.");
    if (priceHistoryDays < 5) {
      caveats.push(
        `Only ${priceHistoryDays} day(s) of stored price history - realised volatility is not yet meaningful.`
      );
    }
    if (floatRatio == null) caveats.push("No total-supply data, so unlock overhang is unknown.");
    if (coinNews.length === 0) caveats.push("No news matched this coin in the window.");
    else if (avgSentiment == null) caveats.push("News found but sentiment unscored (LLM fallback).");
    if (!coin.ethContractAddress && !coin.bscContractAddress) {
      caveats.push("No ETH/BSC contract tracked - on-chain whale flow is blind for this coin.");
    }

    if (totalWeight < MIN_WEIGHT_FOR_SCORE) {
      caveats.push(
        `Only ${Math.round(totalWeight * 100)}% of the conviction model had data - no score reported.`
      );
    }

    const confidence: Confidence =
      !snap || totalWeight < MIN_WEIGHT_FOR_SCORE
        ? "low"
        : priceHistoryDays >= 5 && avgSentiment != null
          ? "high"
          : "medium";

    rows.push({
      coinId: coin.coinId,
      symbol: coin.symbol,
      name: coin.name,
      priceUsd: snap?.priceUsd ?? null,
      pct1h,
      pct24h,
      pct7d,
      volume24hUsd,
      marketCapUsd,
      relStrength24h,
      relStrength7d,
      turnover,
      liquidityTier,
      capacityUsd,
      floatRatio,
      moveConcentration,
      volumeSpike,
      trendState,
      setup,
      conviction: conviction != null ? Math.round(conviction * 10) / 10 : null,
      convictionParts: available.map((c) => ({
        label: c.label,
        value: Math.round(c.points as number),
        weight: Math.round((c.weight / totalWeight) * 100),
      })),
      riskScore: risk?.compositeScore ?? null,
      volatilityScore: risk?.volatilityScore ?? null,
      newsCount: coinNews.length,
      avgSentiment,
      flagCount: flagCountByCoin.get(coin.coinId) ?? 0,
      confidence,
      caveats,
    });
  }

  return rows.sort((a, b) => (b.conviction ?? -1) - (a.conviction ?? -1));
}

export interface MarketBreadth {
  advancers: number;
  decliners: number;
  total: number;
  medianPct24h: number | null;
  totalVolume24hUsd: number;
  benchmarkPct24h: number | null;
  /** Share of coins outperforming BTC over 24h. */
  outperformingBenchmark: number;
}

export function computeBreadth(rows: ScreenerRow[]): MarketBreadth {
  const withData = rows.filter((r) => r.pct24h != null);
  const changes = withData.map((r) => r.pct24h as number).sort((a, b) => a - b);
  const median =
    changes.length === 0
      ? null
      : changes.length % 2 === 1
        ? changes[(changes.length - 1) / 2]
        : (changes[changes.length / 2 - 1] + changes[changes.length / 2]) / 2;

  return {
    advancers: withData.filter((r) => (r.pct24h as number) > 0).length,
    decliners: withData.filter((r) => (r.pct24h as number) <= 0).length,
    total: withData.length,
    medianPct24h: median,
    totalVolume24hUsd: rows.reduce((sum, r) => sum + (r.volume24hUsd ?? 0), 0),
    benchmarkPct24h: rows.find((r) => r.coinId === BENCHMARK_COIN_ID)?.pct24h ?? null,
    outperformingBenchmark: withData.filter((r) => (r.relStrength24h ?? 0) > 0).length,
  };
}

export const SETUP_LABELS: Record<Setup, string> = {
  trend_continuation: "Trend continuation",
  pullback_entry: "Pullback entry",
  extended_wait: "Extended - wait",
  counter_trend_bounce: "Counter-trend bounce",
  downtrend_avoid: "Downtrend - avoid",
  too_thin: "Too thin to trade",
  no_edge: "No edge",
};

export const TREND_LABELS: Record<TrendState, string> = {
  aligned_up: "1h/24h/7d up",
  stalling: "Up but stalling",
  pullback_in_uptrend: "Pullback in uptrend",
  bounce_in_downtrend: "Bounce in downtrend",
  aligned_down: "All timeframes down",
  mixed: "Mixed",
};

export const LIQUIDITY_LABELS: Record<LiquidityTier, string> = {
  deep: "Deep",
  good: "Good",
  moderate: "Moderate",
  thin: "Thin",
  illiquid: "Illiquid",
};

const ACTIONABLE_SETUPS: Setup[] = ["trend_continuation", "pullback_entry"];

/**
 * Desk picks: actionable setups only, liquid enough to trade, not chasing
 * an already-extended move, sorted by conviction then alpha.
 */
export function selectTradeIdeas(
  rows: ScreenerRow[],
  opts: { limit?: number; maxRisk?: number } = {}
): ScreenerRow[] {
  const limit = opts.limit ?? 5;
  const maxRisk = opts.maxRisk ?? 55;

  return rows
    .filter((r) => {
      if (!ACTIONABLE_SETUPS.includes(r.setup)) return false;
      if (r.conviction == null || r.conviction < 50) return false;
      if (r.liquidityTier === "thin" || r.liquidityTier === "illiquid") return false;
      if (r.riskScore != null && r.riskScore > maxRisk) return false;
      if (r.setup === "extended_wait") return false;
      return true;
    })
    .sort((a, b) => {
      const c = (b.conviction ?? 0) - (a.conviction ?? 0);
      if (c !== 0) return c;
      return (b.relStrength24h ?? 0) - (a.relStrength24h ?? 0);
    })
    .slice(0, limit);
}
