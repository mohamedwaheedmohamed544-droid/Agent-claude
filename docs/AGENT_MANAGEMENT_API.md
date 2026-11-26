# Agent Management API (contract)

Types: `src/lib/agents/types.ts` (AgentDefinitionInput, AgentRecord, SkillRecord, TemplateRecord,
DepartmentRecord, AgentValidation, AgentDraftProposal) and `src/lib/office/types.ts` (OfficeLayoutSpec,
AgentStatus, AgentPresence). Avatar library: `src/lib/office/avatars.ts`.

All routes are workspace-scoped. **Every mutation requires role admin or owner** (enforced on the server) and is
audit-logged. Errors: `{ error: { code, message, details? } }`.

## Agents

| Method & path | Body / query | Response |
|---|---|---|
| `GET /api/agents` | `?lifecycle=active\|inactive\|draft\|archived\|all` (default: all except archived), `?department=key`, `?q=` | `{ agents: AgentListItem[], counts }` |
| `POST /api/agents` | `{ config: AgentDefinitionInput, lifecycle?: "draft"\|"active", templateKey?: string }` | `201 { agent: AgentRecord }` |
| `GET /api/agents/:slug` | — | `AgentDetail` (below) |
| `PATCH /api/agents/:slug` | `{ config: Partial<AgentDefinitionInput>, changeNote?: string }` | `{ agent }` (creates a new immutable version) |
| `POST /api/agents/:slug/lifecycle` | `{ action: "activate"\|"deactivate"\|"archive"\|"restore", force?: boolean }` | `{ agent, affectedTasks }` · `409 code:"active_tasks"` with `details.activeTasks` when archiving an agent with running/planned work and `force` is not set (force cancels those tasks) |
| `DELETE /api/agents/:slug?confirm=<slug>` | `confirm` must equal the slug | `{ ok: true }` — soft delete (row kept as a tombstone so history and slugs stay valid; not restorable). `403` for the orchestrator, `409 code:"active_tasks"` when it has active work |
| `POST /api/agents/:slug/duplicate` | `{ nameAr?, nameEn? }` | `201 { agent }` (created as **draft**) |
| `GET /api/agents/:slug/export` | — | JSON download `{ format: "nexus-agent", version: 1, exportedAt, config: AgentDefinitionInput }` |
| `POST /api/agents/import` | `{ data: <exported JSON> , lifecycle?: "draft"\|"active" }` | `201 { agent }` |
| `POST /api/agents/validate` | `{ config: AgentDefinitionInput, slug?: string }` | `AgentValidation` |
| `POST /api/agents/draft` | `{ prompt: string }` | `AgentDraftProposal` — **never saves**; the UI shows it in the builder and the user confirms with `POST /api/agents` |
| `POST /api/agents/bulk` | `{ slugs: string[], action: "activate"\|"deactivate" }` | `{ results: Array<{ slug, ok, error? }> }` (orchestrator is skipped) |
| `GET /api/agents/models` | — | `{ models: Array<{ id, displayName }>, defaultModel, checked: boolean }` — models available to the Anthropic account |

`AgentListItem = AgentRecord & { departmentName, departmentNameAr, presence: AgentPresence | null, skillNames: string[], currentTask: { id, title } | null, stats: { runs, completed, failed, lastRun } }`

`counts = { total, active, working, idle, inMeetings, inactive, draft, archived }` (total excludes archived)

`AgentDetail = { agent: AgentRecord, versions: AgentVersionRecord[], presence: AgentPresence | null, skills: SkillRecord[] (assigned, resolved), validation: AgentValidation, effectiveTools: Array<{ name, description, category, riskLevel, allowed: boolean, reason: string | null, requiresApproval: boolean }>, runtime: { version, systemPromptPreview: string, cachedAt: string | null }, stats, recentSteps, toolUsage, tasks: Array<{ taskId, taskTitle, stepTitle, status, updatedAt }>, conversations: Array<{ id, title, updatedAt }>, meetings: MeetingSummary[], memory: Array<{ id, kind, content, scope, createdAt }>, activity: ActivityEvent[], department: DepartmentRecord | null, workstation: { id, index } | null }`

## Skills registry

| Method & path | Body | Response |
|---|---|---|
| `GET /api/skills` | — | `{ skills: SkillRecord[] }` (built-in + workspace custom, with `agentCount`) |
| `POST /api/skills` | `{ name, nameAr, description, category, instructions, requiredTools: string[], dependsOn: string[], key? }` | `201 { skill }` |
| `PATCH /api/skills/:key` | partial of the above (custom skills only) | `{ skill }` |
| `DELETE /api/skills/:key` | — | custom only; `409` if assigned to agents |

Skills add instructions and declare required tools; they **never grant tools or permissions**. A skill whose
required tools are not in the agent's tool list shows as a missing dependency.

## Templates

| Method & path | Body | Response |
|---|---|---|
| `GET /api/agent-templates` | — | `{ templates: TemplateRecord[] }` (12 built-in + custom) |
| `POST /api/agent-templates` | `{ fromAgent?: slug, config?: AgentDefinitionInput, name, nameAr, description, category? }` | `201 { template }` |
| `DELETE /api/agent-templates/:key` | — | custom only |

## Departments

| Method & path | Body | Response |
|---|---|---|
| `GET /api/departments` | — | `{ departments: DepartmentRecord[] }` |
| `POST /api/departments` | `{ name, nameAr, color, managerSlug?, meetingRoomKey? }` | `201 { department }` |
| `PATCH /api/departments/:key` | `{ name?, nameAr?, color?, managerSlug?, meetingRoomKey?, sort? }` | `{ department }` |
| `DELETE /api/departments/:key` | — | only when empty; the executive department cannot be deleted |

Move an agent between departments with `PATCH /api/agents/:slug { config: { office: { …, departmentKey } } }` —
a workstation is (re)allocated automatically.

## Office layout & settings

| Method & path | Body | Response |
|---|---|---|
| `GET /api/office/settings` | — | `{ settings: OfficeSettings, layout: OfficeLayoutSpec }` |
| `PATCH /api/office/settings` | partial `OfficeSettings` | `{ settings, layout }` |

`OfficeSettings = { layoutMode: "auto" | "compact" | "standard" | "expanded" | "large" | "multi_floor" | "custom", floors: number | null (null = auto), meetingRooms: number | null, characterScale: number, showLabels: boolean, ambientLounge: boolean, camera: { defaultView: "overview" | "executive", autoRotate: boolean }, quality: "auto" | "high" | "low", voice: { enabled: boolean } }`

Automatic sizing (by visible active agents): 1–4 compact · 5–8 standard · 9–12 expanded · 13–20 large ·
21–30 multi-floor (2 floors) · 31+ multi-floor (one more floor per 16 agents). Thresholds are not limits.

## Live updates

The office SSE stream (`/api/office/stream`) emits workforce events with `payload.slug`:
`agent_created`, `agent_updated`, `agent_activated`, `agent_deactivated`, `agent_archived`, `agent_restored`,
`agent_deleted`, `agent_moved`, `office_layout_changed`. Clients reload `/api/office/state` (profiles + layout)
and apply the change incrementally.
