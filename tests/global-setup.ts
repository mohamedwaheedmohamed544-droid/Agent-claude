import { execFileSync } from "node:child_process";
import { Client } from "pg";

/** Resets the TEST database schema and applies all migrations. Refuses to touch non-test databases. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/nexus_test";
  if (!/test/i.test(new URL(url).pathname)) throw new Error("Refusing to reset a database whose name does not contain 'test'");
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await c.end();
  execFileSync("npx", ["tsx", "scripts/migrate.ts"], { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
