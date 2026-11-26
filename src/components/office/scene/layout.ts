import type { OfficeZone } from "@/lib/office/types";

/**
 * Single source of truth for the Nexus Office floor plan (metres, y-up, +z = south / toward the default camera).
 * Rendering, navigation, behaviour and camera framing all read from this module.
 *
 * Yaw convention: a character with yaw θ faces (sin θ, cos θ) on the XZ plane. θ = 0 faces +z.
 */

export interface Vec2 { x: number; z: number }
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Spot { x: number; z: number; yaw: number }

export const FLOOR: Rect = { minX: -17, maxX: 17, minZ: -11, maxZ: 11 };
export const WALL_HEIGHT = 3.2;
export const LOW_WALL_HEIGHT = 0.95;
export const GLASS_HEIGHT = 2.7;
export const WALL_THICKNESS = 0.2;
export const GLASS_THICKNESS = 0.05;
export const CHAIR_SEAT_HEIGHT = 0.47;
export const SOFA_SEAT_HEIGHT = 0.42;
export const DESK_HEIGHT = 0.74;

export const OFFICE_ZONES: OfficeZone[] = [
  "executive", "research", "bizdev", "documents", "writing", "analytics", "operations", "marketing", "meeting_room", "lounge",
];

export const OFFICE_ZONE_LABELS: Record<OfficeZone, { en: string; ar: string }> = {
  executive: { en: "Executive office", ar: "المكتب التنفيذي" },
  research: { en: "Research", ar: "قسم البحث" },
  bizdev: { en: "Business development", ar: "تطوير الأعمال" },
  documents: { en: "Documents", ar: "قسم المستندات" },
  writing: { en: "Writing studio", ar: "استوديو الكتابة" },
  analytics: { en: "Analytics", ar: "قسم التحليلات" },
  operations: { en: "Operations", ar: "قسم العمليات" },
  marketing: { en: "Marketing intelligence", ar: "الذكاء التسويقي" },
  meeting_room: { en: "Meeting room", ar: "قاعة الاجتماعات" },
  lounge: { en: "Lounge", ar: "الاستراحة" },
};

export const ZONE_RECTS: Record<OfficeZone, Rect> = {
  research: { minX: -17, maxX: -6.5, minZ: -11, maxZ: -3.7 },
  bizdev: { minX: -17, maxX: -6.5, minZ: -3.7, maxZ: 3.7 },
  documents: { minX: -17, maxX: -6.5, minZ: 3.7, maxZ: 11 },
  analytics: { minX: 6.5, maxX: 17, minZ: -11, maxZ: -3.7 },
  operations: { minX: 6.5, maxX: 17, minZ: -3.7, maxZ: 3.7 },
  marketing: { minX: 6.5, maxX: 17, minZ: 3.7, maxZ: 11 },
  executive: { minX: -5, maxX: 5, minZ: -11, maxZ: -5.5 },
  meeting_room: { minX: -4.5, maxX: 4.5, minZ: -2.8, maxZ: 2.8 },
  writing: { minX: -6.5, maxX: 0, minZ: 4.6, maxZ: 11 },
  lounge: { minX: 0, maxX: 6.5, minZ: 4.6, maxZ: 11 },
};

export function forward(yaw: number): Vec2 { return { x: Math.sin(yaw), z: Math.cos(yaw) }; }
/** The character's right-hand side when facing `yaw`. */
export function right(yaw: number): Vec2 { return { x: -Math.cos(yaw), z: Math.sin(yaw) }; }
function off(p: Vec2, yaw: number, fwd: number, rgt = 0): Vec2 {
  const f = forward(yaw), r = right(yaw);
  return { x: p.x + f.x * fwd + r.x * rgt, z: p.z + f.z * fwd + r.z * rgt };
}

export function zoneAt(x: number, z: number): OfficeZone | null {
  // Enclosed rooms first, then open-plan departments.
  const order: OfficeZone[] = ["meeting_room", "executive", "writing", "lounge", "research", "bizdev", "documents", "analytics", "operations", "marketing"];
  for (const zone of order) {
    const r = ZONE_RECTS[zone];
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return zone;
  }
  return null;
}

// ───────────────────────── Walls & partitions ─────────────────────────

export type WallKind = "solid" | "glass" | "low";
export type WallSide = "north" | "west" | "east" | "south";
export interface WallSegment { a: Vec2; b: Vec2; kind: WallKind; side?: WallSide }

