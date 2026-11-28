# Company onboarding → Workforce Blueprint (Phase 1)

**Register → Understand the company → Analyse operations → Propose workforce → Review & approve → Connect systems → Activate.**

## Flow

1. **Questionnaire** (`/onboarding`, owners/admins). Six steps: identity, business model, teams, work & processes, systems, priorities.
   The questions are conditional (`src/lib/onboarding/schema.ts`). For example, recruitment is asked only of recruitment firms,
   tenders only of B2G/tender-led companies, customer support only of B2C/mixed businesses, and team size only of companies with 10+ employees.
   The server validates with the same rules and drops answers to questions the company was not asked.
2. **Company Operating Profile**: facts derived from the answers, each tagged `provided`, `inferred` or `needs_confirmation`.
3. **Workforce Blueprint** (`src/lib/onboarding/engine.ts`, deterministic, `rules-1`):
   * A role is recommended only when a *stated* answer triggers it (task, need, objective, challenge, channel or approval).
     Priorities add weight but never create agents on their own.
   * A department exists only for functions the customer runs or says they need and lack. Outsourced and not-relevant
     functions get none, and the proposal explains this in *Open questions*.
   * Starter agents are **reconfigured** rather than duplicated (e.g. باحث becomes the Research Analyst).
   * Least privilege: the risk ceiling never exceeds the role's needs, and generated agents get **no level-4 (external send) tools**.
     Connected-system tools are read-only and go only to roles that use them.
   * Approval points come from the customer's answers. Each one states how it is enforced:
     *platform rule*, *permissions*, *no tool exists*, or *agent instruction*.
   * Integrations: only systems with a working connector (Google Workspace, Microsoft 365) are marked *available*. All others
     are labelled *no connector yet*. Nothing is connected automatically.
   * Free text is recorded and shown, never interpreted silently. A custom rule is added verbatim to every agent's instructions.
4. **Review & edit**: remove or add agents, edit responsibilities, lower a risk ceiling, rename or remove departments, accept or reject
   integrations, and toggle non-platform approvals. Each edit is checked against the hash being viewed and re-derives permissions.
5. **Approve**: the confirmation dialog lists exactly which agents will be created, reconfigured and deactivated, and which
   departments will be added. Approval binds to the reviewed hash (`409 blueprint_changed` otherwise).
6. **Generation** (`src/lib/onboarding/store.ts`) goes through the normal agent registry, so validation, versioning, audit and the live
   office all apply. Starter agents and agents from earlier blueprints that are not in the new one are **deactivated** (reversible).
   Agents the customer built themselves are never touched. Generation is resumable after a failure.

## API

| Method | Path | Role |
|---|---|---|
| GET | `/api/onboarding` | any member (admins also get the impact preview) |
| PUT | `/api/onboarding` `{step, data}` | admin |
| POST | `/api/onboarding/skip` | admin |
| POST | `/api/onboarding/proposal` `{revisionNote?}` | admin |
| PATCH | `/api/onboarding/blueprints/:id` `{edit, baseHash}` | admin |
| POST | `/api/onboarding/blueprints/:id/approve` `{hash}` | admin |
| POST | `/api/onboarding/blueprints/:id/reject` `{note?}` | admin |

## Data

Migration `007_onboarding.sql` (additive; rollback SQL in its header): `company_profiles`, `workforce_blueprints`
(versioned, with hash, edit log, decision and generation report) and `workspaces.onboarding_status`.

## Not yet included (later phases)

* AI-assisted interpretation of free-text answers and revision notes. Revision currently means editing answers or the proposal and regenerating.
* Enforcing data classification on stored items (classification is recorded now; see BASELINE §6).
* Scheduled workflows (Workflow Studio, Phase 2). Starter workflows run on demand from the AI Workspace.
