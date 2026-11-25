/**
 * Applies SQL migrations in db/migrations in lexical order.
 * - Each migration runs in its own transaction.
 * - A Postgres advisory lock prevents concurrent runners (e.g. parallel deploys).
 * - Applied migrations are recorded with a checksum; a changed, already-applied file aborts the run.
 * Never prints the connection string.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.MIGRATE_OPTIONAL === "1") {
      console.warn("[migrate] DATABASE_URL not set — skipping (MIGRATE_OPTIONAL=1)");
      return;
    }
    throw new Error("DATABASE_URL is not set");
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(7262871)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const { rows } = await client.query<{ name: string; checksum: string }>("SELECT name, checksum FROM schema_migrations");
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));
    let count = 0;
    for (const file of files) {
      const sql = readFileSync(path.join(dir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (applied.has(file)) {
        if (applied.get(file) !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
        continue;
      }
      console.log(`[migrate] applying ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name, checksum) VALUES ($1,$2)", [file, checksum]);
        await client.query("COMMIT");
        count++;
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
    }
    console.log(`[migrate] done — ${count} applied, ${files.length - count} already up to date`);
  } finally {
    await client.query("SELECT pg_advisory_unlock(7262871)").catch(() => {});
    await client.end();
  }
}

main().catch((e) => {
  console.error("[migrate] ERROR:", e.message);
  process.exit(1);
});
