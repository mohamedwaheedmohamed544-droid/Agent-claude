// TEMPORARY test fixtures for the office scene preview (not real data). Deleted before hand-off.
import type { AgentPresence, AgentProfile, LayoutDepartment, OfficeLayoutSpec } from "@/lib/office/types";
import { AVATAR_PRESETS } from "@/lib/office/avatars";

const DEPTS: Array<[string, string, string, string]> = [
  ["research", "Research", "قسم البحث", "#2563eb"], ["bizdev", "Business development", "تطوير الأعمال", "#0d9488"],
  ["documents", "Documents", "قسم المستندات", "#7c3aed"], ["writing", "Writing studio", "استوديو الكتابة", "#db2777"],
  ["analytics", "Analytics", "قسم التحليلات", "#ea580c"], ["operations", "Operations", "قسم العمليات", "#16a34a"],
  ["marketing", "Marketing intelligence", "الذكاء التسويقي", "#ca8a04"], ["legal", "Legal", "الشؤون القانونية", "#475569"],
  ["finance", "Finance", "المالية", "#0891b2"], ["people", "People & culture", "الموارد البشرية", "#be123c"],
  ["support", "Customer support", "دعم العملاء", "#65a30d"], ["engineering", "Engineering", "الهندسة", "#4338ca"],
  ["design", "Design", "التصميم", "#c026d3"], ["procurement", "Procurement", "المشتريات", "#b45309"],
];
const NAMES: Array<[string, string]> = [
  ["باحث", "Baheth"], ["رائد", "Raed"], ["بيان", "Bayan"], ["قلم", "Qalam"], ["بصيرة", "Basira"], ["تميم", "Tamim"], ["أثر", "Athar"],
  ["سلمى", "Salma"], ["فهد", "Fahad"], ["نورة", "Noura"], ["خالد", "Khalid"], ["ريم", "Reem"], ["سعود", "Saud"], ["هيا", "Haya"],
  ["ماجد", "Majed"], ["لمى", "Lama"], ["ناصر", "Nasser"], ["دانة", "Dana"], ["عمر", "Omar"], ["جود", "Joud"], ["يوسف", "Yousef"],
  ["غادة", "Ghada"], ["طلال", "Talal"], ["منى", "Mona"], ["بدر", "Badr"],
];

export interface Fixture { layout: OfficeLayoutSpec; profiles: AgentProfile[]; presence: AgentPresence[] }

export function makeFixture(n: number, opts: { floors?: number; revision?: string } = {}): Fixture {
  const specialists = Math.max(0, n - 1);
  const deptCount = Math.min(DEPTS.length, Math.max(1, specialists <= 7 ? specialists : Math.ceil(specialists / 3.5)));
  const floors = opts.floors ?? (n > 40 ? 4 : n > 20 ? 2 : 1);
  const departments: LayoutDepartment[] = [{ key: "executive", name: "Executive office", nameAr: "المكتب التنفيذي", color: "#4f46e5", kind: "executive", floor: 0, managerSlug: "orchestrator", meetingRoomKey: "meeting_room", workstations: [{ id: "ws-exec-0", index: 0, agentSlug: "orchestrator" }] }];
  for (let i = 0; i < deptCount; i++) {
    const [key, name, nameAr, color] = DEPTS[i];
    departments.push({ key, name, nameAr, color, kind: "department", floor: Math.min(floors - 1, Math.floor((i * floors) / deptCount)), managerSlug: null, meetingRoomKey: null, workstations: [] });
  }
  const now = new Date().toISOString();
  const profiles: AgentProfile[] = [{
    slug: "orchestrator", nameAr: "راشد", nameEn: "Rashed", titleAr: "المنسّق الرئيسي", titleEn: "Chief Orchestrator", color: "#4f46e5",
    deskZone: "executive", workstationId: "ws-exec-0", appearance: AVATAR_PRESETS[0].appearance, defaultAnimation: "idle", isOrchestrator: true,
  }];
  for (let i = 0; i < specialists; i++) {
    const d = departments[1 + (i % deptCount)];
    const ws = { id: `ws-${d.key}-${d.workstations.length}`, index: d.workstations.length, agentSlug: `agent_${i + 1}` };
    d.workstations.push(ws);
    const [ar, en] = NAMES[i % NAMES.length];
    const k = Math.floor(i / NAMES.length);
    profiles.push({
      slug: ws.agentSlug, nameAr: k ? `${ar} ${k + 1}` : ar, nameEn: k ? `${en} ${k + 1}` : en, titleAr: "وكيل", titleEn: `${d.name} agent`, color: d.color,
      deskZone: d.key, workstationId: ws.id, appearance: AVATAR_PRESETS[1 + (i % (AVATAR_PRESETS.length - 1))].appearance,
      defaultAnimation: (["idle", "working", "reading", "thinking"] as const)[i % 4], isOrchestrator: false,
    });
  }
  const meetingRooms = Array.from({ length: floors }, (_, f) => ({ key: f === 0 ? "meeting_room" : `meeting_room_${f + 1}`, name: f === 0 ? "Meeting room" : `Meeting room ${f + 1}`, nameAr: f === 0 ? "قاعة الاجتماعات" : `قاعة الاجتماعات ${f + 1}`, floor: f, seats: n > 12 ? 12 : 9 }));
  const lounges = Array.from({ length: floors }, (_, f) => ({ key: f === 0 ? "lounge" : `lounge_${f + 1}`, floor: f }));
  const layout: OfficeLayoutSpec = {
    mode: floors > 1 ? "multi_floor" : n <= 4 ? "compact" : n <= 8 ? "standard" : n <= 12 ? "expanded" : "large", auto: true, floors,
    departments, meetingRooms, lounges, characterScale: 1, showLabels: true, ambientLounge: true,
    camera: { defaultView: "overview", autoRotate: false }, revision: opts.revision ?? `fx-${n}-${floors}`,
  };
  const presence: AgentPresence[] = profiles.map((p) => ({ agent: p.slug, status: "idle", zone: p.deskZone, activity: null, taskId: null, taskTitle: null, stepId: null, meetingId: null, waitingFor: null, since: now }));
  return { layout, profiles, presence };
}
