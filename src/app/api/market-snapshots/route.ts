import { NextResponse } from "next/server";
import { getWatchlist } from "@/server/db/watchlist";
import { fetchMarketSnapshots } from "@/server/agents/marketData";

/** Live market snapshots for the current watchlist (Redis-cached, ~10 min TTL). */
export async function GET() {
  const watchlist = await getWatchlist();
  const snapshots = await fetchMarketSnapshots(
    watchlist.map((c) => ({ coinId: c.coinId, symbol: c.symbol }))
  );
  return NextResponse.json({ snapshots });
}
