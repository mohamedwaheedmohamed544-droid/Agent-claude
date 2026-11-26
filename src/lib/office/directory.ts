import { query, queryOne } from "../db";
import type { AgentDefinitionInput, AgentLifecycle } from "../agents/types";
import type { AgentProfile, LayoutDepartment, OfficeLayoutMode, OfficeLayoutSpec } from "./types";
import { createHash } from "node:crypto";

/** Lightweight agent directory for the office (names, colours, zones) — from the database. */
export interface DirectoryEntry {
  slug: string;
  nameAr: string;
  nameEn: string;
  titleEn: string;
  titleAr: string;
  color: string;
  lifecycle: AgentLifecycle;
  isOrchestrator: boolean;
  departmentKey: string | null;
  workstationId: string | null;
  visible: boolean;
  office: AgentDefinitionInput["office"] | null;
}

export async function getDirectory(workspaceId: string, opts: { includeDeleted?: boolean } = {}): Promise<DirectoryEntry[]> {
  return query<DirectoryEntry>(
    `SELECT a.slug, COALESCE(a.name_ar, a.name) AS "nameAr", a.name AS "nameEn", a.role_title AS "titleEn", a.role_title_ar AS "titleAr", a.color,
            a.lifecycle, a.is_orchestrator AS "isOrchestrator", d.key AS "departmentKey", w.id AS "workstationId",
            COALESCE((a.office->>'visible')::boolean, true) AS visible, a.office
       FROM agents a LEFT JOIN departments d ON d.id=a.department_id LEFT JOIN office_workstations w ON w.agent_id=a.id
      WHERE a.workspace_id=$1 ${opts.includeDeleted ? "" : "AND a.deleted_at IS NULL"}
      ORDER BY a.is_orchestrator DESC, a.created_at`, [workspaceId],
  );
}

/** Department zone of an agent (null if unknown). */
export async function zoneOf(workspaceId: string, slug: string): Promise<string | null> {
  const r = await queryOne<{ key: string }>(
    "SELECT d.key FROM agents a JOIN departments d ON d.id=a.department_id WHERE a.workspace_id=$1 AND a.slug=$2", [workspaceId, slug],
  );
  return r?.key ?? null;
}

/** The office workforce: active agents that are visible in the office. */
export function toProfiles(dir: DirectoryEntry[]): AgentProfile[] {
  return dir.filter((d) => d.lifecycle === "active" && d.visible && d.departmentKey && d.office).map((d) => ({
    slug: d.slug, nameAr: d.nameAr, nameEn: d.nameEn, titleAr: d.titleAr, titleEn: d.titleEn, color: d.color,
    deskZone: d.departmentKey!, workstationId: d.workstationId, appearance: d.office!.appearance,
    defaultAnimation: d.office!.defaultAnimation ?? "idle", isOrchestrator: d.isOrchestrator,
  }));
}

// ───────────────────────── Office settings & layout engine ─────────────────────────

export interface OfficeSettings {
  layoutMode: "auto" | OfficeLayoutMode;
  floors: number | null;
  meetingRooms: number | null;
  characterScale: number;
  showLabels: boolean;
  ambientLounge: boolean;
  camera: { defaultView: "overview" | "executive"; autoRotate: boolean };
  quality: "auto" | "high" | "low";
  voice: { enabled: boolean };
}

export const DEFAULT_OFFICE_SETTINGS: OfficeSettings = {
  layoutMode: "auto", floors: null, meetingRooms: null, characterScale: 1, showLabels: true, ambientLounge: true,
  camera: { defaultView: "overview", autoRotate: false }, quality: "auto", voice: { enabled: false },
};

export async function getOfficeSettings(workspaceId: string): Promise<OfficeSettings> {
  const row = await queryOne<{ settings: Partial<OfficeSettings> }>("SELECT settings FROM office_settings WHERE workspace_id=$1", [workspaceId]);
  const s = row?.settings ?? {};
  return { ...DEFAULT_OFFICE_SETTINGS, ...s, camera: { ...DEFAULT_OFFICE_SETTINGS.camera, ...(s.camera ?? {}) }, voice: { ...DEFAULT_OFFICE_SETTINGS.voice, ...(s.voice ?? {}) } };
}

/** Sizing thresholds (initial guidance, not limits). */
export function autoMode(agentCount: number): { mode: OfficeLayoutMode; floors: number } {
  if (agentCount <= 4) return { mode: "compact", floors: 1 };
  if (agentCount <= 8) return { mode: "standard", floors: 1 };
  if (agentCount <= 12) return { mode: "expanded", floors: 1 };
  if (agentCount <= 20) return { mode: "large", floors: 1 };
  if (agentCount <= 30) return { mode: "multi_floor", floors: 2 };
  return { mode: "multi_floor", floors: 2 + Math.ceil((agentCount - 30) / 16) };
}

/**
 * Computes the logical office plan from departments, workstations and visible active agents.
 * Floors are filled in department order (executive first) with roughly equal workstation counts.
 */
