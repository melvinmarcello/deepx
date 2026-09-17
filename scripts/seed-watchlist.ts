import "dotenv/config";
import { getPool, closePool } from "../src/server/db/client";
import { DEFAULT_WATCHLIST } from "../src/server/config/watchlist";

/**
 * Idempotent: inserts the default watchlist, skipping coins already present
 * (so it's safe to re-run after you've added/removed coins via the dashboard).
 */
async function main() {
  const pool = getPool();
  let inserted = 0;
  for (const coin of DEFAULT_WATCHLIST) {
    const res = await pool.query(
      `INSERT INTO watchlist (coin_id, symbol, name, eth_contract_address, bsc_contract_address)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (coin_id) DO NOTHING`,
      [
        coin.coinId,
        coin.symbol,
        coin.name,
        coin.chains?.ethereum ?? null,
        coin.chains?.bsc ?? null,
      ]
    );
    if (res.rowCount) inserted++;
  }
  console.log(
    `Seeded ${inserted} new coin(s), ${DEFAULT_WATCHLIST.length - inserted} already present.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
