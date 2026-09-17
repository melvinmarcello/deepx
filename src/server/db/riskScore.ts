import { getPool } from "./client";
import type { RiskScore } from "../types";

interface RiskScoreRow {
  id: number;
  coin_id: string;
  volatility_score: string | null;
  liquidity_score: string | null;
  concentration_score: string | null;
  composite_score: string | null;
  computed_at: string;
}

function toRiskScore(row: RiskScoreRow): RiskScore {
  return {
    id: row.id,
    coinId: row.coin_id,
    volatilityScore: row.volatility_score != null ? Number(row.volatility_score) : null,
    liquidityScore: row.liquidity_score != null ? Number(row.liquidity_score) : null,
    concentrationScore:
      row.concentration_score != null ? Number(row.concentration_score) : null,
    compositeScore: row.composite_score != null ? Number(row.composite_score) : null,
    computedAt: row.computed_at,
  };
}

export interface InsertRiskScoreInput {
  coinId: string;
  volatilityScore: number;
  liquidityScore: number;
  concentrationScore: number;
  compositeScore: number;
}

/** Always inserts a new row - history is kept (one row per pipeline run per coin). */
export async function insertRiskScore(input: InsertRiskScoreInput): Promise<RiskScore> {
  const res = await getPool().query<RiskScoreRow>(
    `INSERT INTO risk_scores (coin_id, volatility_score, liquidity_score, concentration_score, composite_score)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.coinId,
      input.volatilityScore,
      input.liquidityScore,
      input.concentrationScore,
      input.compositeScore,
    ]
  );
  return toRiskScore(res.rows[0]);
}

export async function getLatestRiskScores(): Promise<RiskScore[]> {
  const res = await getPool().query<RiskScoreRow>(
    `SELECT DISTINCT ON (coin_id) * FROM risk_scores ORDER BY coin_id, computed_at DESC`
  );
  return res.rows.map(toRiskScore);
}

/** Convenience map of coinId -> latest composite_score, used by the digest agent. */
export async function getLatestRiskScoreMap(): Promise<Map<string, number>> {
  const scores = await getLatestRiskScores();
  const map = new Map<string, number>();
  for (const s of scores) {
    if (s.compositeScore != null) map.set(s.coinId, s.compositeScore);
  }
  return map;
}
