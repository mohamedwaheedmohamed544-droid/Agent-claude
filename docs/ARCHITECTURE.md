# Nexus AI — Architecture

Nexus AI is a multi-agent platform: a central **Orchestrator** turns each request into a persisted plan,
**specialist agents** execute the steps with a governed **tool registry**, and an **approval engine**
gates every action that modifies data or reaches the outside world.

```
 Browser (Next.js App Router, React 19, EN/AR + RTL, light/dark)
   │  same-origin JSON API (session cookie, CSRF origin check, rate limits)
   ▼
 API routes  src/app/api/**  ── workspaceRoute(): auth → membership → role → rate limit → handler → request log
   │
   ├─ Orchestrator  src/lib/orchestrator/
   │    planner.ts   structured-output plan (direct | single | multi), validated DAG (≤ 8 steps, no cycles)
   │    engine.ts    durable runner: lease lock, parallel waves, conditions, retries/backoff,
   │                 pause/resume/cancel, waiting_approval, time-budgeted yielding, crash recovery
   │    chat.ts      conversation persistence + plan → task
   │
   ├─ Agents  src/lib/agents/
   │    definitions.ts  7 specialists + shared safety policy + orchestrator prompt
   │    store.ts        DB-backed agents with immutable versions; per-workspace overrides
   │    runner.ts       context assembly (memory + RAG + upstream outputs as untrusted data),
   │                    tool-calling loop, checkpoint after every round (resumable)
   │
   ├─ Tools  src/lib/tools/
   │    registry.ts     code-defined tools mirrored into tool_registry (zod → JSON schema)
   │    executor.ts     THE choke point: allow-list → emergency stop → enablement → validation →
   │                    integration check → approval policy (hash-bound) → idempotency → timeout → audit
   │    builtin.ts      knowledge/memory/web/files/data/deliverables/work items/webhook
   │    integration-tools.ts  Gmail/Outlook/Calendar/Drive tools (OAuth)
   │
   ├─ Knowledge & memory  src/lib/knowledge/, src/lib/memory/
   │    ingestion (PDF/DOCX/XLSX/PPTX/CSV/TXT/MD) → chunks → embeddings (pgvector, HNSW)
   │    hybrid retrieval (vector + full-text, reciprocal-rank fusion), workspace-scoped
   │    memory: user / workspace / task scopes; agent proposals inert until approved; secrets rejected
   │
   └─ AI layer  src/lib/ai/
        models.ts  model resolution (workspace override → env), tiers, pricing estimates, token budgeting
        llm.ts     chat / structured JSON / embeddings / web search; fallback model; usage + cost records;
                   daily budget; model-access verification against the account's model list
```

## Task lifecycle

`draft → planned → running ⇄ waiting_approval / paused → completed | failed | cancelled`

* **Durability.** All state lives in Postgres (`tasks`, `task_steps`, `task_dependencies`, step `checkpoint`).
  A runner holds a 120-second lease renewed per wave. If a serverless function dies, the lease expires and
  the next poll (`GET /api/tasks/:id`, `GET /api/tasks`), approval decision, or cron tick resumes it.
  Steps found in `running` by a fresh runner are re-queued and continue from their checkpoint.
* **Parallelism.** Steps whose dependencies are `completed`/`skipped` run concurrently (workspace setting
  `maxParallelSteps`, default 3).
* **Conditions.** A step with a `condition` is evaluated against upstream outputs; if false it is `skipped`.
* **Retries.** Recoverable errors (provider 429/5xx, timeouts, network) retry with exponential backoff up to
  `max_attempts`; other errors fail the step and the task (manual **Retry** re-queues failed steps).
* **Time budget.** A runner yields after `NEXUS_TASK_BUDGET_MS` so it fits Vercel's function limits.

## Autonomy & approvals

| Level | Meaning | Policy |
|---|---|---|
| 1 Read | search, read, analyse | automatic |
| 2 Prepare | drafts, documents, internal work items, memory proposals | automatic |
| 3 Modify | change records/files in connected systems | approval unless workspace enables auto-approve |
| 4 External | send email, webhooks, publish, purchase | **always** explicit approval |

* An approval stores the exact parameters and `params_hash = sha256(canonical({tool, params}))`.
  The decision API requires the client to echo the hash it displayed; any difference → `409 params_changed`.
* When the agent calls the tool again, the executor looks up an approval **for that step with the same hash**.
  Different parameters supersede the old request and create a new one. An approved request is claimed
  atomically (`approved → executed`) so it runs **once**; a failure releases it for an identical retry.
* Successful level ≥ 3 executions are keyed by an idempotency key; repeating the call returns the stored result.
* Rejections are returned to the agent as "rejected — do not retry or work around".
* Only the task owner or a workspace admin can decide; viewers cannot. Emergency stop blocks all model and
  tool calls and pauses running tasks; any member can engage it, only admins can release it.

## Security model

* **Auth:** email + password (scrypt), opaque session tokens stored as SHA-256 hashes, HttpOnly/SameSite=Lax cookies,
  per-IP and per-account login rate limits, constant-cost failed logins.
* **Tenancy:** every row carries `workspace_id`; every query filters by the caller's verified membership.
  Roles: owner > admin > member > viewer.
* **CSRF:** SameSite cookies + Origin/Sec-Fetch-Site checks on all mutating API requests.
* **Prompt injection:** all external content (web, documents, tool output, upstream agents, memory) is wrapped in
  `<untrusted_data>` blocks whose delimiters cannot be forged; the safety policy instructs agents to treat it as data.
  Structural controls (allow-lists, approvals, emergency stop) hold even if a model is manipulated.
* **SSRF:** `fetch_url` and webhooks resolve DNS and block private/reserved ranges on every redirect hop.
* **Secrets:** integration tokens are AES-256-GCM encrypted; secret-looking strings are redacted from logs,
  audit metadata, tool outputs and agent results, and rejected from memory. `/api/health` and the admin
  health page report configuration **presence only**.
* **Headers:** CSP, frame-ancestors none, HSTS, nosniff, strict referrer policy.

## Data model

See `db/migrations/001_init.sql` — users, sessions, workspaces, workspace_members, agents, agent_versions,
conversations, messages, tasks, task_steps, task_dependencies, tool_registry, tool_executions, approvals,
audit_logs, usage_records, api_request_logs, rate_limits, integrations, oauth_states, knowledge_bases,
knowledge_files, document_chunks, embeddings (vector(1536), HNSW), memory_items (vector), generated_artifacts,
work_items.

Migrations run via `npm run db:migrate` (transactional, advisory-locked, checksum-verified). The Vercel build
(`vercel-build`) applies pending migrations before `next build`.
