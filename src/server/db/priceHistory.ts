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
