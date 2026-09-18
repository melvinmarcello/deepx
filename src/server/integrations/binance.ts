/**
 * Binance public market-data client (no API key required).
 *
 * Used as a fallback when CoinMarketCap is unreachable from this network.
 * Prefer the market-data-only host so we never accidentally hit authenticated
 * endpoints and so corporate firewalls that block api.binance.com but allow
 * the data host still work.
 *
 * Coverage notes:
 *  - Spot USDT pairs only - coins without a Binance USDT market are skipped.
 *  - No market-cap / circulating / total supply (Binance does not publish those).
 *  - 7d change is derived from daily klines when requested.
 */

const BINANCE_DATA_BASE =
  process.env.BINANCE_DATA_BASE_URL ?? "https://data-api.binance.vision";

/** Tickers that do not map 1:1 to SYMBOLUSDT on Binance spot. */
const SYMBOL_OVERRIDES: Record<string, string> = {
  // Render rebranded; Binance still lists RENDERUSDT.
  RENDER: "RENDERUSDT",
};

export function binanceSpotSymbol(ticker: string): string {
  const upper = ticker.toUpperCase();
  return SYMBOL_OVERRIDES[upper] ?? `${upper}USDT`;
}

export interface BinanceTicker24h {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number; // 24h volume in USDT
  highPrice: number;
  lowPrice: number;
}

interface RawTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
}

export async function fetchBinanceTickers(
  tickers: string[],
  opts: { timeoutMs?: number } = {}
): Promise<Map<string, BinanceTicker24h>> {
  const symbols = [...new Set(tickers.map((t) => binanceSpotSymbol(t)))];
  if (symbols.length === 0) return new Map();

  const url = new URL(`${BINANCE_DATA_BASE}/api/v3/ticker/24hr`);
  // Binance wants a JSON array string for the symbols param.
  url.searchParams.set("symbols", JSON.stringify(symbols));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);

  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Binance /ticker/24hr failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as RawTicker[];
    const byBinanceSymbol = new Map(json.map((r) => [r.symbol, r]));

    const out = new Map<string, BinanceTicker24h>();
    for (const ticker of tickers) {
      const pair = binanceSpotSymbol(ticker);
      const row = byBinanceSymbol.get(pair);
      if (!row) continue;
      out.set(ticker.toUpperCase(), {
        symbol: row.symbol,
        lastPrice: Number(row.lastPrice),
        priceChangePercent: Number(row.priceChangePercent),
        quoteVolume: Number(row.quoteVolume),
        highPrice: Number(row.highPrice),
        lowPrice: Number(row.lowPrice),
      });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

export interface BinanceDailyClose {
  date: string; // YYYY-MM-DD UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // quote volume (USDT)
}

/**
 * Last N daily candles for a ticker. Used to backfill `daily_price_agg` so
 * realised volatility becomes meaningful without waiting for 14 pipeline days.
 */
export async function fetchBinanceDailyCloses(
  ticker: string,
  days = 14,
  opts: { timeoutMs?: number } = {}
): Promise<BinanceDailyClose[]> {
  const url = new URL(`${BINANCE_DATA_BASE}/api/v3/klines`);
  url.searchParams.set("symbol", binanceSpotSymbol(ticker));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("limit", String(Math.min(Math.max(days, 1), 1000)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);

  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Binance /klines failed for ${ticker}: ${res.status} ${body.slice(0, 200)}`
      );
    }
    // [ openTime, open, high, low, close, volume, closeTime, quoteVolume, ... ]
    const rows = (await res.json()) as (string | number)[][];
    return rows.map((r) => {
      const openTime = Number(r[0]);
      const date = new Date(openTime).toISOString().slice(0, 10);
      return {
        date,
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[7]), // quote asset volume
      };
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 7d % change from the close ~7 candles ago to the latest close. */
export function pctChangeFromCloses(closes: BinanceDailyClose[], lookbackDays = 7): number | null {
  if (closes.length < lookbackDays + 1) return null;
  const latest = closes[closes.length - 1]?.close;
  const past = closes[closes.length - 1 - lookbackDays]?.close;
  if (!latest || !past) return null;
  return ((latest - past) / past) * 100;
}
