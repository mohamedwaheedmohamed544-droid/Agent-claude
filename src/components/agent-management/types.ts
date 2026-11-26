/** Client-side shapes of the Agent Management API (docs/AGENT_MANAGEMENT_API.md) plus pure helpers. */
import type {
  AgentDefinitionInput, AgentLifecycle, AgentRecord, AgentValidation, AgentVersionRecord, DepartmentRecord, SkillRecord,
} from "@/lib/agents/types";
import type { ActivityEvent, AgentPresence, AgentStatus, CharacterAppearance, MeetingSummary, OfficeLayoutSpec } from "@/lib/office/types";
import { AVATAR_BY_KEY, DEFAULT_AVATAR } from "@/lib/office/avatars";

export type { AgentDefinitionInput, AgentLifecycle, AgentRecord, AgentValidation, DepartmentRecord, SkillRecord };

export interface AgentStats { runs: number; completed: number; failed: number; lastRun: string | null; avgMs?: number | null }

export interface AgentListItem extends AgentRecord {
  departmentName: string | null;
  departmentNameAr: string | null;
  presence: AgentPresence | null;
  skillNames: string[];
  currentTask: { id: string; title: string } | null;
  stats: AgentStats;
}

export interface AgentCounts { total: number; active: number; working: number; idle: number; inMeetings: number; inactive: number; draft: number; archived: number }
export interface AgentListResponse { agents: AgentListItem[]; counts: AgentCounts }

export interface EffectiveTool { name: string; description: string; category: string; riskLevel: number; allowed: boolean; reason: string | null; requiresApproval: boolean }

export interface AgentDetail {
  agent: AgentRecord;
  versions: AgentVersionRecord[];
  presence: AgentPresence | null;
  skills: SkillRecord[];
  validation: AgentValidation;
  effectiveTools: EffectiveTool[];
  runtime: { version: number; systemPromptPreview: string; cachedAt: string | null };
  stats: AgentStats | null;
  recentSteps: Array<{ id: string; title: string; status: string; taskId: string; taskTitle: string; startedAt: string | null; completedAt: string | null }>;
  toolUsage: Array<{ tool: string; calls: number; succeeded: number }>;
  tasks: Array<{ taskId: string; taskTitle: string; stepTitle: string; status: string; updatedAt: string }>;
  conversations: Array<{ id: string; title: string; updatedAt: string }>;
  meetings: MeetingSummary[];
  memory: Array<{ id: string; kind: string; content: string; scope: string; createdAt: string }>;
  activity: ActivityEvent[];
  department: DepartmentRecord | null;
  workstation: { id: string; index: number } | null;
}

export interface ToolInfo {
  name: string; description: string; category: string; riskLevel: number;
  integration: string | null; integrationConnected: boolean | null; enabled?: boolean;
}

export interface ModelsResponse { models: Array<{ id: string; displayName: string }>; defaultModel: string; checked: boolean }

export interface OfficeSettings {
  layoutMode: "auto" | "compact" | "standard" | "expanded" | "large" | "multi_floor" | "custom";
  floors: number | null;
  meetingRooms: number | null;
  characterScale: number;
  showLabels: boolean;
  ambientLounge: boolean;
  camera: { defaultView: "overview" | "executive"; autoRotate: boolean };
  quality: "auto" | "high" | "low";
  voice: { enabled: boolean };
}
export interface OfficeSettingsResponse { settings: OfficeSettings; layout: OfficeLayoutSpec }

/** Task summary returned in `details.activeTasks` of a 409 `active_tasks` error (shape tolerant). */
export interface ActiveTaskRef { id?: string; taskId?: string; title?: string; taskTitle?: string; status?: string }

export const PRESENCE_STATUSES: AgentStatus[] = ["working", "thinking", "collaborating", "meeting", "waiting", "idle", "error", "paused"];
export const LIFECYCLES: AgentLifecycle[] = ["active", "draft", "inactive", "archived"];
export const SKILL_CATEGORIES = ["research", "analysis", "writing", "documents", "communication", "operations", "sales", "marketing", "finance", "procurement", "legal", "general"];
export const TOOL_CATEGORY_ORDER = ["knowledge", "memory", "web", "documents", "data", "operations", "communication", "integration"];

/** Preview of the technical ID the server will derive from the English name. */
export function slugPreview(nameEn: string): string {
  return nameEn.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
}

export function emptyConfig(departmentKey = ""): AgentDefinitionInput {
  return {
    nameAr: "", nameEn: "", roleTitle: "", roleTitleAr: "", description: "", descriptionAr: "", personality: "",
    color: "#4f46e5", capabilities: [],
    responsibilities: { main: "", instructions: "", expertise: [], deliverables: [], methodology: "", successCriteria: [] },
    ai: {
      provider: "anthropic", model: null, tier: "standard", temperature: null, systemInstructions: "",
      memory: { useWorkspaceMemory: true, useAgentMemory: true, useKnowledgeBase: true, maxContextTokens: 32000 },
    },
    tools: [],
    permissions: { maxRiskLevel: 2, alwaysApproveModify: true, restrictedCategories: [], memoryAccess: "own" },
    relationships: { supervisor: null, delegatesTo: [], collaboratesWith: [], canJoinMeetings: true, canInitiateCollaboration: false },
    office: {
      departmentKey, workstationId: null, avatarPreset: DEFAULT_AVATAR.key, appearance: { ...DEFAULT_AVATAR.appearance },
      defaultAnimation: "working", preferredMeetingRoom: null, visible: true,
    },
    skills: [],
  };
}

