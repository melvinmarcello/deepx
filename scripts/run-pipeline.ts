import "dotenv/config";
import { runPipeline } from "../src/server/pipeline/runPipeline";
import { closePool } from "../src/server/db/client";
import { closeRedis } from "../src/server/cache/redis";

/**
 * Manual one-off pipeline trigger, for testing agents without waiting for
 * the cron schedule. Each stage fails independently (see runPipeline), so
 * this is safe to run even while CoinMarketCap/Etherscan are unreachable -
 * you'll just see those specific steps show up under `errors` below while
 * everything else (news, risk-score off existing data, digest) still runs.
 *
 *   npm run pipeline:run
 */
async function main() {
  console.log("Running pipeline once...");
  const start = Date.now();
  const result = await runPipeline();
  console.log(`\nRun #${result.runId} finished in ${Date.now() - start}ms - status: ${result.status}`);

  if (result.errors.length) {
    console.log("\nStep errors:");
    for (const e of result.errors) {
      console.log(`  [${e.step}] ${e.message}`);
    }
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
