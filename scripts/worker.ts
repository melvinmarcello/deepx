import "dotenv/config";
import cron from "node-cron";
import { getEnv } from "../src/server/config/env";
import { runPipeline } from "../src/server/pipeline/runPipeline";
import { closePool } from "../src/server/db/client";
import { closeRedis } from "../src/server/cache/redis";

/**
 * Long-running worker process: schedules `runPipeline()` on the
 * `PIPELINE_CRON` cadence (default: every 2 hours). Set
 * `PIPELINE_RUN_ON_BOOT=true` to also run once immediately on start,
 * useful for local dev/testing.
 *
 *   npm run worker
 */
async function main() {
  const env = getEnv();
  console.log(`[worker] scheduling pipeline with cron "${env.PIPELINE_CRON}"`);

  if (env.PIPELINE_RUN_ON_BOOT) {
    console.log("[worker] PIPELINE_RUN_ON_BOOT=true, running once now...");
    await runPipeline()
      .then((r) => console.log(`[worker] boot run finished: ${r.status}`, r.errors))
      .catch((err) => console.error("[worker] boot run crashed:", err));
  }

  cron.schedule(env.PIPELINE_CRON, async () => {
    console.log(`[worker] pipeline run triggered at ${new Date().toISOString()}`);
    try {
      const result = await runPipeline();
      console.log(`[worker] pipeline finished: ${result.status}`, result.errors);
    } catch (err) {
      console.error("[worker] pipeline crashed:", err);
    }
  });

  console.log("[worker] cron scheduled - process will stay alive.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

async function shutdown() {
  console.log("\n[worker] shutting down...");
  await closePool();
  await closeRedis();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
