import { getEnv } from "../config/env";
import { getCachedPrice, setCachedPrice } from "../cache/redis";
import {
  fetchBinanceDailyCloses,
  fetchBinanceTickers,
  pctChangeFromCloses,
} from "../integrations/binance";
import type { MarketSnapshot } from "../types";

/**
 * Market Data Agent
 * -------------------------------------------------------------------------
 * Input:  tracked coins (internal coinId + ticker symbol from the watchlist).
 * Output: one normalized MarketSnapshot per coin, in the same order as
 *         the input (missing/unresolvable symbols are omitted, with a
 *         console.warn - callers should not assume 1:1 array length).
 *
 * Cache: checks Redis `price:{coin_id}` first; anything stale/missing is
 * fetched from CoinMarketCap in a single batched request and the cache is
 * repopulated. Redis is never the source of truth - a cache failure just
 * degrades to "fetch everything from CoinMarketCap".
 *
 * Fallback: when CoinMarketCap is unreachable (common on networks that
 * reset TLS to pro-api.coinmarketcap.com), we fall back to Binance's
 * public market-data host. That path has no market-cap / supply fields
 * and derives 7d change from daily klines.
 *
 * Source: CoinMarketCap `/v1/cryptocurrency/quotes/latest`, queried by
 * ticker `symbol` (not CMC's numeric `id` or `slug`) - symbols are stable,
 * human-legible, and don't require us to hardcode/verify CMC-specific ids
 * per coin. CMC returns an array instead of a single object when a symbol
 * is ambiguous (shared by multiple listed assets); we resolve that by
 * picking the highest market-cap match.
 */

export interface MarketDataInput {
  coinId: string; // our internal id (matches watchlist.coin_id)
  symbol: string; // ticker to query CMC with, e.g. "BTC"
}

interface CmcQuoteUSD {
  price: number | null;
  volume_24h: number | null;
  percent_change_1h: number | null;
  percent_change_24h: number | null;
  percent_change_7d: number | null;
  market_cap: number | null;
  last_updated: string | null;
}

interface CmcCoinData {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  circulating_supply: number | null;
  total_supply: number | null;
  last_updated: string | null;
  quote: { USD: CmcQuoteUSD };
}

interface CmcQuotesLatestResponse {
  status: { error_code: number | string; error_message: string | null };
  // CMC returns a single object per symbol normally, or an array if the
  // symbol is ambiguous across multiple listed assets.
  data: Record<string, CmcCoinData | CmcCoinData[]>;
}

function pickBestMatch(entry: CmcCoinData | CmcCoinData[]): CmcCoinData {
  if (!Array.isArray(entry)) return entry;
  return entry.reduce((best, cur) =>
    (cur.quote.USD.market_cap ?? 0) > (best.quote.USD.market_cap ?? 0)
      ? cur
      : best
  );
}

function toSnapshot(
  coinId: string,
  row: CmcCoinData,
  fromCache: boolean
): MarketSnapshot {
  const usd = row.quote.USD;
  return {
    coinId,
    symbol: row.symbol?.toUpperCase() ?? coinId,
    name: row.name,
    priceUsd: usd.price,
    marketCapUsd: usd.market_cap,
    volume24hUsd: usd.volume_24h,
    priceChangePct1h: usd.percent_change_1h,
    priceChangePct24h: usd.percent_change_24h,
    priceChangePct7d: usd.percent_change_7d,
    circulatingSupply: row.circulating_supply,
    totalSupply: row.total_supply,
    // Not available on CMC's /quotes/latest (would need a paid
    // historical/OHLCV endpoint) - left null rather than guessed.
    ath: null,
    athChangePercentage: null,
    lastUpdated: usd.last_updated ?? row.last_updated,
    fromCache,
  };
}

