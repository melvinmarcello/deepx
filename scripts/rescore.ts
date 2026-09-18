import "dotenv/config";
import { getWatchlist } from "../src/server/db/watchlist";
import { getLatestMarketSnapshots } from "../src/server/db/marketSnapshots";
import { runRiskScoreAgent } from "../src/server/agents/riskScore";
import { clearDigestForToday } from "../src/server/db/digest";
import { runDigestAgent } from "../src/server/agents/digest";
import { closePool } from "../src/server/db/client";

async function main() {
  const watchlist = await getWatchlist();
  const stored = await getLatestMarketSnapshots();
  const snapshots = stored.map((s) => s.snapshot);
  console.log(`Re-scoring ${snapshots.length} coins with ${watchlist.length} watchlist entries…`);

  const risk = await runRiskScoreAgent(watchlist, snapshots);
  console.log("risk:", risk);

  // Digest needs 9Router - may work from Windows via 10.16.240.174
  try {
    await clearDigestForToday();
    const digest = await runDigestAgent(watchlist, snapshots);
    console.log("digest:", digest);
  } catch (err) {
    console.warn("digest skipped:", err instanceof Error ? err.message : err);
  }

  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool().catch(() => undefined);
  process.exit(1);
});