/** Deep-merges an (untrusted, possibly partial) config over the defaults so the builder always has every field. */
export function normalizeConfig(c: Partial<AgentDefinitionInput> | null | undefined): AgentDefinitionInput {
  const base = emptyConfig();
  if (!c || typeof c !== "object") return base;
  const preset = c.office?.avatarPreset ? AVATAR_BY_KEY.get(c.office.avatarPreset) : undefined;
  return {
    ...base, ...c,
    capabilities: Array.isArray(c.capabilities) ? c.capabilities : [],
    responsibilities: { ...base.responsibilities, ...(c.responsibilities ?? {}) },
    ai: { ...base.ai, ...(c.ai ?? {}), provider: "anthropic", memory: { ...base.ai.memory, ...(c.ai?.memory ?? {}) } },
    tools: Array.isArray(c.tools) ? c.tools : [],
    permissions: { ...base.permissions, ...(c.permissions ?? {}) },
    relationships: { ...base.relationships, ...(c.relationships ?? {}) },
    office: {
      ...base.office, ...(c.office ?? {}),
      appearance: { ...(preset?.appearance ?? base.office.appearance), ...(c.office?.appearance ?? {}) } as CharacterAppearance,
    },
    skills: Array.isArray(c.skills) ? c.skills : [],
  };
}

/** Strips server-only fields from a record so it can be edited and re-submitted. */
export function configOf(a: AgentRecord): AgentDefinitionInput {
  return normalizeConfig({
    nameAr: a.nameAr, nameEn: a.nameEn, roleTitle: a.roleTitle, roleTitleAr: a.roleTitleAr, description: a.description,
    descriptionAr: a.descriptionAr, personality: a.personality, color: a.color, capabilities: a.capabilities,
    responsibilities: a.responsibilities, ai: a.ai, tools: a.tools, permissions: a.permissions, relationships: a.relationships,
    office: a.office, skills: a.skills,
  });
}

export function localName(a: { nameAr: string; nameEn: string }, locale: string): string {
  return (locale === "ar" ? a.nameAr || a.nameEn : a.nameEn || a.nameAr) || "—";
}
export function localRole(a: { roleTitle: string; roleTitleAr: string }, locale: string): string {
  return locale === "ar" ? a.roleTitleAr || a.roleTitle : a.roleTitle || a.roleTitleAr;
}
export function localDept(d: { name: string; nameAr: string } | null | undefined, locale: string): string {
  if (!d) return "";
  return locale === "ar" ? d.nameAr || d.name : d.name || d.nameAr;
}
export function localSkill(s: { name: string; nameAr: string }, locale: string): string {
  return locale === "ar" ? s.nameAr || s.name : s.name || s.nameAr;
}

/** Normalises tasks listed in a 409 `active_tasks` error. */
export function activeTasksOf(details: unknown): Array<{ id: string; title: string; status: string | null }> {
  const list = (details as { activeTasks?: unknown } | null)?.activeTasks;
  if (!Array.isArray(list)) return [];
  return list.map((x: ActiveTaskRef, i) => ({
    id: String(x.taskId ?? x.id ?? i), title: String(x.title ?? x.taskTitle ?? x.taskId ?? x.id ?? "—"), status: x.status ?? null,
  }));
}

/** Server validation errors from an ApiError (400) — tolerant of `{ errors: [...] }` or zod-style `{ issues }`. */
export function fieldErrorsOf(details: unknown): Array<{ field: string; message: string }> {
  const d = details as { errors?: unknown; issues?: unknown } | null;
  const list = Array.isArray(d?.errors) ? d.errors : Array.isArray(d?.issues) ? d.issues : Array.isArray(details) ? details : [];
  return (list as Array<{ field?: unknown; path?: unknown; message?: unknown }>).map((e) => ({
    field: typeof e.field === "string" ? e.field : Array.isArray(e.path) ? e.path.join(".").replace(/^config\./, "") : "",
    message: String(e.message ?? ""),
  })).filter((e) => e.message);
}

export const DRAFT_STORAGE_KEY = "nexus.agentBuilderDraft";

export function stashDraft(config: AgentDefinitionInput, source: string): boolean {
  try { sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ config, source })); return true; } catch { return false; }
}
export function takeDraft(): { config: AgentDefinitionInput; source: string } | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    const v = JSON.parse(raw) as { config?: Partial<AgentDefinitionInput>; source?: string };
    return v.config ? { config: normalizeConfig(v.config), source: String(v.source ?? "draft") } : null;
  } catch { return null; }
}

/** Triggers a browser download of JSON data. */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
