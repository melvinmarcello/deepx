import { NextResponse } from "next/server";
import { getRecentFlags, getRecentFlagsForCoin } from "@/server/db/onchain";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const coinId = searchParams.get("coinId");
  const hours = Number(searchParams.get("hours") ?? "24");
  const limit = Number(searchParams.get("limit") ?? "50");

  const flags = coinId
    ? await getRecentFlagsForCoin(coinId, hours)
    : await getRecentFlags(limit);
  return NextResponse.json({ flags });
}
