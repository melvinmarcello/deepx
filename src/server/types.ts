/** Shared types used by both the pipeline (agents) and the dashboard (API routes). */

export interface MarketSnapshot {
  coinId: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  priceChangePct1h: number | null;
  priceChangePct24h: number | null;
  priceChangePct7d: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  ath: number | null;
  athChangePercentage: number | null;
  lastUpdated: string | null; // ISO timestamp from CoinGecko
  /** true if served from Redis rather than a fresh CoinGecko call */
  fromCache: boolean;
}

export type NewsSource = "coindesk" | "cointelegraph" | "theblock";

export type NewsEventType =
  | "listing"
  | "hack"
  | "regulation"
  | "partnership"
  | "funding"
  | "product_launch"
  | "macro"
  | "other";

export interface NewsEvent {
  id: number;
  coinId: string;
  headline: string;
  source: NewsSource | string;
  articleUrl: string | null;
  eventType: NewsEventType | string | null;
  sentimentScore: number | null; // -1..1
  publishedAt: string | null;
  ingestedAt: string;
}

export type OnchainDirection =
  | "to_exchange"
  | "from_exchange"
  | "wallet_to_wallet";

export interface OnchainFlag {
  id: number;
  coinId: string;
  chain: "ethereum" | "bsc";
  walletAddress: string;
  txHash: string;
  usdValue: number | null;
  direction: OnchainDirection | string | null;
  flaggedAt: string;
}

export interface RiskScore {
  id: number;
  coinId: string;
  volatilityScore: number | null;
  liquidityScore: number | null;
  concentrationScore: number | null;
  compositeScore: number | null; // 0-100
  computedAt: string;
}

export interface DigestEntry {
  id: number;
  coinId: string;
  rank: number | null;
  rationale: string | null;
  riskScore: number | null;
  compositeSignalScore: number | null;
  digestDate: string; // YYYY-MM-DD
}

export interface DailyPricePoint {
  coinId: string;
  date: string; // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface PipelineRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: "success" | "partial" | "failed" | "running";
  errors: unknown;
}

export interface WatchlistCoin {
  coinId: string;
  symbol: string;
  name: string;
  ethContractAddress: string | null;
  bscContractAddress: string | null;
  active: boolean;
  addedAt: string;
}