const P = (x: number, z: number): Vec2 => ({ x, z });

export const WALLS: WallSegment[] = [
  // Exterior shell. South façade is a low sill so the default camera sees in.
  { a: P(-17, -11), b: P(17, -11), kind: "solid", side: "north" },
  { a: P(-17, -11), b: P(-17, 11), kind: "solid", side: "west" },
  { a: P(17, -11), b: P(17, 11), kind: "solid", side: "east" },
  { a: P(-17, 11), b: P(17, 11), kind: "low", side: "south" },
  // Executive glass office (door in the south wall, x ∈ [-0.8, 0.8]).
  { a: P(-5, -11), b: P(-5, -5.5), kind: "glass" },
  { a: P(5, -11), b: P(5, -5.5), kind: "glass" },
  { a: P(-5, -5.5), b: P(-0.8, -5.5), kind: "glass" },
  { a: P(0.8, -5.5), b: P(5, -5.5), kind: "glass" },
  // Central meeting room: two doors in each long wall, at x ∈ [-3.7, -2.3] and [2.3, 3.7].
  { a: P(-4.5, -2.8), b: P(-3.7, -2.8), kind: "glass" },
  { a: P(-2.3, -2.8), b: P(2.3, -2.8), kind: "glass" },
  { a: P(3.7, -2.8), b: P(4.5, -2.8), kind: "glass" },
  { a: P(-4.5, 2.8), b: P(-3.7, 2.8), kind: "glass" },
  { a: P(-2.3, 2.8), b: P(2.3, 2.8), kind: "glass" },
  { a: P(3.7, 2.8), b: P(4.5, 2.8), kind: "glass" },
  { a: P(-4.5, -2.8), b: P(-4.5, 2.8), kind: "glass" },
  { a: P(4.5, -2.8), b: P(4.5, 2.8), kind: "glass" },
];

export const DOORWAYS: Array<{ a: Vec2; b: Vec2 }> = [
  { a: P(-0.8, -5.5), b: P(0.8, -5.5) },
  { a: P(-3.7, -2.8), b: P(-2.3, -2.8) },
  { a: P(2.3, -2.8), b: P(3.7, -2.8) },
  { a: P(-3.7, 2.8), b: P(-2.3, 2.8) },
  { a: P(2.3, 2.8), b: P(3.7, 2.8) },
];

export const WINDOWS: Array<{ side: WallSide; from: number; to: number }> = [
  { side: "north", from: -16.4, to: -12.8 },
  { side: "north", from: -8.4, to: -5.6 },
  { side: "north", from: 5.6, to: 9.6 },
  { side: "north", from: 10.6, to: 16.4 },
  { side: "west", from: -4.4, to: -3.0 },
  { side: "west", from: 3.0, to: 4.4 },
  { side: "east", from: -4.4, to: -3.0 },
  { side: "east", from: 3.0, to: 4.4 },
];

// ───────────────────────── Seats & desks ─────────────────────────

export type SeatKind = "chair" | "sofa";
export interface Seat {
  id: string;
  zone: OfficeZone;
  x: number; z: number; yaw: number;
  /** Where the character stands before sitting down / after standing up. */
  approach: Vec2;
  height: number;
  kind: SeatKind;
}

export interface DeskSpec {
  zone: OfficeZone;
  center: Vec2;
  yaw: number;           // yaw of the person sitting at it
  width: number;
  depth: number;
  monitors: number;
  seat: Seat;
  /** Idle standing spot beside the chair, facing the desk. */
  stand: Spot;
  /** Where a visitor stands to talk across the desk. */
  visit: Spot;
}

function makeDesk(zone: OfficeZone, seatX: number, seatZ: number, yaw: number, width: number, depth: number, monitors: number, side: 1 | -1): DeskSpec {
  const seatPos = P(seatX, seatZ);
  const center = off(seatPos, yaw, depth / 2 + 0.42);
  const approach = off(seatPos, yaw, 0, 0.72 * side);
  const visitPos = off(center, yaw, depth / 2 + 0.62);
  return {
    zone, center, yaw, width, depth, monitors,
    seat: { id: `desk-${zone}`, zone, x: seatX, z: seatZ, yaw, approach, height: CHAIR_SEAT_HEIGHT, kind: "chair" },
    stand: { x: approach.x, z: approach.z, yaw },
    visit: { x: visitPos.x, z: visitPos.z, yaw: yaw + Math.PI },
  };
}