async function fetchFromCoinMarketCap(
  coins: MarketDataInput[]
): Promise<Map<string, MarketSnapshot>> {
  const env = getEnv();
  const symbolToCoinIds = new Map<string, string[]>();
  for (const c of coins) {
    const sym = c.symbol.toUpperCase();
    symbolToCoinIds.set(sym, [...(symbolToCoinIds.get(sym) ?? []), c.coinId]);
  }

  const url = new URL(
    `${env.COINMARKETCAP_BASE_URL}/v1/cryptocurrency/quotes/latest`
  );
  url.searchParams.set("symbol", [...symbolToCoinIds.keys()].join(","));
  url.searchParams.set("convert", "USD");

  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "X-CMC_PRO_API_KEY": env.COINMARKETCAP_API_KEY,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `CoinMarketCap /cryptocurrency/quotes/latest failed: ${res.status} ${res.statusText} ${body}`
    );
  }

  const json = (await res.json()) as CmcQuotesLatestResponse;
  // CMC sometimes returns error_code as a string ("0") - coerce before comparing.
  const errorCode = Number(json.status?.error_code ?? -1);
  if (errorCode !== 0) {
    throw new Error(
      `CoinMarketCap error ${json.status.error_code}: ${json.status.error_message}`
    );
  }
  if (!json.data || typeof json.data !== "object") {
    throw new Error(
      `CoinMarketCap returned no data payload (error_code=${json.status?.error_code}, message=${json.status?.error_message})`
    );
  }

  const map = new Map<string, MarketSnapshot>();
  for (const [key, entry] of Object.entries(json.data)) {
    const row = pickBestMatch(entry);
    // v1 keys by symbol ("BTC"); v3 keys by index ("0") - always prefer
    // the row's own symbol when looking up our watchlist mapping.
    const symbol = (row.symbol || key).toUpperCase();
    const coinIds = symbolToCoinIds.get(symbol) ?? [];
    for (const coinId of coinIds) {
      map.set(coinId, toSnapshot(coinId, row, false));
    }
  }
  return map;
}

/**
 * Binance public fallback. No market-cap / supply. 7d change comes from
 * daily klines (one request per coin - fine for a ~25-coin watchlist).
 */
async function fetchFromBinance(
  coins: MarketDataInput[]
): Promise<Map<string, MarketSnapshot>> {
  const tickers = await fetchBinanceTickers(coins.map((c) => c.symbol));
  const map = new Map<string, MarketSnapshot>();

  for (const coin of coins) {
    const t = tickers.get(coin.symbol.toUpperCase());
    if (!t) continue;

    let pct7d: number | null = null;
    try {
      const closes = await fetchBinanceDailyCloses(coin.symbol, 10);
      pct7d = pctChangeFromCloses(closes, 7);
    } catch (err) {
      console.warn(
        `[market-data] Binance 7d kline failed for ${coin.symbol}:`,
        err instanceof Error ? err.message : err
      );
    }

    map.set(coin.coinId, {
      coinId: coin.coinId,
      symbol: coin.symbol.toUpperCase(),
      name: coin.symbol.toUpperCase(),
      priceUsd: t.lastPrice,
      marketCapUsd: null,
      volume24hUsd: t.quoteVolume,
      priceChangePct1h: null,
      priceChangePct24h: t.priceChangePercent,
      priceChangePct7d: pct7d,
      circulatingSupply: null,
      totalSupply: null,
      ath: null,
      athChangePercentage: null,
      lastUpdated: new Date().toISOString(),
      fromCache: false,
    });
  }

  return map;
}

/**
 * CMC's quotes/latest endpoint accepts many symbols per call; our
 * watchlist is small (<30 coins) so a single batch call is normal, but we
 * chunk defensively in case the watchlist grows.
 */
const BATCH_SIZE = 100;

export async function fetchMarketSnapshots(
  coins: MarketDataInput[]
): Promise<MarketSnapshot[]> {
  if (coins.length === 0) return [];

  const results = new Map<string, MarketSnapshot>();
  const missing: MarketDataInput[] = [];

  for (const coin of coins) {
    const cached = await getCachedPrice<MarketSnapshot>(coin.coinId);
    if (cached) {
      results.set(coin.coinId, { ...cached, fromCache: true });
    } else {
      missing.push(coin);
    }
  }

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const chunk = missing.slice(i, i + BATCH_SIZE);
    let fetched: Map<string, MarketSnapshot>;
    try {
      fetched = await fetchFromCoinMarketCap(chunk);
    } catch (err) {
      console.warn(
        `[market-data] CoinMarketCap failed, falling back to Binance:`,
        err instanceof Error ? err.message : err
      );
      fetched = await fetchFromBinance(chunk);
    }

    for (const [coinId, snapshot] of fetched) {
      results.set(coinId, snapshot);
      await setCachedPrice(coinId, snapshot);
    }
    for (const coin of chunk) {
      if (!fetched.has(coin.coinId)) {
        console.warn(
          `[market-data] No row for symbol "${coin.symbol}" (coinId "${coin.coinId}") from CMC or Binance.`
        );
      }
    }
  }

  // Preserve caller's input order.
  return coins
    .map((c) => results.get(c.coinId))
    .filter((s): s is MarketSnapshot => Boolean(s));
}
