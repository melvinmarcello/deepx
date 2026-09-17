import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getPool, closePool } from "../src/server/db/client";

const MIGRATIONS_DIR = path.join(
  __dirname,
  "..",
  "src",
  "server",
  "db",
  "migrations"
);

async function ensureMigrationsTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const pool = getPool();
  const res = await pool.query<{ name: string }>(
    "SELECT name FROM schema_migrations"
  );
  return new Set(res.rows.map((r) => r.name));
}

async function main() {
  console.log(`Connecting via DATABASE_URL...`);
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migration files found.");
    return;
  }

  const pool = getPool();
  let ranCount = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
        file,
      ]);
      await client.query("COMMIT");
      console.log(`  ok    ${file}`);
      ranCount++;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  FAIL  ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log(
    ranCount === 0
      ? "Already up to date."
      : `Applied ${ranCount} migration(s).`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
