import type { LayoutDepartment, OfficeLayoutSpec, OfficeZone } from "@/lib/office/types";

/**
 * Deterministic office layout engine. Turns the server's logical `OfficeLayoutSpec` (departments,
 * workstations, meeting rooms, lounges, floors) into concrete floor plans: walls, glass rooms, desks,
 * seats, furniture, signage, navigation obstacles and the elevator core.
 *
 * Rules
 * - Pure: the same spec always yields the same plan. No randomness, no dependency on agents' state.
 * - Each floor is packed as rows of "pods" in a fixed order — core, executive offices, departments
 *   (spec order), meeting rooms, lounges — left to right, wrapping to a new row at the floor width.
 *   Floor width is fixed per size tier, so growing one pod can only shift pods that come after it.
 * - Pods size themselves to their content: a department with N workstations gets an N-desk cluster
 *   (up to 4 desks per row, unlimited rows); meeting tables are sized to their seat count.
 * - Desks keep identity by workstation id, so a character always sits at its own desk.
 *
 * Coordinates are floor-local metres: x ∈ [-W/2, W/2] (east +), z ∈ [0, D] (south +, toward the default camera).
 * Yaw convention: a character with yaw θ faces (sin θ, cos θ); θ = 0 faces +z.
 */

export interface Vec2 { x: number; z: number }
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Spot { x: number; z: number; yaw: number }
export interface BoxSpec { center: Vec2; w: number; d: number; h: number; yaw: number }

export const WALL_HEIGHT = 3.2;
export const LOW_WALL_HEIGHT = 0.95;
export const GLASS_HEIGHT = 2.7;
export const PARTITION_HEIGHT = 2.7;
export const WALL_THICKNESS = 0.2;
export const GLASS_THICKNESS = 0.05;
export const CHAIR_SEAT_HEIGHT = 0.47;
export const SOFA_SEAT_HEIGHT = 0.42;
export const DESK_HEIGHT = 0.74;
/** Horizontal gap between floors in the exploded "all floors" view. */
export const FLOOR_GAP = 10;

export type WallKind = "solid" | "glass" | "low" | "partition";
export type WallSide = "north" | "west" | "east" | "south";
export interface WallSegment { a: Vec2; b: Vec2; kind: WallKind; side?: WallSide }

export type SeatKind = "chair" | "sofa";
export interface Seat {
  id: string;
  zone: OfficeZone;
  floor: number;
  x: number; z: number; yaw: number;
  /** Where the character stands before sitting down / after standing up. */
  approach: Vec2;
  height: number;
  kind: SeatKind;
}

export interface DeskPlan {
  /** Workstation id (stable identity). */
  id: string;
  zone: OfficeZone;
  floor: number;
  index: number;
  agentSlug: string | null;
  center: Vec2;
  yaw: number;
  width: number;
  depth: number;
  monitors: number;
  seat: Seat;
  /** Idle standing spot beside the chair, facing the desk. */
  stand: Spot;
  /** Where a visitor stands to talk across the desk. */
  visit: Spot;
}

export type ZoneKind = "executive" | "department" | "meeting" | "lounge";
export interface ZoneInfo { key: OfficeZone; floor: number; kind: ZoneKind; rect: Rect; name: string; nameAr: string; color: string; meetingRoomKey: string | null }

export interface MeetingRoomPlan {
  key: string;
  floor: number;
  rect: Rect;
  table: { center: Vec2; length: number; width: number };
  head: Seat;
  sides: Seat[];
}

export interface LoungePlan { key: string; floor: number; rect: Rect; seats: Seat[] }

export interface Display { zone: OfficeZone; x: number; y: number; z: number; yaw: number; width: number; height: number; freestanding: boolean }

