import "dotenv/config";
import { fetchMarketSnapshots } from "../src/server/agents/marketData";
import { getWatchlist } from "../src/server/db/watchlist";
import { closePool } from "../src/server/db/client";
import { closeRedis } from "../src/server/cache/redis";

/**
 * Manual test script for the Market Data Agent (Build Order step 2).
 * Run twice in a row - the first run hits CoinGecko, the second should
 * show `fromCache: true` for every coin (Redis TTL ~10 min).
 *
 *   npm run test:market-data
 */
async function main() {
  const watchlist = await getWatchlist();
  if (watchlist.length === 0) {
    console.warn(
      "Watchlist is empty - run `npm run db:seed` first, or pass ids manually below."
    );
  }
  const coins = watchlist.length
    ? watchlist.map((c) => ({ coinId: c.coinId, symbol: c.symbol }))
    : [
        { coinId: "bitcoin", symbol: "BTC" },
        { coinId: "ethereum", symbol: "ETH" },
        { coinId: "solana", symbol: "SOL" },
      ];

  console.log(
    `Fetching market snapshots for: ${coins.map((c) => c.symbol).join(", ")}`
  );
  const start = Date.now();
  const snapshots = await fetchMarketSnapshots(coins);
  console.log(`Done in ${Date.now() - start}ms\n`);

  console.table(
    snapshots.map((s) => ({
      coinId: s.coinId,
      symbol: s.symbol,
      priceUsd: s.priceUsd,
      chg24h: s.priceChangePct24h?.toFixed(2),
      chg7d: s.priceChangePct7d?.toFixed(2),
      marketCapUsd: s.marketCapUsd,
      fromCache: s.fromCache,
    }))
  );

  const missing = coins.filter(
    (c) => !snapshots.find((s) => s.coinId === c.coinId)
  );
  if (missing.length) {
    console.warn(
      `No data returned for: ${missing.map((c) => c.symbol).join(", ")}`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
    await closeRedis();
  });
