# Phase 0 — Architecture & Security Baseline

Date: 28 November 2026 · Scope: the `Agent-claude` codebase at commit `d06a9a4` · Against: *Product Master Blueprint v1.0*

This document is the Phase 0 exit artefact: a documented architecture and security baseline with
prioritised remediation. It separates **what was verified** (by reading code and running tests)
from **what is assumed** and from **what does not exist yet**.

---

## 1. Method

1. Read every API route, the request guard (`src/lib/api.ts`), the session layer, the tool executor,
   the approval engine, the orchestrator and all six migrations.
2. Searched every SQL statement that addresses a row by id without a `workspace_id` predicate and traced
   each back to its entry point.
3. Ran the full test suite against a real PostgreSQL 16 + pgvector database: **103/103 unit/integration
   tests pass**.
4. Added a cross-tenant release-gate suite (`e2e/tenancy.spec.ts`, Playwright against `next start`) and ran it:
   **passes** (details §3.1).

---

## 2. Architecture map (as built)

The detailed design lives in [`ARCHITECTURE.md`](ARCHITECTURE.md). Summary of the modules and how they
map to Blueprint product systems:

| Module (path) | What it does today | Blueprint system |
|---|---|---|
| `src/lib/api.ts` | Single guard for every route: CSRF origin check → session → membership → role → rate limit → handler → request log | §9.2, §9.5 |
| `src/lib/auth/*` | Email + password (scrypt), hashed opaque session tokens, roles owner/admin/member/viewer | §9.5 (partial) |
| `src/lib/orchestrator/*` | Planner (structured output, validated DAG) and a durable engine (leases, parallel waves, retries, pause/resume/cancel, crash recovery) | §6.2 foundation, §7.4 |
| `src/lib/agents/*` | DB-driven agent registry, immutable versions, runtime factory, templates, skills (instruction-level), departments, relationships | §6.1 Workforce Studio (mostly), §6.3 (partial) |
| `src/lib/tools/executor.ts` | The tool choke point: allow-list → emergency stop → enablement → validation → integration check → approval (hash-bound) → idempotency → timeout → audit | §9.6, §9.7 |
| `src/lib/approvals.ts` | L1–L4 risk levels; approvals bound to `sha256(canonical({tool, params}))`; single execution | §9.7 |
| `src/lib/office/*`, `src/components/office/*` | Agent messages, real meetings, presence, SSE stream, adaptive multi-floor 3D office | §7.2, §7.5, §10 |
| `src/lib/knowledge/*`, `src/lib/memory/*` | Ingestion, chunking, hybrid search, scoped memory | §9.2 (isolated memory/vectors) |
| `src/lib/integrations/*` | Google & Microsoft 365 OAuth, AES-256-GCM token storage | §6.4 (native, partial) |
| `src/lib/ai/*` | Anthropic Claude only; usage + cost records per call | §8 (single provider) |
| `src/lib/audit.ts`, `usage_records`, `api_request_logs` | Audit trail, token/cost metering, request logs | §6.5, §12 |

Hosting: Vercel (serverless), Neon PostgreSQL, migrations applied by `vercel-build` (transactional,
advisory-locked, checksum-verified).

---

## 3. Verified controls

### 3.1 Multi-tenant isolation (Blueprint §9.2)

* **Model:** shared database, every tenant row carries `workspace_id`; isolation is enforced in the
  application. There is **no database-level enforcement** (no Row-Level Security).
* **Guard:** every route except `/api/health` (no tenant data) and `/api/cron/tick` (constant-time
  `CRON_SECRET` check) goes through `publicRoute`/`userRoute`/`workspaceRoute`. Workspace selection
  (header, cookie or last-used) is re-verified against `workspace_members` on every request; an explicit
  foreign header returns 403.
* **Query audit:** all id-only `UPDATE/SELECT` statements found operate on ids that were first loaded with a
  `workspace_id` predicate in the same flow (task control, approvals, steps, meetings, agents). No
  caller-supplied id reaches an unscoped query.