export interface FloorPlan {
  index: number;
  bounds: Rect;
  walls: WallSegment[];
  doorways: Array<{ a: Vec2; b: Vec2 }>;
  windows: Array<{ side: Exclude<WallSide, "south">; from: number; to: number }>;
  obstacles: Rect[];
  desks: DeskPlan[];
  chairs: Spot[];
  sofas: Array<{ center: Vec2; yaw: number; width: number }>;
  coffeeTables: Array<{ center: Vec2; w: number; d: number }>;
  bars: BoxSpec[];
  tables: Array<{ center: Vec2; length: number; width: number }>;
  credenzas: BoxSpec[];
  plants: Array<{ x: number; z: number; scale: number }>;
  pendants: Vec2[];
  rugs: Array<{ zone: OfficeZone; center: Vec2; w: number; d: number; color: string }>;
  /** Department signs (freestanding screens with live roster). */
  signs: Display[];
  /** Live operations walls inside executive offices. */
  execWalls: Display[];
  meetingScreens: Display[];
  /** Elevator / stair core (multi-floor only). */
  core: Rect | null;
  coreSpot: Spot | null;
  /** Ground-floor entrance (spawn / exit point). */
  entrance: Spot | null;
}

export interface OfficePlan {
  revision: string;
  floors: FloorPlan[];
  width: number;
  zones: Map<OfficeZone, ZoneInfo>;
  desks: Map<string, DeskPlan>;
  deptDesks: Map<OfficeZone, DeskPlan[]>;
  meetingRooms: Map<string, MeetingRoomPlan>;
  lounges: Map<string, LoungePlan>;
}

export function forward(yaw: number): Vec2 { return { x: Math.sin(yaw), z: Math.cos(yaw) }; }
/** The character's right-hand side when facing `yaw`. */
export function right(yaw: number): Vec2 { return { x: -Math.cos(yaw), z: Math.sin(yaw) }; }
function off(p: Vec2, yaw: number, fwd: number, rgt = 0): Vec2 {
  const f = forward(yaw), r = right(yaw);
  return { x: p.x + f.x * fwd + r.x * rgt, z: p.z + f.z * fwd + r.z * rgt };
}
const P = (x: number, z: number): Vec2 => ({ x, z });
const H = Math.PI / 2;

export function rectOf(center: Vec2, w: number, d: number, yaw = 0): Rect {
  const quarter = Math.abs(Math.round(yaw / H)) % 2 === 1;
  const hw = (quarter ? d : w) / 2, hd = (quarter ? w : d) / 2;
  return { minX: center.x - hw, maxX: center.x + hw, minZ: center.z - hd, maxZ: center.z + hd };
}
export const rectCenter = (r: Rect): Vec2 => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });

/** Localised display name for any zone key (department, meeting room or lounge). */
export function zoneLabel(layout: OfficeLayoutSpec, key: OfficeZone, locale: "en" | "ar"): string {
  const d = layout.departments.find((x) => x.key === key);
  if (d) return locale === "ar" ? d.nameAr || d.name : d.name;
  const m = layout.meetingRooms.find((x) => x.key === key);
  if (m) return locale === "ar" ? m.nameAr || m.name : m.name;
  if (layout.lounges.some((l) => l.key === key)) {
    const n = /_(\d+)$/.exec(key)?.[1];
    return locale === "ar" ? `الاستراحة${n ? ` ${n}` : ""}` : `Lounge${n ? ` ${n}` : ""}`;
  }
  return key;
}

// ───────────────────────── Pod builders ─────────────────────────

const UNIT_W = 2.2;
const UNIT_D = 2.8;
const GAP_X = 1.8;
const GAP_Z = 2.2;
const MARGIN = 1.3;

interface Pod {
  w: number;
  d: number;
  /** Writes the pod's contents into the floor plan with its north-west corner at (x0, z0). */
  build: (fp: FloorPlan, plan: OfficePlan, x0: number, z0: number) => void;
}

function deskColumns(n: number) { return n <= 4 ? Math.max(1, n) : Math.min(4, Math.ceil(n / 2)); }