const H = Math.PI / 2;
export const DESKS: DeskSpec[] = [
  makeDesk("executive", 0, -8.55, 0, 2.2, 0.95, 2, -1),
  makeDesk("research", -14.5, -7.4, H, 1.8, 0.8, 2, 1),
  makeDesk("bizdev", -14.5, 0, H, 1.8, 0.8, 2, 1),
  makeDesk("documents", -14.5, 7.4, H, 1.8, 0.8, 2, -1),
  makeDesk("analytics", 14.5, -7.4, -H, 2.1, 0.8, 3, -1),
  makeDesk("operations", 14.5, 0, -H, 1.8, 0.8, 2, -1),
  makeDesk("marketing", 14.5, 7.4, -H, 1.8, 0.8, 2, 1),
  makeDesk("writing", -3.2, 7.0, 0, 1.8, 0.8, 2, 1),
];
export const DESK_BY_ZONE = new Map(DESKS.map((d) => [d.zone, d]));

/** Unassigned secondary desks: the Documents review desk (paperwork) and the Operations monitoring console. */
export interface SecondaryDesk { zone: OfficeZone; center: Vec2; yaw: number; width: number; depth: number; monitors: number }
export const SECONDARY_DESKS: SecondaryDesk[] = [
  { zone: "documents", center: P(-10.4, 7.4), yaw: H, width: 1.6, depth: 0.8, monitors: 0 },
  { zone: "operations", center: P(10.6, 0), yaw: H, width: 1.6, depth: 0.8, monitors: 2 },
];
export const REVIEW_DESK = SECONDARY_DESKS[0];

function chairSeat(id: string, zone: OfficeZone, x: number, z: number, yaw: number, back = 0.42): Seat {
  return { id, zone, x, z, yaw, approach: off(P(x, z), yaw, -back), height: CHAIR_SEAT_HEIGHT, kind: "chair" };
}
function sofaSeat(id: string, x: number, z: number, yaw: number): Seat {
  return { id, zone: "lounge", x, z, yaw, approach: off(P(x, z), yaw, 0.58), height: SOFA_SEAT_HEIGHT, kind: "sofa" };
}

export const MEETING_TABLE = { center: P(0, 0), length: 5.2, width: 1.4 };
/** Head of the table (reserved for the orchestrator) faces the presentation screen on the east wall. */
export const MEETING_HEAD_SEAT: Seat = { ...chairSeat("meet-head", "meeting_room", -3.45, 0, H), approach: P(-3.45, 0.62) };
export const MEETING_SIDE_SEATS: Seat[] = [-1.8, -0.6, 0.6, 1.8].flatMap((x, i) => [
  chairSeat(`meet-n${i}`, "meeting_room", x, -1.32, 0),
  chairSeat(`meet-s${i}`, "meeting_room", x, 1.32, Math.PI),
]);
export const MEETING_SCREEN = { x: 4.4, z: 0, y: 1.55, width: 2.6, height: 1.46 };

export const SOFAS = [
  { center: P(3.25, 5.5), yaw: 0, width: 2.3 },
  { center: P(3.25, 9.1), yaw: Math.PI, width: 2.3 },
];
export const ARMCHAIRS = [
  { center: P(5.75, 7.3), yaw: -H, width: 0.95 },
  { center: P(0.75, 7.3), yaw: H, width: 0.95 },
];
export const LOUNGE_SEATS: Seat[] = [
  sofaSeat("lounge-a0", 2.5, 5.58, 0), sofaSeat("lounge-a1", 3.25, 5.58, 0), sofaSeat("lounge-a2", 4.0, 5.58, 0),
  sofaSeat("lounge-b0", 4.0, 9.02, Math.PI), sofaSeat("lounge-b1", 3.25, 9.02, Math.PI), sofaSeat("lounge-b2", 2.5, 9.02, Math.PI),
  sofaSeat("lounge-c", 5.67, 7.3, -H), sofaSeat("lounge-d", 0.83, 7.3, H),
];
export const COFFEE_TABLE = { center: P(3.25, 7.3), width: 1.3, depth: 0.65 };
export const COFFEE_BAR = { center: P(3.25, 10.45), width: 3.6, depth: 0.6 };