* **Test evidence:** `e2e/tenancy.spec.ts`. Tenant A creates a task, conversation, deliverable, pending approval,
  memory, knowledge base, file, department, skill and meeting. Tenant B is then refused (403/404) on
  **20 direct-object operations** (read, update, delete, approve, cancel, reprocess) and on **18 forged
  workspace requests**, and **14 list/search endpoints** return none of A's ids or content. A's data is verified
  unchanged afterwards. Existing unit test `membership checks isolate workspaces` and e2e
  `workspace isolation` remain.
* **Background jobs:** the engine re-reads tasks by id after acquiring a lease. Tasks are created only
  through workspace-scoped routes, so a job never receives a foreign id. The cron route operates across all
  tenants by design (resume stale tasks, expire approvals, prune).

### 3.2 Other controls confirmed in code and tests

| Control | Evidence |
|---|---|
| Hash-bound, single-use approvals; tampered hash → 409 | `approvals.ts`, e2e `api.spec.ts` |
| Agent tool allow-lists, workspace tool disablement, emergency stop | `executor.ts`, `security.test.ts` |
| Agents cannot exceed their permission ceiling; skills cannot add tools beyond it | `agent-management.test.ts` |
| SSRF protection (DNS resolution + private-range block per redirect hop) | `security/net.ts`, `security.test.ts` |
| Prompt-injection containment (unforgeable `<untrusted_data>` blocks + structural controls) | `security/untrusted.ts`, `security.test.ts` |
| Secrets: AES-256-GCM for OAuth tokens, redaction in logs/audit/outputs, secrets rejected from memory | `security/crypto.ts`, `security.test.ts` |
| CSRF: Origin / Sec-Fetch-Site check on all mutations + SameSite=Lax | `api.ts`, e2e |
| Security headers (CSP, frame-ancestors none, HSTS, nosniff) | `middleware.ts`, e2e |
| Rate limits on login, signup, uploads, meetings | `security/rate-limit.ts` |
| Health endpoints report configuration presence only | e2e `health` test |

---

## 4. Gaps against the Blueprint

Legend: ✅ exists · 🟡 partial · ❌ missing

| Blueprint area | Status | Notes |
|---|---|---|
| §5 Intelligent onboarding, Company Operating Profile, Workforce Blueprint, approval, generation | ✅ | Built in Phase 1 — see `docs/ONBOARDING.md`. Proposals use a deterministic rules engine (no AI call needed). |
| §6.1 Workforce Studio | 🟡 | Builder, versions, lifecycle, departments, supervisors exist. Suspension = deactivate. Per-agent model *provider* policy is missing. |
| §6.2 Workflow Studio | ❌ | The durable engine is a sound base; there are no stored workflow definitions, triggers or schedules, and no visual designer. |
| §6.3 Skills system | 🟡 | Skills are instruction text + required tools + dependencies. Missing: I/O schemas, execution logic, validation, versioning, test-before-publish, metrics. |
| §6.4 Integrations hub | 🟡 | Google & Microsoft native OAuth plus generic webhook. Missing: universal API connectors, Make/n8n/Zapier, per-agent integration access policies, health monitoring. |
| §6.5 Business Control Center | 🟡 | Dashboard, approvals, analytics (usage/cost), system health and audit exist; agent utilisation and security events are not surfaced. |
| §7 Collaboration protocol | 🟡 | Agent messages, delegation via plan steps and real meetings exist. Messages lack the protocol fields (purpose, data classification, expected output, permission validation). |
| §8 Multi-provider AI | ❌ | Anthropic only, called directly from `llm.ts`. No adapter layer, router, provider allow-list or evaluation datasets. Fallback is same-provider only, so no cross-provider data leakage can occur today. |
| §9.3 Data classification | ❌ | No classification on files, memory, knowledge or messages. Scheme defined in §6 below. |
| §9.4 Encryption & secrets | 🟡 | In transit: TLS (Vercel/Neon). At rest: provider-level (Neon) only, plus app-level encryption for OAuth tokens. Missing: key rotation for `NEXUS_ENCRYPTION_KEY` (no key versioning). |
| §9.5 Identity | 🟡 | Missing: email verification, password reset, MFA, invitations with acceptance, session list/revocation, SSO. |
| §9.8 Retention, export, deletion | ❌ | Only `api_request_logs` (30 days) and expired sessions are pruned. No workspace export, workspace deletion flow, or retention settings. |
| §9.9 AI data protection | 🟡 | Usage is recorded per model call. Missing: provider field, data minimisation or redaction *before* sending prompts, classification-aware provider restrictions. |
| §11 Platform administration | ❌ | `is_platform_admin` is set for the first account but grants nothing. This is the safe default: there is no cross-tenant admin access. |
| §12 Metering | 🟡 | Tokens, cost, latency, success per call, task, agent and workspace. Missing: provider, tool execution cost, storage, workflow counts. |

