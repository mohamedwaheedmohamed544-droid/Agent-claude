/**
 * Deletes ALL user accounts and ALL workspace data (conversations, tasks, files, agents, onboarding,
 * integrations, audit history). Keeps the schema, migrations and built-in catalogue (system agents,
 * skills, templates). The next person to sign up becomes the platform admin again.
 *
 *   Dry run (counts only):   DATABASE_URL=... npx tsx scripts/reset-accounts.ts
 *   Delete everything:       DATABASE_URL=... npx tsx scripts/reset-accounts.ts --confirm "DELETE ALL ACCOUNTS"
 *
 * Irreversible except through a database backup / Neon point-in-time restore.
 * Runs in one transaction: either everything is deleted or nothing is.
 */
import { Client } from "pg";

const PHRASE = "DELETE ALL ACCOUNTS";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const u = new URL(url);
  const target = `${u.hostname}${u.pathname}`; // never print credentials
  const i = process.argv.indexOf("--confirm");
  const confirmed = i > 0 && process.argv[i + 1] === PHRASE;

  const c = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(u.hostname) ? undefined : { rejectUnauthorized: true } });
  await c.connect();
  try {
    const count = async (sql: string) => Number((await c.query<{ n: string }>(sql)).rows[0].n);
    const before = {
      users: await count("SELECT count(*) AS n FROM users"),
      workspaces: await count("SELECT count(*) AS n FROM workspaces"),
      sessions: await count("SELECT count(*) AS n FROM sessions"),
      tasks: await count("SELECT count(*) AS n FROM tasks"),
      files: await count("SELECT count(*) AS n FROM knowledge_files"),
      workspaceAgents: await count("SELECT count(*) AS n FROM agents WHERE workspace_id IS NOT NULL"),
    };
    console.log(`Database: ${target}`);
    console.log("Will delete:", before);
    if (!confirmed) {
      console.log(`\nDry run only. To delete, re-run with: --confirm "${PHRASE}"`);
      return;
    }
    await c.query("BEGIN");
    // Workspaces first (users.owner_id has no cascade); this cascades to every workspace-scoped table.
    await c.query("UPDATE users SET last_workspace_id = NULL");
    await c.query("DELETE FROM workspaces");
    await c.query("DELETE FROM users"); // cascades sessions, memberships, oauth states
    // Account-related rows not tied to a workspace.
    await c.query("DELETE FROM audit_logs");
    await c.query("DELETE FROM usage_records");
    await c.query("DELETE FROM api_request_logs");
    await c.query("DELETE FROM rate_limits");
    await c.query("COMMIT");
    console.log("\nDone. Remaining:", {
      users: await count("SELECT count(*) AS n FROM users"),
      workspaces: await count("SELECT count(*) AS n FROM workspaces"),
      builtinAgents: await count("SELECT count(*) AS n FROM agents WHERE workspace_id IS NULL"),
      builtinSkills: await count("SELECT count(*) AS n FROM skills WHERE workspace_id IS NULL"),
    });
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("Failed — nothing was deleted:", e instanceof Error ? e.message : e); process.exit(1); });