function makeDesk(dept: LayoutDepartment, ws: LayoutDepartment["workstations"][number], floor: number, seatX: number, seatZ: number, yaw: number, width: number, depth: number, monitors: number): DeskPlan {
  const seatPos = P(seatX, seatZ);
  const center = off(seatPos, yaw, depth / 2 + 0.42);
  const approach = off(seatPos, yaw, 0, -0.72); // stand on the character's left (east when facing south)
  const visitPos = off(center, yaw, depth / 2 + 0.62);
  return {
    id: ws.id, zone: dept.key, floor, index: ws.index, agentSlug: ws.agentSlug, center, yaw, width, depth, monitors,
    seat: { id: `ws:${ws.id}`, zone: dept.key, floor, x: seatX, z: seatZ, yaw, approach, height: CHAIR_SEAT_HEIGHT, kind: "chair" },
    stand: { x: approach.x, z: approach.z, yaw },
    visit: { x: visitPos.x, z: visitPos.z, yaw: yaw + Math.PI },
  };
}

function registerDesk(fp: FloorPlan, plan: OfficePlan, desk: DeskPlan) {
  fp.desks.push(desk);
  fp.chairs.push({ x: desk.seat.x, z: desk.seat.z, yaw: desk.seat.yaw });
  fp.obstacles.push(rectOf(desk.center, desk.width, desk.depth, desk.yaw));
  plan.desks.set(desk.id, desk);
  const list = plan.deptDesks.get(desk.zone) ?? [];
  list.push(desk);
  plan.deptDesks.set(desk.zone, list);
}

function plant(fp: FloorPlan, x: number, z: number, scale = 1) {
  fp.plants.push({ x, z, scale });
  fp.obstacles.push(rectOf(P(x, z), 0.5 * scale, 0.5 * scale));
}

/** Rectangular glass room; `doors` are [fromX, toX] gaps in the south (and optionally north) wall. */
function glassRoom(fp: FloorPlan, r: Rect, southDoors: Array<[number, number]>, northDoors: Array<[number, number]> | "solid") {
  const along = (z: number, doors: Array<[number, number]>, kind: WallKind) => {
    let x = r.minX;
    for (const [a, b] of [...doors].sort((p, q) => p[0] - q[0])) {
      if (a > x) fp.walls.push({ a: P(x, z), b: P(a, z), kind });
      fp.doorways.push({ a: P(a, z), b: P(b, z) });
      x = b;
    }
    if (x < r.maxX) fp.walls.push({ a: P(x, z), b: P(r.maxX, z), kind });
  };
  along(r.maxZ, southDoors, "glass");
  if (northDoors === "solid") fp.walls.push({ a: P(r.minX, r.minZ), b: P(r.maxX, r.minZ), kind: "partition" });
  else along(r.minZ, northDoors, "glass");
  fp.walls.push({ a: P(r.minX, r.minZ), b: P(r.minX, r.maxZ), kind: "glass" });
  fp.walls.push({ a: P(r.maxX, r.minZ), b: P(r.maxX, r.maxZ), kind: "glass" });
}

function zoneInfo(plan: OfficePlan, key: string, floor: number, kind: ZoneKind, rect: Rect, name: string, nameAr: string, color: string, meetingRoomKey: string | null = null) {
  plan.zones.set(key, { key, floor, kind, rect, name, nameAr, color, meetingRoomKey });
}

function departmentPod(dept: LayoutDepartment, floor: number): Pod {
  const ws = [...dept.workstations].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  const n = ws.length;
  const cols = deskColumns(n);
  const rows = Math.ceil(n / cols);
  const w = Math.max(4.4, cols * UNIT_W + 1.4);
  const d = Math.max(3.4, rows * UNIT_D + 1.9);
  return {
    w, d,
    build(fp, plan, x0, z0) {
      const rect: Rect = { minX: x0, maxX: x0 + w, minZ: z0, maxZ: z0 + d };
      zoneInfo(plan, dept.key, floor, "department", rect, dept.name, dept.nameAr, dept.color, dept.meetingRoomKey);
      fp.rugs.push({ zone: dept.key, center: rectCenter(rect), w: w - 0.2, d: d - 0.2, color: dept.color });
      // Department sign (live roster screen) along the north edge.
      const signW = Math.min(w - 1.4, 3.2);
      fp.signs.push({ zone: dept.key, x: x0 + w / 2, y: 1.45, z: z0 + 0.45, yaw: 0, width: signW, height: signW * 0.42, freestanding: true });
      fp.obstacles.push(rectOf(P(x0 + w / 2, z0 + 0.45), signW, 0.3));
      const gridW = cols * UNIT_W;
      const gx0 = x0 + (w - gridW) / 2;
      ws.forEach((station, k) => {
        const c = k % cols, rr = Math.floor(k / cols);
        const seatX = gx0 + c * UNIT_W + UNIT_W / 2 + 0.15;
        const seatZ = z0 + 1.3 + rr * UNIT_D + 0.45;
        registerDesk(fp, plan, makeDesk(dept, station, floor, seatX, seatZ, 0, 1.6, 0.8, 2));
      });
      plant(fp, x0 + 0.35, z0 + 0.35, 0.9);
      plant(fp, x0 + w - 0.35, z0 + 0.35, 0.9);
    },
  };
}