export async function computeLayoutSpec(workspaceId: string, profiles?: AgentProfile[]): Promise<OfficeLayoutSpec> {
  const settings = await getOfficeSettings(workspaceId);
  const visible = new Set((profiles ?? toProfiles(await getDirectory(workspaceId))).map((p) => p.slug));
  const depts = await query<{ key: string; name: string; name_ar: string; color: string; kind: "executive" | "department"; manager_slug: string | null; meeting_room_key: string | null }>(
    "SELECT key, name, name_ar, color, kind, manager_slug, meeting_room_key FROM departments WHERE workspace_id=$1 ORDER BY (kind='executive') DESC, sort, created_at", [workspaceId],
  );
  const stations = await query<{ id: string; idx: number; dept: string; slug: string | null; lifecycle: string | null }>(
    `SELECT w.id, w.idx, d.key AS dept, a.slug, a.lifecycle FROM office_workstations w JOIN departments d ON d.id=w.department_id
       LEFT JOIN agents a ON a.id=w.agent_id AND a.deleted_at IS NULL WHERE w.workspace_id=$1 ORDER BY w.idx`, [workspaceId],
  );
  const zones = await query<{ key: string; kind: string; name: string; name_ar: string; floor: number; seats: number }>(
    "SELECT key, kind, name, name_ar, floor, seats FROM office_zones WHERE workspace_id=$1 ORDER BY created_at", [workspaceId],
  );

  const count = visible.size;
  const auto = autoMode(count);
  const manual = settings.layoutMode !== "auto";
  const mode: OfficeLayoutMode = manual ? (settings.layoutMode as OfficeLayoutMode) : auto.mode;
  const floors = Math.max(1, Math.min(10, settings.floors ?? (manual && mode !== "multi_floor" ? 1 : auto.floors)));

  // Workstations shown: occupied by a visible agent, plus free desks (kept so departments don't shrink
  // and reshuffle every time an agent is deactivated). Every department shows at least one desk.
  const departments: LayoutDepartment[] = depts.map((d) => ({
    key: d.key, name: d.name, nameAr: d.name_ar, color: d.color, kind: d.kind, floor: 0, managerSlug: d.manager_slug, meetingRoomKey: d.meeting_room_key,
    workstations: stations.filter((s) => s.dept === d.key).map((s) => ({ id: s.id, index: s.idx, agentSlug: s.slug && visible.has(s.slug) ? s.slug : null })),
  }));
  for (const d of departments) if (!d.workstations.length) d.workstations.push({ id: `placeholder-${d.key}`, index: 0, agentSlug: null });

  // Distribute departments over floors (executive stays on floor 0).
  const total = departments.reduce((n, d) => n + d.workstations.length, 0);
  const perFloor = Math.max(1, Math.ceil(total / floors));
  let floor = 0;
  let load = 0;
  for (const d of departments) {
    if (d.kind !== "executive" && load + d.workstations.length > perFloor && floor < floors - 1 && load > 0) { floor++; load = 0; }
    d.floor = d.kind === "executive" ? 0 : floor;
    load += d.workstations.length;
  }

  // Meeting rooms: explicit zones first, then auto-generated so each floor has one (more for big teams).
  const wantRooms = Math.max(1, settings.meetingRooms ?? Math.max(floors, Math.ceil(count / 12)));
  const meetingRooms = zones.filter((z) => z.kind === "meeting_room").map((z) => ({ key: z.key, name: z.name, nameAr: z.name_ar, floor: Math.min(z.floor, floors - 1), seats: z.seats }));
  for (let i = meetingRooms.length; i < wantRooms; i++) {
    meetingRooms.push({ key: i === 0 ? "meeting_room" : `meeting_room_${i + 1}`, name: `Meeting room ${i + 1}`, nameAr: `قاعة الاجتماعات ${i + 1}`, floor: i % floors, seats: 9 });
  }
  const lounges = Array.from({ length: floors }, (_, f) => ({ key: f === 0 ? "lounge" : `lounge_${f + 1}`, floor: f }));

  const spec: Omit<OfficeLayoutSpec, "revision"> = {
    mode, auto: !manual, floors, departments, meetingRooms: meetingRooms.slice(0, Math.max(wantRooms, meetingRooms.length)), lounges,
    characterScale: Math.min(1.25, Math.max(0.8, settings.characterScale)), showLabels: settings.showLabels, ambientLounge: settings.ambientLounge,
    camera: settings.camera,
  };
  const revision = createHash("sha1").update(JSON.stringify({ ...spec, departments: spec.departments.map((d) => ({ ...d, workstations: d.workstations.map((w) => w.id) })) })).digest("hex").slice(0, 12);
  return { ...spec, revision };
}

/** Meeting room for a meeting: the first participant department's room, else the main room. */
export async function meetingRoomFor(workspaceId: string, participants: string[]): Promise<string> {
  const r = await queryOne<{ room: string | null }>(
    `SELECT d.meeting_room_key AS room FROM agents a JOIN departments d ON d.id=a.department_id
      WHERE a.workspace_id=$1 AND a.slug = ANY($2) AND d.meeting_room_key IS NOT NULL LIMIT 1`, [workspaceId, participants],
  );
  return r?.room ?? "meeting_room";
}