---

## 5. Threat model

**Assets:** customer business data (documents, memory, conversations, deliverables), integration tokens
(mailbox/calendar/drive access), the ability to act externally (send email, webhooks), workforce
configuration, audit records, AI spend.

**Actors:** (A1) unauthenticated internet user · (A2) authenticated user of another tenant · (A3) low-privilege
member/viewer of the same tenant · (A4) malicious content: a web page, document or email processed by an agent
(prompt injection) · (A5) compromised AI provider response · (A6) insider with platform/database access.

| # | Threat | Actor | Current control | Residual risk / gap | Priority |
|---|---|---|---|---|---|
| T1 | Cross-tenant read/write via id guessing or forged workspace | A2 | Guard + scoped queries; tenancy gate | A single missing predicate in future code would leak; nothing enforces it at the database level | **P1**: add RLS defence-in-depth; keep the gate mandatory in CI |
| T2 | Privilege escalation inside a tenant (viewer → admin action) | A3 | `minRole` per route, executor role checks, e2e role tests | Role checks are per route and easy to forget on new routes | P2: route-level role matrix test |
| T3 | Agent manipulated into exfiltrating data or acting externally | A4, A5 | L4 always needs human approval bound to exact params; allow-lists; SSRF; untrusted wrapping | Data can still be *included* in an approved external action; no classification-aware gating | **P1**: data classification gating (Phase 2/3) |
| T4 | Integration token theft | A6, A2 | AES-256-GCM, never returned to the client, redaction | Single static key, no rotation; key loss = token loss | P2: key versioning + rotation |
| T5 | Account takeover | A1 | scrypt, login rate limits, constant-cost failure | No MFA; no password reset (locked-out users cannot recover) | **P1**: password reset + MFA (Phase 4) |
| T6 | Account enumeration | A1, A2 | Login returns a generic error | Signup (409 "exists") and add-member (404 "no account") reveal registration | P2: neutral responses + invitation flow |
| T7 | Unconsented workspace membership | A2 | Admin-only add | Any admin can add any registered email without acceptance; the target then sees that workspace | **P1**: invitation with acceptance |
| T8 | Sending restricted data to an unapproved AI provider | A5 | Single provider, same-provider fallback | Becomes real once multiple providers exist | **P0 design rule** for Phase 3: fallback chains restricted to the workspace allow-list; covered by test |
| T9 | AI spend abuse / denial of wallet | A3, A4 | Daily budget, rate limits, step caps | Budget is per workspace only | P3 |
| T10 | Webhook spoofing (inbound) | A1 | No inbound webhooks exist yet | Required when the Integrations Hub arrives | P2 (with §6.4) |
| T11 | Supply chain | — | Lockfile, pinned skills lock | No automated dependency audit in CI | P2 |
| T12 | Insider access to customer content | A6 | No platform-admin content routes | Database operators can read everything; no app-level encryption of content | P3: evaluate per-tenant encryption for Restricted data |

---

## 6. Data classification scheme (defined in Phase 0, enforced from Phase 1 onwards)

