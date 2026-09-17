import { NextResponse } from "next/server";
import { getRecentNews, getRecentNewsForCoin } from "@/server/db/news";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const coinId = searchParams.get("coinId");
  const hours = Number(searchParams.get("hours") ?? "24");
  const limit = Number(searchParams.get("limit") ?? "50");

  const news = coinId ? await getRecentNewsForCoin(coinId, hours) : await getRecentNews(limit);
  return NextResponse.json({ news });
}