function executivePod(dept: LayoutDepartment, floor: number): Pod {
  const ws = [...dept.workstations].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  const n = Math.max(1, ws.length);
  const cols = Math.min(3, n);
  const rows = Math.ceil(n / cols);
  const w = Math.max(8, cols * 2.8 + 2.4);
  const d = 2.4 + rows * 3.0 + 1.6;
  return {
    w, d,
    build(fp, plan, x0, z0) {
      const rect: Rect = { minX: x0, maxX: x0 + w, minZ: z0, maxZ: z0 + d };
      const cx = x0 + w / 2;
      zoneInfo(plan, dept.key, floor, "executive", rect, dept.name, dept.nameAr, dept.color, dept.meetingRoomKey);
      glassRoom(fp, rect, [[cx - 0.8, cx + 0.8]], "solid");
      fp.rugs.push({ zone: dept.key, center: P(cx, z0 + d / 2 - 0.2), w: w - 1.2, d: d - 1.4, color: dept.color });
      const wallW = Math.min(w - 1.4, 7.6);
      fp.execWalls.push({ zone: dept.key, x: cx, y: 1.95, z: z0 + 0.13, yaw: 0, width: wallW, height: Math.min(1.8, wallW * 0.3), freestanding: false });
      const cred: BoxSpec = { center: P(cx, z0 + 0.45), w: Math.min(3.4, w - 2), d: 0.45, h: 0.66, yaw: 0 };
      fp.credenzas.push(cred);
      fp.obstacles.push(rectOf(cred.center, cred.w, cred.d));
      const gridW = cols * 2.8;
      const gx0 = cx - gridW / 2;
      ws.forEach((station, k) => {
        const c = k % cols, rr = Math.floor(k / cols);
        const seatX = gx0 + c * 2.8 + 1.4;
        const seatZ = z0 + 2.1 + rr * 3.0;
        const desk = makeDesk(dept, station, floor, seatX, seatZ, 0, cols === 1 ? 2.2 : 1.9, 0.95, 2);
        registerDesk(fp, plan, desk);
        if (rr === rows - 1) {
          // Guest chairs facing the desk, either side of the visitor spot.
          fp.chairs.push({ x: desk.visit.x - 0.85, z: desk.visit.z + 0.02, yaw: Math.PI }, { x: desk.visit.x + 0.85, z: desk.visit.z + 0.02, yaw: Math.PI });
        }
      });
      plant(fp, x0 + 0.55, z0 + 0.6, 1.05);
      plant(fp, x0 + w - 0.55, z0 + 0.6, 1.05);
    },
  };
}