| Level | Definition | Examples | Agent access | AI providers | Approval | Cross-team sharing |
|---|---|---|---|---|---|---|
| **Public** | Intended for public release | Website copy, published posts | Any agent | Any approved provider | Not required | Allowed |
| **Internal** | Day-to-day business information | Meeting notes, internal plans, task outputs | Agents in the workspace with the relevant tool | Any provider on the workspace allow-list | Per action policy | Allowed within workspace |
| **Confidential** | Harm if disclosed: customer data, contracts, pricing, HR | Client lists, proposals, CVs | Agents explicitly granted the data scope | Providers on the allow-list that are marked as *no training + contractual retention limits* | Required for external transmission | Only to agents/teams with the scope |
| **Restricted** | Severe harm or legal exposure | Credentials, financial account data, national IDs, health data | Named agents only; never in memory | Only providers the customer explicitly approved for Restricted; otherwise blocked | Always required, per action | Not shared; access audited |

Rules:
1. Every stored item (file, knowledge chunk, memory, message, deliverable) gets a classification. The default is
   **Internal**; uploads may be raised by the uploader; the system may *propose* a higher level, never a lower one.
2. Derived content inherits the **highest** classification of its inputs.
3. Classification is checked in the tool executor (the existing choke point), so it cannot be bypassed by a model.
4. Onboarding (Phase 1) records the company's sensitive data categories and human-only tasks. These become the
   workspace's default classification and approval policy.

## 7. AI provider & privacy policy (design rules for Phase 3)

* A workspace has an **approved provider list** (default: the platform default provider only).
* The router may only select models from approved providers; a **fallback never leaves the approved list**.
  If no approved model is available, the task fails with a clear reason.
* Classification ceiling per provider (see §6). Restricted data is blocked unless explicitly approved.
* Every model call records provider, model, purpose, tokens, cost, latency and outcome (extends `usage_records`).
* Provider capabilities, terms, regional availability and retention must be verified per provider before enabling it.
  This is a product/legal task, not something to assume in code.

---

## 8. Prioritised remediation

| Priority | Item | Phase | Status |
|---|---|---|---|
| P0 | Cross-tenant release-gate tests | 0 | ✅ Done (`e2e/tenancy.spec.ts`) |
| P0 | Onboarding records sensitive data categories and human-controlled tasks; generated agents get least-privilege ceilings and approval points from them | 1 | ✅ Done |
| P1 | PostgreSQL RLS as defence-in-depth (`SET LOCAL app.workspace_id` per transaction; policies on all tenant tables) | 4 | Planned. Needs a query-layer refactor so every query runs in a tenant-bound transaction |
| P1 | Invitations with acceptance; neutral responses to stop account enumeration | 4 | Planned |
| P1 | Password reset + email verification (needs a transactional email provider: **business decision**) | 4 | Blocked on provider choice |
| P1 | MFA (TOTP) | 4 | Planned |
| P1 | Data classification columns + executor enforcement | 2–3 | Planned |
| P1 | Provider abstraction + allow-list-bounded routing | 3 | Planned |
| P2 | Encryption-key versioning and rotation | 4 | Planned |
| P2 | Session list and revocation UI | 4 | Planned |
| P2 | Route role-matrix test; dependency audit in CI | 4 | Planned |
| P2 | Workspace export and deletion; retention settings | 4 | Planned |
| P3 | Per-tenant encryption for Restricted content; per-user budgets | 4+ | Evaluate |

## 9. Migration and rollback procedure

* Migrations are forward-only SQL files in `db/migrations`, applied in order inside a transaction under an advisory
  lock, with checksums recorded (`scripts/migrate.ts`). A failed migration rolls back completely and blocks the deploy.
* Every new migration must be **additive** (new tables and nullable/defaulted columns), so the previous application
  version keeps working against the new schema. This makes a rollback a Vercel "promote previous deployment" with
  no database change.
* From migration 007 onwards, each migration documents its manual rollback SQL in a header comment, for the rare case where a schema change must
  be reversed. Neon point-in-time restore is the last resort.

## 10. Assumptions and items not verified

* Neon encryption at rest and TLS everywhere are provider properties; they were not independently verified here.
* Vercel's `x-forwarded-for` handling is assumed trustworthy for per-IP rate limits.
* No penetration test or dependency vulnerability scan has been run yet.
* Real Claude API behaviour was not exercised in this session (tests use the deterministic mock provider).
