import { getPool } from "./client";
import type { MarketSnapshot } from "../types";

/**
 * Upserts today's row in `daily_price_agg` from a fresh market snapshot.
 * Since the pipeline runs multiple times a day (not just once at
 * midnight), `open` is only set on the first insert of the day (via
 * VALUES) and `high`/`low` are widened on every subsequent call so the
 * row ends up reflecting the day's real intraday range, with `close`
 * always holding the latest-seen price.
 */
export async function upsertDailyPriceAgg(snapshots: MarketSnapshot[]): Promise<void> {
  const pool = getPool();
  for (const s of snapshots) {
    if (s.priceUsd == null) continue;
    await pool.query(
      `INSERT INTO daily_price_agg (coin_id, date, open, high, low, close, volume)
       VALUES ($1, CURRENT_DATE, $2, $2, $2, $2, $3)
       ON CONFLICT (coin_id, date) DO UPDATE SET
         high = GREATEST(daily_price_agg.high, EXCLUDED.high),
         low = LEAST(daily_price_agg.low, EXCLUDED.low),
         close = EXCLUDED.close,
         volume = EXCLUDED.volume`,
      [s.coinId, s.priceUsd, s.volume24hUsd]
    );
  }
}

export interface PriceHistoryPoint {
  date: string; // YYYY-MM-DD
  close: number | null;
}

export async function getRecentDailyCloses(
  coinId: string,
  days = 14
): Promise<PriceHistoryPoint[]> {
  const res = await getPool().query<{ date: string; close: string | null }>(
    `SELECT to_char(date, 'YYYY-MM-DD') as date, close
     FROM daily_price_agg
     WHERE coin_id = $1
     ORDER BY date DESC
     LIMIT $2`,
    [coinId, days]
  );
  return res.rows.map((r) => ({
    date: r.date,
    close: r.close != null ? Number(r.close) : null,
  }));
}

/**
 * Number of distinct days of stored history. The dashboard uses this to say
 * honestly whether volatility-based metrics have enough data to mean anything.
 */
export async function getPriceHistoryDayCount(): Promise<number> {
  const res = await getPool().query<{ days: string }>(
    `SELECT count(DISTINCT date) AS days FROM daily_price_agg`
  );
  return Number(res.rows[0]?.days ?? 0);
}

export interface HistoricalDailyBar {
  coinId: string;
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

/**
 * Upserts historical daily bars (e.g. Binance kline backfill). Does not
 * overwrite today's live pipeline row with an older candle if it would
 * shrink the already-widened high/low for the current day - we still
 * update close/volume so the latest known close wins.
 */
export async function upsertHistoricalDailyBars(
  bars: HistoricalDailyBar[]
): Promise<number> {
  if (bars.length === 0) return 0;
  const pool = getPool();
  let written = 0;
  for (const b of bars) {
    const res = await pool.query(
      `INSERT INTO daily_price_agg (coin_id, date, open, high, low, close, volume)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7)
       ON CONFLICT (coin_id, date) DO UPDATE SET
         high = GREATEST(daily_price_agg.high, EXCLUDED.high),
         low = LEAST(daily_price_agg.low, EXCLUDED.low),
         close = EXCLUDED.close,
         volume = COALESCE(EXCLUDED.volume, daily_price_agg.volume)`,
      [b.coinId, b.date, b.open, b.high, b.low, b.close, b.volume]
    );
    written += res.rowCount ?? 0;
  }
  return written;
}
