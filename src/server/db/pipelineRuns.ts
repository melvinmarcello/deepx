import { getPool } from "./client";
import type { PipelineRun } from "../types";

interface PipelineRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  errors: unknown;
}

function toPipelineRun(row: PipelineRunRow): PipelineRun {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: (row.status ?? "running") as PipelineRun["status"],
    errors: row.errors,
  };
}

export async function createPipelineRun(): Promise<number> {
  const res = await getPool().query<{ id: number }>(
    `INSERT INTO pipeline_runs (status) VALUES ('running') RETURNING id`
  );
  return res.rows[0].id;
}

export async function finishPipelineRun(
  id: number,
  status: "success" | "partial" | "failed",
  errors: unknown[]
): Promise<void> {
  await getPool().query(
    `UPDATE pipeline_runs SET finished_at = now(), status = $2, errors = $3 WHERE id = $1`,
    [id, status, JSON.stringify(errors)]
  );
}

export async function getRecentPipelineRuns(limit = 20): Promise<PipelineRun[]> {
  const res = await getPool().query<PipelineRunRow>(
    `SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows.map(toPipelineRun);
}