function meetingPod(room: OfficeLayoutSpec["meetingRooms"][number]): Pod {
  const seats = Math.max(3, room.seats);
  const sideCount = seats - 1;
  const perSide = Math.ceil(sideCount / 2);
  const length = Math.max(2.4, perSide * 1.2 + 0.4);
  const tableW = 1.4;
  const w = length + 3.6;
  const d = 5.6;
  return {
    w, d,
    build(fp, plan, x0, z0) {
      const rect: Rect = { minX: x0, maxX: x0 + w, minZ: z0, maxZ: z0 + d };
      zoneInfo(plan, room.key, room.floor, "meeting", rect, room.name, room.nameAr, "#8b5cf6");
      const doorA: [number, number] = [x0 + 0.5, x0 + 1.9];
      const doorB: [number, number] = [x0 + w - 1.9, x0 + w - 0.5];
      glassRoom(fp, rect, [doorA, doorB], [doorA, doorB]);
      const tcx = x0 + 2.0 + length / 2, tcz = z0 + d / 2;
      const table = { center: P(tcx, tcz), length, width: tableW };
      fp.tables.push(table);
      fp.obstacles.push(rectOf(table.center, length, tableW));
      const head: Seat = {
        id: `${room.key}:head`, zone: room.key, floor: room.floor, x: tcx - length / 2 - 0.85, z: tcz, yaw: H,
        approach: P(tcx - length / 2 - 0.85, tcz + 0.62), height: CHAIR_SEAT_HEIGHT, kind: "chair",
      };
      const sides: Seat[] = [];
      for (let i = 0; i < perSide; i++) {
        const x = tcx - ((perSide - 1) * 1.2) / 2 + i * 1.2;
        sides.push({ id: `${room.key}:n${i}`, zone: room.key, floor: room.floor, x, z: tcz - 1.32, yaw: 0, approach: P(x, tcz - 1.74), height: CHAIR_SEAT_HEIGHT, kind: "chair" });
        sides.push({ id: `${room.key}:s${i}`, zone: room.key, floor: room.floor, x, z: tcz + 1.32, yaw: Math.PI, approach: P(x, tcz + 1.74), height: CHAIR_SEAT_HEIGHT, kind: "chair" });
      }
      const used = sides.slice(0, sideCount);
      for (const s of [head, ...used]) fp.chairs.push({ x: s.x, z: s.z, yaw: s.yaw });
      plan.meetingRooms.set(room.key, { key: room.key, floor: room.floor, rect, table, head, sides: used });
      const screenW = Math.min(2.6, d - 1.4);
      fp.meetingScreens.push({ zone: room.key, x: x0 + w - 0.12, y: 1.55, z: tcz, yaw: -H, width: screenW, height: screenW * 0.56, freestanding: false });
      const n = Math.max(1, Math.round(length / 1.8));
      for (let i = 0; i < n; i++) fp.pendants.push(P(tcx - length / 2 + (length / n) * (i + 0.5), tcz));
    },
  };
}

function loungePod(lounge: OfficeLayoutSpec["lounges"][number]): Pod {
  const w = 7.4, d = 6.9;
  return {
    w, d,
    build(fp, plan, x0, z0) {
      const rect: Rect = { minX: x0, maxX: x0 + w, minZ: z0, maxZ: z0 + d };
      const name = /_(\d+)$/.exec(lounge.key)?.[1];
      zoneInfo(plan, lounge.key, lounge.floor, "lounge", rect, `Lounge${name ? ` ${name}` : ""}`, `الاستراحة${name ? ` ${name}` : ""}`, "#b08d57");
      fp.rugs.push({ zone: lounge.key, center: P(x0 + 3.7, z0 + 3.2), w: 6.0, d: 4.8, color: "#9c8a70" });
      const cx = x0 + 3.7;
      const sofaA = { center: P(cx, z0 + 1.4), yaw: 0, width: 2.3 };
      const sofaB = { center: P(cx, z0 + 5.0), yaw: Math.PI, width: 2.3 };
      const armE = { center: P(cx + 2.5, z0 + 3.2), yaw: -H, width: 0.95 };
      const armW = { center: P(cx - 2.5, z0 + 3.2), yaw: H, width: 0.95 };
      fp.sofas.push(sofaA, sofaB, armE, armW);
      for (const s of [sofaA, sofaB]) fp.obstacles.push(rectOf(s.center, s.width, 0.9, s.yaw));
      for (const s of [armE, armW]) fp.obstacles.push(rectOf(s.center, s.width, 0.85, s.yaw));
      const ct = { center: P(cx, z0 + 3.2), w: 1.3, d: 0.65 };
      fp.coffeeTables.push(ct);
      fp.obstacles.push(rectOf(ct.center, ct.w, ct.d));
      const bar: BoxSpec = { center: P(cx, z0 + 6.4), w: 3.6, d: 0.6, h: 1.0, yaw: 0 };
      fp.bars.push(bar);
      fp.obstacles.push(rectOf(bar.center, bar.w, bar.d));
      fp.pendants.push(P(cx, z0 + 3.2));
      const sofaSeat = (id: string, x: number, z: number, yaw: number): Seat => ({ id: `${lounge.key}:${id}`, zone: lounge.key, floor: lounge.floor, x, z, yaw, approach: off(P(x, z), yaw, 0.58), height: SOFA_SEAT_HEIGHT, kind: "sofa" });
      const seats = [
        sofaSeat("a0", cx - 0.75, z0 + 1.48, 0), sofaSeat("a1", cx, z0 + 1.48, 0), sofaSeat("a2", cx + 0.75, z0 + 1.48, 0),
        sofaSeat("b0", cx + 0.75, z0 + 4.92, Math.PI), sofaSeat("b1", cx, z0 + 4.92, Math.PI), sofaSeat("b2", cx - 0.75, z0 + 4.92, Math.PI),
        sofaSeat("c", cx + 2.42, z0 + 3.2, -H), sofaSeat("d", cx - 2.42, z0 + 3.2, H),
      ];
      plan.lounges.set(lounge.key, { key: lounge.key, floor: lounge.floor, rect, seats });
      plant(fp, x0 + 0.4, z0 + 0.4, 0.95);
      plant(fp, x0 + w - 0.4, z0 + 0.4, 0.95);
    },
  };
}

