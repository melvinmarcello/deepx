import { NextResponse } from "next/server";
import { getDigestForDate, getLatestDigest } from "@/server/db/digest";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") ?? undefined;

  const digest = date ? await getDigestForDate(date) : await getLatestDigest();
  return NextResponse.json({ digest });
}
