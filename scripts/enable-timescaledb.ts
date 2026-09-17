import "dotenv/config";
import { getPool, closePool } from "../src/server/db/client";

/**
 * Optional, re-runnable upgrade step: converts `daily_price_agg` into a
 * TimescaleDB hypertable. Safe to run multiple times (if_not_exists).
 *
 * Prerequisite - install the TimescaleDB extension binary itself first
 * (this is a server-level install, not something SQL/migrations can do):
 *
 * Windows (PostgreSQL 18):
 *   1. Download: https://github.com/timescale/timescaledb/releases/download/2.26.2/TimescaleDB.Windows.PG18.zip
 *      (grab the latest PG18 zip from https://github.com/timescale/timescaledb/releases if newer)
 *   2. Unzip it, then right-click `timescaledb\setup.exe` -> "Run as Administrator"
 *   3. Accept the timescaledb-tune prompt during setup
 *   4. Restart the service (as Administrator):  Restart-Service postgresql-x64-18
 *
 * Then run:  npm run db:enable-timescale
 */
async function main() {
  const pool = getPool();

  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS timescaledb");
  } catch (err) {
    console.error(
      "Could not create the timescaledb extension. It's likely not " +
        "installed on this Postgres server yet - see the install steps " +
        "in this file's header comment.\n"
    );
    throw err;
  }

  await pool.query(
    `SELECT create_hypertable(
       'daily_price_agg',
       'date',
       chunk_time_interval => INTERVAL '1 month',
       if_not_exists => TRUE,
       migrate_data => TRUE
     )`
  );

  console.log(
    "timescaledb extension enabled and daily_price_agg is now a hypertable."
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
