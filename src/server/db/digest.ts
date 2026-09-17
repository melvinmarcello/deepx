import { getPool } from "./client";
import type { DigestEntry } from "../types";

interface DigestRow {
  id: number;
  coin_id: string;
  rank: number | null;
  rationale: string | null;
  risk_score: string | null;
  composite_signal_score: string | null;
  digest_date: string;
}

function toDigestEntry(row: DigestRow): DigestEntry {
  return {
    id: row.id,
    coinId: row.coin_id,
    rank: row.rank,
    rationale: row.rationale,
    riskScore: row.risk_score != null ? Number(row.risk_score) : null,
    compositeSignalScore:
      row.composite_signal_score != null ? Number(row.composite_signal_score) : null,
    digestDate: row.digest_date,
  };
}

export interface UpsertDigestEntryInput {
  coinId: string;
  rank: number;
  rationale: string;
  riskScore: number | null;
  compositeSignalScore: number;
}

export async function upsertDigestEntry(
  input: UpsertDigestEntryInput
): Promise<DigestEntry> {
  const res = await getPool().query<DigestRow>(
    `INSERT INTO daily_digest (coin_id, rank, rationale, risk_score, composite_signal_score, digest_date)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
     ON CONFLICT (digest_date, coin_id) DO UPDATE SET
       rank = EXCLUDED.rank,
       rationale = EXCLUDED.rationale,
       risk_score = EXCLUDED.risk_score,
       composite_signal_score = EXCLUDED.composite_signal_score
     RETURNING *`,
    [
      input.coinId,
      input.rank,
      input.rationale,
      input.riskScore,
      input.compositeSignalScore,
    ]
  );
  return toDigestEntry(res.rows[0]);
}

export async function getDigestForDate(date?: string): Promise<DigestEntry[]> {
  const res = await getPool().query<DigestRow>(
    date
      ? `SELECT * FROM daily_digest WHERE digest_date = $1 ORDER BY rank ASC`
      : `SELECT * FROM daily_digest WHERE digest_date = CURRENT_DATE ORDER BY rank ASC`,
    date ? [date] : []
  );
  return res.rows.map(toDigestEntry);
}

export async function getLatestDigest(): Promise<DigestEntry[]> {
  const res = await getPool().query<DigestRow>(
    `SELECT * FROM daily_digest
     WHERE digest_date = (SELECT MAX(digest_date) FROM daily_digest)
     ORDER BY rank ASC`
  );
  return res.rows.map(toDigestEntry);
}
