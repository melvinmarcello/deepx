import "dotenv/config";
import { getWatchlist } from "../src/server/db/watchlist";
import { fetchBinanceDailyCloses } from "../src/server/integrations/binance";
import {
  getPriceHistoryDayCount,
  upsertHistoricalDailyBars,
} from "../src/server/db/priceHistory";
import { closePool } from "../src/server/db/client";

async function main() {
  const before = await getPriceHistoryDayCount();
  console.log("before days:", before);

  const sample = await fetchBinanceDailyCloses("BTC", 15);
  console.log("btc sample candles:", sample.length, sample[0]?.date, "→", sample.at(-1)?.date);

  const watchlist = await getWatchlist();
  let written = 0;
  for (const coin of watchlist) {
    try {
      const closes = await fetchBinanceDailyCloses(coin.symbol, 15);
      const n = await upsertHistoricalDailyBars(
        closes.map((c) => ({
          coinId: coin.coinId,
          date: c.date,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }))
      );
      written += n;
      console.log(`  ${coin.symbol}: ${closes.length} bars, upserted ${n}`);
    } catch (err) {
      console.warn(`  ${coin.symbol} FAILED:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("written:", written, "after days:", await getPriceHistoryDayCount());
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool().catch(() => undefined);
  process.exit(1);
});
