import { execFileSync } from "node:child_process";
import { Client } from "pg";

export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/nexus_e2e";
  if (!/e2e|test/i.test(new URL(url).pathname)) throw new Error("Refusing to reset a non-test database");
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await c.end();
  execFileSync("npx", ["tsx", "scripts/migrate.ts"], { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