// ───────────────────────── Decor & displays ─────────────────────────

/** Department wall/freestanding displays (live text rendered onto canvas textures). */
export interface DisplaySpec { zone: OfficeZone; x: number; y: number; z: number; yaw: number; width: number; height: number; freestanding?: boolean }
export const DEPARTMENT_DISPLAYS: DisplaySpec[] = [
  { zone: "research", x: -16.87, y: 1.7, z: -7.4, yaw: H, width: 3.0, height: 1.69 },
  { zone: "bizdev", x: -16.87, y: 1.7, z: 0, yaw: H, width: 3.0, height: 1.69 },
  { zone: "documents", x: -16.87, y: 1.7, z: 7.4, yaw: H, width: 3.0, height: 1.69 },
  { zone: "analytics", x: 16.87, y: 1.7, z: -7.4, yaw: -H, width: 3.0, height: 1.69 },
  { zone: "operations", x: 16.87, y: 1.7, z: 0, yaw: -H, width: 3.0, height: 1.69 },
  { zone: "marketing", x: 16.87, y: 1.7, z: 7.4, yaw: -H, width: 3.0, height: 1.69 },
  { zone: "writing", x: -3.2, y: 1.45, z: 5.3, yaw: 0, width: 2.2, height: 1.24, freestanding: true },
];
export const EXECUTIVE_WALL = { x: 0, y: 1.95, z: -10.87, width: 7.6, height: 1.8 };

export const ZONE_RUGS: Array<{ zone: OfficeZone; center: Vec2; w: number; d: number }> = [
  { zone: "executive", center: P(0, -8.1), w: 6.4, d: 4.2 },
  { zone: "research", center: P(-13.4, -7.4), w: 4.6, d: 4.0 },
  { zone: "bizdev", center: P(-12.4, 0), w: 6.6, d: 4.0 },
  { zone: "documents", center: P(-12.4, 7.4), w: 6.6, d: 4.0 },
  { zone: "analytics", center: P(12.4, -7.4), w: 6.6, d: 4.2 },
  { zone: "operations", center: P(12.4, 0), w: 6.6, d: 4.0 },
  { zone: "marketing", center: P(12.4, 7.0), w: 6.6, d: 4.4 },
  { zone: "writing", center: P(-3.2, 7.6), w: 4.6, d: 3.4 },
  { zone: "lounge", center: P(3.25, 7.3), w: 5.6, d: 4.6 },
];

export interface BoxSpec { center: Vec2; w: number; d: number; h: number; yaw: number }
export const BOOKSHELF: BoxSpec = { center: P(-10.8, -10.5), w: 3.4, d: 0.4, h: 2.1, yaw: 0 };
export const WRITING_SHELF: BoxSpec = { center: P(-6.05, 9.6), w: 1.6, d: 0.4, h: 1.2, yaw: H };
export const CREDENZA: BoxSpec = { center: P(0, -10.55), w: 3.4, d: 0.45, h: 0.66, yaw: 0 };
export const FILING_CABINETS: BoxSpec[] = [
  { center: P(-16.6, 9.65), w: 0.6, d: 0.5, h: 1.3, yaw: H },
  { center: P(-16.6, 10.3), w: 0.6, d: 0.5, h: 1.3, yaw: H },
];
export const SERVER_RACKS: BoxSpec[] = [
  { center: P(16.45, -2.75), w: 0.65, d: 0.8, h: 2.0, yaw: -H },
  { center: P(16.45, 2.75), w: 0.65, d: 0.8, h: 2.0, yaw: -H },
];
export const MOOD_BOARD: BoxSpec = { center: P(10.0, 4.45), w: 2.0, d: 0.12, h: 1.5, yaw: 0 };
export const ROUND_TABLES = [
  { center: P(-10.2, 0), radius: 0.55 },
  { center: P(10.3, -7.4), radius: 0.55 },
  { center: P(10.3, 7.6), radius: 0.55 },
];
export const EXTRA_CHAIRS: Spot[] = [
  ...ROUND_TABLES.flatMap((t) => [{ x: t.center.x, z: t.center.z - 0.95, yaw: 0 }, { x: t.center.x, z: t.center.z + 0.95, yaw: Math.PI }]),
  { x: -0.85, z: -6.55, yaw: Math.PI }, { x: 0.85, z: -6.55, yaw: Math.PI },
  { x: -9.65, z: 7.4, yaw: -H },
  { x: 9.78, z: 0, yaw: H },
];
export const PLANTERS: BoxSpec[] = [
  { center: P(-16.05, -3.7), w: 1.5, d: 0.45, h: 0.55, yaw: 0 },
  { center: P(-16.05, 3.7), w: 1.5, d: 0.45, h: 0.55, yaw: 0 },
  { center: P(16.05, -3.7), w: 1.5, d: 0.45, h: 0.55, yaw: 0 },
  { center: P(16.05, 3.7), w: 1.5, d: 0.45, h: 0.55, yaw: 0 },
];
export const PLANTS: Array<{ x: number; z: number; scale: number }> = [
  { x: -4.4, z: -10.35, scale: 1.1 }, { x: 4.4, z: -10.35, scale: 1.1 },
  { x: -4.05, z: -1.9, scale: 0.8 }, { x: -4.05, z: 1.9, scale: 0.8 },
  { x: -16.4, z: -10.4, scale: 1.15 }, { x: 16.4, z: -10.4, scale: 1.15 },
  { x: 16.4, z: 10.4, scale: 1.0 }, { x: -6.0, z: 10.4, scale: 1.0 },
  { x: 0.55, z: 10.4, scale: 0.95 }, { x: 6.05, z: 5.1, scale: 0.9 },
  { x: -7.2, z: -5.0, scale: 0.9 }, { x: 7.2, z: -5.0, scale: 0.9 },
  { x: 11.0, z: -10.4, scale: 1.0 }, { x: -8.4, z: 10.4, scale: 0.95 },
];
export const PENDANTS: Vec2[] = [P(-1.6, 0), P(0, 0), P(1.6, 0), P(3.25, 7.3)];

