import {
  fetchBinanceDailyCloses,
} from "../integrations/binance";
import { getPriceHistoryDayCount, upsertHistoricalDailyBars } from "../db/priceHistory";
import type { WatchlistCoin } from "../types";

const TARGET_HISTORY_DAYS = 14;

/**
 * Backfills `daily_price_agg` from Binance public daily klines when we have
 * fewer than ~14 calendar days of history. Without this, volatility stays
 * fake (falling back to |24h change|) for two weeks after first deploy.
 *
 * Safe to re-run: upserts are idempotent, and coins without a Binance USDT
 * pair are skipped with a warning.
 */
export async function runPriceHistoryBackfill(
  watchlist: WatchlistCoin[]
): Promise<{ daysBefore: number; daysAfter: number; barsWritten: number }> {
  const daysBefore = await getPriceHistoryDayCount();
  if (daysBefore >= TARGET_HISTORY_DAYS) {
    return { daysBefore, daysAfter: daysBefore, barsWritten: 0 };
  }

  let barsWritten = 0;
  for (const coin of watchlist) {
    try {
      const closes = await fetchBinanceDailyCloses(coin.symbol, TARGET_HISTORY_DAYS + 1);
      const bars = closes.map((c) => ({
        coinId: coin.coinId,
        date: c.date,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
      barsWritten += await upsertHistoricalDailyBars(bars);
    } catch (err) {
      console.warn(
        `[price-history] Binance backfill failed for ${coin.symbol}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const daysAfter = await getPriceHistoryDayCount();
  return { daysBefore, daysAfter, barsWritten };
}
