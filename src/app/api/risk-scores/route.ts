import { NextResponse } from "next/server";
import { getLatestRiskScores } from "@/server/db/riskScore";

/** Latest risk score row per coin (one per coin_id, most recent computed_at). */
export async function GET() {
  const scores = await getLatestRiskScores();
  return NextResponse.json({ scores });
}
