import { Pool, type QueryResultRow } from "pg";
import { getEnv } from "../config/env";

let pool: Pool | null = null;

/**
 * Singleton pg Pool. Reused across API routes / pipeline runs in the
 * same process (Next.js dev/server, or the cron worker process).
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getEnv().DATABASE_URL });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
) {
  const client = getPool();
  return client.query<T>(text, params);
}

/** Run a series of queries inside a single transaction. */
export async function withTransaction<T>(
  fn: (
    exec: <R extends QueryResultRow = QueryResultRow>(
      text: string,
      params?: unknown[]
    ) => Promise<import("pg").QueryResult<R>>
  ) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const exec = <R extends QueryResultRow = QueryResultRow>(
      text: string,
      params: unknown[] = []
    ) => client.query<R>(text, params);
    const result = await fn(exec);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
