# Nexus AI

A multi-agent AI operating system. A central **Orchestrator** plans each request and delegates to seven
specialist agents — **Research, Business Development, Documents, Writing, Analytics, Operations, Marketing
Intelligence** — that work with your documents, memory and connected apps under an explicit
**approval engine**. Arabic (RTL) and English, light and dark.

Stack: Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL (Neon) + pgvector · Anthropic Claude API · Vercel.

AI: every agent and the orchestrator run on **Claude** (default `claude-opus-5-5`, adaptive thinking, effort per agent tier, server-side refusal fallback, prompt caching). Web search uses Claude's built-in web search tool. Semantic embeddings are optional via **Voyage AI** (Anthropic has no embeddings API); without a Voyage key, knowledge and memory search use keyword matching.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the design, task lifecycle, approval model and security model.

## Features

| Area | What it does |
|---|---|
| AI Workspace | Conversations with persistent history; live task runs showing plan, parallel steps, agent handoffs, tool activity, inline approvals, sources and deliverables |
| Orchestrator & tasks | Structured planning (direct / single / multi-agent), validated dependency graphs, parallel + conditional steps, retries with backoff, pause/resume/cancel/retry, crash-safe resumption |
| Approvals | L1 read & L2 prepare run automatically; L3 modify needs approval (configurable); L4 external always needs approval. Approval is bound to a hash of the exact parameters and executes once |
| Knowledge | Upload PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, JSON → validated, parsed, chunked → keyword search, plus semantic search (pgvector) when Voyage embeddings are configured; file manager and knowledge bases |
| Memory | User / workspace / task memory with semantic retrieval; agent-proposed memories require approval; secrets are rejected |
| Deliverables | Word (.docx, RTL-aware) and Excel (.xlsx) generation, email drafts, reports |
| Integrations | Gmail & Outlook (search, send), Google & Outlook Calendar, Google Drive (search, upload) via OAuth; webhooks; Claude web search |
| Control | Emergency stop, per-tool enable/disable, agent prompt/tool/model customisation with version history, roles (owner/admin/member/viewer), audit log, usage & cost analytics, system health |

## Setup

```bash
npm install
cp .env.example .env.local   # fill DATABASE_URL, ANTHROPIC_API_KEY, NEXUS_ENCRYPTION_KEY
npm run db:migrate
npm run dev
```

Open http://localhost:3000 and create an account (the first account becomes platform admin and workspace owner).

### Environment variables

All variables are documented in [`.env.example`](.env.example). Required: `DATABASE_URL`, `ANTHROPIC_API_KEY`.
Strongly recommended: `NEXUS_ENCRYPTION_KEY` (needed to connect integrations), `CRON_SECRET`, `NEXUS_APP_URL`. Optional: `VOYAGE_API_KEY` for semantic search,
`ANTHROPIC_MODEL` (default `claude-opus-5-5`) and `ANTHROPIC_FALLBACK_MODEL`.
**Analytics → System health** checks every configured model against your Anthropic account's model list.

### Deploying to Vercel

1. Set the environment variables in the Vercel project (Production + Preview).
2. Vercel runs `npm run vercel-build`, which applies pending migrations (transactional, advisory-locked) and then builds.
3. `vercel.json` schedules `/api/cron/tick` daily (Hobby-plan limit). On Pro, change it to `*/5 * * * *` for faster
   recovery of interrupted tasks. Tasks also self-resume whenever a task page or list is open.
4. Uploads are limited to `NEXUS_MAX_UPLOAD_MB` (default 4 MB) because Vercel limits serverless request bodies to ~4.5 MB.

### Connecting Google / Microsoft 365

Register OAuth apps and add these redirect URIs:

* Google Cloud (Web application; enable Gmail, Calendar and Drive APIs): `${NEXUS_APP_URL}/api/integrations/google/callback`
* Microsoft Entra / Azure (Web platform; delegated `offline_access User.Read Mail.Read Mail.Send Calendars.ReadWrite`):
  `${NEXUS_APP_URL}/api/integrations/microsoft/callback`

Then set `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET` (and optionally `MICROSOFT_TENANT_ID`) and connect from **Integrations**.

## Testing

```bash
npm test                 # 85 unit/integration tests against a real Postgres test DB (mock LLM)
npm run build && npm run test:e2e   # 16 Playwright tests: API, desktop UI, mobile — against `next start`
```

Tests need a local PostgreSQL with pgvector; databases are configured by `TEST_DATABASE_URL` (default
`postgres://postgres@127.0.0.1:5432/nexus_test`) and `E2E_DATABASE_URL` (default `…/nexus_e2e`). Test setup refuses
to reset any database whose name does not contain `test`/`e2e`.

The **mock LLM** (`NEXUS_LLM_PROVIDER=mock`) is a deterministic stand-in used only by automated tests. It is blocked in
production unless explicitly overridden, and every mock answer is labelled `[mock]`.

## Known limitations

* Live Claude behaviour (planning quality, web search) has not been verified against the real API in this build environment —
  no key was available. The Anthropic SDK request/response path is tested against a local fake of the Messages API, and
  the whole platform end-to-end with the mock model; run the app with your key and check **Analytics → System health**.
* Semantic (vector) search requires a Voyage AI key; without it, search is keyword-based.
* OAuth connectors are tested against mocked provider APIs; they need real client credentials to be exercised live.
* No native CRM connector yet — CRM updates go through the approval-gated webhook tool or spreadsheet exports.
* No OCR: scanned (image-only) PDFs are rejected with an explanation.
* Authentication is email + password; SSO, MFA, email verification and password reset are not implemented yet.
* Long documents are processed inside the upload request (≤ 300 s); very large files should be split.