// ───────────────────────── Navigation obstacles ─────────────────────────

function orientedRect(center: Vec2, w: number, d: number, yaw: number): Rect {
  // Yaws in this layout are multiples of 90°: swap extents when rotated a quarter turn.
  const quarter = Math.abs(Math.round(yaw / H)) % 2 === 1;
  const hw = (quarter ? d : w) / 2, hd = (quarter ? w : d) / 2;
  return { minX: center.x - hw, maxX: center.x + hw, minZ: center.z - hd, maxZ: center.z + hd };
}

export const OBSTACLES: Rect[] = [
  ...DESKS.map((d) => orientedRect(d.center, d.width, d.depth, d.yaw)),
  ...SECONDARY_DESKS.map((d) => orientedRect(d.center, d.width, d.depth, d.yaw)),
  orientedRect(MEETING_TABLE.center, MEETING_TABLE.length, MEETING_TABLE.width, 0),
  ...SOFAS.map((s) => orientedRect(s.center, s.width, 0.9, s.yaw)),
  ...ARMCHAIRS.map((s) => orientedRect(s.center, s.width, 0.85, s.yaw)),
  orientedRect(COFFEE_TABLE.center, COFFEE_TABLE.width, COFFEE_TABLE.depth, 0),
  orientedRect(COFFEE_BAR.center, COFFEE_BAR.width, COFFEE_BAR.depth, 0),
  ...[BOOKSHELF, WRITING_SHELF, CREDENZA, MOOD_BOARD, ...FILING_CABINETS, ...SERVER_RACKS, ...PLANTERS].map((b) => orientedRect(b.center, b.w, b.d, b.yaw)),
  ...ROUND_TABLES.map((t) => orientedRect(t.center, t.radius * 2, t.radius * 2, 0)),
  ...DEPARTMENT_DISPLAYS.filter((d) => d.freestanding).map((d) => orientedRect(P(d.x, d.z), d.width, 0.2, d.yaw)),
  ...PLANTS.map((p) => orientedRect(P(p.x, p.z), 0.5 * p.scale, 0.5 * p.scale, 0)),
];

// ───────────────────────── Camera framing ─────────────────────────

/** Rect framed by the camera for a department view, or the whole floor. */
export function framingRect(zone: OfficeZone | null): Rect {
  if (!zone) return { minX: FLOOR.minX + 1, maxX: FLOOR.maxX - 1, minZ: FLOOR.minZ, maxZ: FLOOR.maxZ };
  return ZONE_RECTS[zone];
}