function corePod(): Pod {
  return {
    w: 3.4, d: 3.4,
    build(fp, _plan, x0, z0) {
      fp.core = { minX: x0, maxX: x0 + 3.4, minZ: z0, maxZ: z0 + 3.0 };
      fp.obstacles.push(fp.core);
      fp.coreSpot = { x: x0 + 1.7, z: z0 + 3.0 + 0.65, yaw: Math.PI };
    },
  };
}

// ───────────────────────── Floor packing ─────────────────────────

const TIER_WIDTH: Record<string, number> = { compact: 24, standard: 32, expanded: 38, large: 46 };

function tierWidth(spec: OfficeLayoutSpec, maxStations: number): number {
  const byMode = TIER_WIDTH[spec.mode];
  if (byMode) return byMode;
  return maxStations <= 4 ? 24 : maxStations <= 8 ? 32 : maxStations <= 12 ? 38 : 46;
}

export function generateOfficePlan(spec: OfficeLayoutSpec): OfficePlan {
  const floorCount = Math.max(1, Math.floor(spec.floors) || 1);
  const clampFloor = (f: number) => Math.min(floorCount - 1, Math.max(0, Math.floor(f) || 0));

  // Pods per floor, in a fixed, data-defined order.
  const podsByFloor: Pod[][] = Array.from({ length: floorCount }, () => []);
  const stationsByFloor = new Array(floorCount).fill(0);
  if (floorCount > 1) for (const pods of podsByFloor) pods.push(corePod());
  for (const d of spec.departments.filter((x) => x.kind === "executive")) podsByFloor[clampFloor(d.floor)].push(executivePod(d, clampFloor(d.floor)));
  for (const d of spec.departments.filter((x) => x.kind !== "executive")) podsByFloor[clampFloor(d.floor)].push(departmentPod(d, clampFloor(d.floor)));
  for (const d of spec.departments) stationsByFloor[clampFloor(d.floor)] += d.workstations.length;
  for (const m of spec.meetingRooms) podsByFloor[clampFloor(m.floor)].push(meetingPod({ ...m, floor: clampFloor(m.floor) }));
  for (const l of spec.lounges) podsByFloor[clampFloor(l.floor)].push(loungePod({ ...l, floor: clampFloor(l.floor) }));

  const widest = Math.max(0, ...podsByFloor.flat().map((p) => p.w));
  const width = Math.max(tierWidth(spec, Math.max(...stationsByFloor)), widest + MARGIN * 2);
  const minX = -width / 2;

  const plan: OfficePlan = {
    revision: spec.revision, floors: [], width,
    zones: new Map(), desks: new Map(), deptDesks: new Map(), meetingRooms: new Map(), lounges: new Map(),
  };

  podsByFloor.forEach((pods, index) => {
    const fp: FloorPlan = {
      index, bounds: { minX, maxX: -minX, minZ: 0, maxZ: 0 }, walls: [], doorways: [], windows: [], obstacles: [],
      desks: [], chairs: [], sofas: [], coffeeTables: [], bars: [], tables: [], credenzas: [], plants: [], pendants: [], rugs: [],
      signs: [], execWalls: [], meetingScreens: [], core: null, coreSpot: null, entrance: null,
    };
    // Shelf packing: left to right, wrap at the floor width.
    let x = minX + MARGIN, z = MARGIN, rowDepth = 0, right = minX + 12;
    for (const pod of pods) {
      if (x > minX + MARGIN && x + pod.w > -minX - MARGIN) {
        z += rowDepth + GAP_Z;
        x = minX + MARGIN;
        rowDepth = 0;
      }
      pod.build(fp, plan, x, z);
      right = Math.max(right, x + pod.w);
      x += pod.w + GAP_X;
      rowDepth = Math.max(rowDepth, pod.d);
    }
    // The floor hugs its content: positions only depend on the wrap width, the east wall follows the widest row.
    fp.bounds.maxX = Math.min(-minX, right + MARGIN + 0.4);
    const depth = Math.max(z + rowDepth + MARGIN + (index === 0 ? 0.8 : 0), 12);
    fp.bounds.maxZ = depth;
    const b = fp.bounds;

    // Exterior shell: north/west/east solid (fade when the camera is behind), low south sill with the entrance.
    fp.walls.push({ a: P(b.minX, b.minZ), b: P(b.maxX, b.minZ), kind: "solid", side: "north" });
    fp.walls.push({ a: P(b.minX, b.minZ), b: P(b.minX, b.maxZ), kind: "solid", side: "west" });
    fp.walls.push({ a: P(b.maxX, b.minZ), b: P(b.maxX, b.maxZ), kind: "solid", side: "east" });
    if (index === 0) {
      const ex = b.minX + 3.0;
      fp.walls.push({ a: P(b.minX, b.maxZ), b: P(ex - 0.9, b.maxZ), kind: "low", side: "south" });
      fp.walls.push({ a: P(ex + 0.9, b.maxZ), b: P(b.maxX, b.maxZ), kind: "low", side: "south" });
      fp.doorways.push({ a: P(ex - 0.9, b.maxZ), b: P(ex + 0.9, b.maxZ) });
      fp.entrance = { x: ex, z: b.maxZ - 0.7, yaw: Math.PI };
    } else {
      fp.walls.push({ a: P(b.minX, b.maxZ), b: P(b.maxX, b.maxZ), kind: "low", side: "south" });
    }
    for (let wx = b.minX + 1.2; wx + 3.2 <= b.maxX - 1.0; wx += 5.2) fp.windows.push({ side: "north", from: wx, to: wx + 3.6 });
    for (let wz = 2.5; wz + 1.4 <= b.maxZ - 1.5; wz += 6) {
      fp.windows.push({ side: "west", from: wz, to: wz + 1.4 });
      fp.windows.push({ side: "east", from: wz, to: wz + 1.4 });
    }
    plan.floors.push(fp);
  });
  return plan;
}

/**
 * World-space offset of a floor in the current view. A single floor sits at the origin; the "all" view is an
 * exploded grid (two columns from three floors up) so every floor stays readable from above.
 */
export function floorOffset(plan: OfficePlan, floor: number, view: number | "all"): Vec2 {
  if (view !== "all") return { x: 0, z: 0 };
  const cols = plan.floors.length <= 2 ? plan.floors.length : 2;
  const depth = Math.max(...plan.floors.map((f) => f.bounds.maxZ));
  return { x: (floor % cols) * (plan.width + FLOOR_GAP), z: Math.floor(floor / cols) * (depth + FLOOR_GAP) };
}

export function floorVisible(floor: number, view: number | "all") {
  return view === "all" || view === floor;
}
