import { NextResponse } from "next/server";
import { getWatchlist, addToWatchlist, removeFromWatchlist } from "@/server/db/watchlist";

export async function GET() {
  const watchlist = await getWatchlist();
  return NextResponse.json({ watchlist });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body?.coinId || !body?.symbol || !body?.name) {
    return NextResponse.json(
      { error: "coinId, symbol, and name are required" },
      { status: 400 }
    );
  }
  const coin = await addToWatchlist({
    coinId: body.coinId,
    symbol: body.symbol,
    name: body.name,
    ethContractAddress: body.ethContractAddress ?? null,
    bscContractAddress: body.bscContractAddress ?? null,
  });
  return NextResponse.json({ coin }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const coinId = searchParams.get("coinId");
  if (!coinId) {
    return NextResponse.json({ error: "coinId query param is required" }, { status: 400 });
  }
  await removeFromWatchlist(coinId);
  return NextResponse.json({ ok: true });
}
