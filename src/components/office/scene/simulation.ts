import type {
  ActivityEvent, AgentMessage, AgentPresence, AgentProfile, AgentStatus, CharacterAnimation, OfficeZone,
} from "@/lib/office/types";
import { rectCenter, type DeskPlan, type OfficePlan, type Seat, type Spot, type Vec2 } from "./plan";
import { NavGrid } from "./navigation";
import { CHANNELS, addLayers, computeTargetPose, dampPose, type IdleVariant } from "./poses";
import { HIP_HEIGHT, REF_HEIGHT } from "./character-model";

/**
 * Behaviour layer: turns real backend state (roster + presence = persistent, events = transient) into
 * character placement, movement and animation across one or more floors. Pure TypeScript, no Three.js
 * objects — the React layer reads positions and pose arrays every frame.
 */

const WALK_SPEED = 1.3;
const SIT_TIME = 0.85;
const RISE_TIME = 0.7;
const FADE_TIME = 0.6;
const ARRIVE = 0.12;
const LOUNGE_AFTER_MS = 60_000;
const TOOL_ANIM_SECONDS = 6;
const CELEBRATE_SECONDS = 2.2;
const ERROR_SECONDS = 4;
const QUEUE_MAX_AGE_MS = 45_000;
const VISIT_TIMEOUT = 45;
export const BUBBLE_CHARS = 160;

const READING_TOOLS = new Set(["knowledge_search", "read_file", "web_search", "fetch_url", "list_files", "email_search", "drive_search"]);

export function classifyTool(tool: string): CharacterAnimation {
  if (READING_TOOLS.has(tool)) return "reading";
  if (tool.startsWith("create_") || tool === "draft_email" || tool === "propose_memory") return "typing";
  return "thinking";
}

export function truncate(text: string, max = BUBBLE_CHARS): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** Compares numeric id strings without precision loss. */
export function compareIds(a: string, b: string): number {
  const x = a.replace(/^0+/, ""), y = b.replace(/^0+/, "");
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const seatKey = (s: Seat) => `seat:${s.id}@${s.floor}:${s.x.toFixed(2)},${s.z.toFixed(2)}`;

interface Goal { key: string; zone: OfficeZone; floor: number; seat: Seat | null; spot: Spot | null; exit?: boolean }

interface Visit {
  kind: "delegation" | "message";
  target: string;
  messageId: string | null;
  stepId: string | null;
  fallback: string;
  createdMs: number;
  stage: "go" | "talk";
  goal: Goal | null;
  startedAt: number;
  talkUntil: number;
}

type Mode = "stand" | "walk" | "sitting" | "seated" | "rising" | "appearing" | "vanishing";

export interface AgentRuntime {
  slug: string;
  index: number;
  profile: AgentProfile;
  /** Overall character scale (height × layout.characterScale). */
  scale: number;
  desk: DeskPlan | null;

  floor: number;
  x: number; z: number; yaw: number; desiredYaw: number;
  speed: number;
  mode: Mode;
  /** 0 = invisible, 1 = fully visible (spawn, exit and floor changes fade). */
  fade: number;
  transitFloor: number | null;
  leaving: boolean;
  removed: boolean;
  seat: Seat | null;
  sit: number;
  trans: number;
  transFrom: Vec2;
  goal: Goal | null;
  arrived: boolean;
  path: Vec2[] | null;
  pathIdx: number;
  replanAt: number;
  waitT: number;
  progressT: number;
  progressDist: number;
  ghostUntil: number;

  status: AgentStatus;
  presenceZone: OfficeZone | null;
  meetingId: string | null;
  waitingFor: string | null;
  idleSinceMs: number;
  placed: boolean;
  meetingSeat: Seat | null;
  loungeSeat: Seat | null;
  awaySpot: { key: string; spot: Spot } | null;

  toolAnim: CharacterAnimation | null; toolUntil: number;
  celebrateUntil: number; errorUntil: number;
  speakUntil: number;
  listenTo: string | null; listenUntil: number;
  visit: Visit | null;
  queue: Visit[];
  bubble: { id: number; text: string; until: number } | null;

  anim: CharacterAnimation;
  idleVariant: IdleVariant;
  animStart: number;
  look: number;
  phase: number;
  gait: number;
  pose: Float32Array;
  target: Float32Array;
  out: Float32Array;
  snapPose: boolean;
}

export interface CharacterSnapshot {
  zone: OfficeZone;
  floor: number;
  position: [number, number];
  animation: CharacterAnimation;
  walking: boolean;
  bubble: string | null;
}

export interface SimSettings { characterScale: number; ambientLounge: boolean }

export class OfficeSim {
  readonly agents = new Map<string, AgentRuntime>();
  list: AgentRuntime[] = [];
  time = 0;
  plan: OfficePlan | null = null;
  private navs: NavGrid[] = [];
  private settings: SimSettings = { characterScale: 1, ambientLounge: true };
  private messagesById = new Map<string, AgentMessage>();
  private messages: AgentMessage[] = [];
  private lastEventId: string | null = null;
  private baseline = false;
  private initialized = false;
  private seenMessageVisits = new Set<string>();
  private bubbleSeq = 0;
  private nextIndex = 0;
  private listeners = new Set<() => void>();
  private dirty = false;
  /** Bumped whenever characters are added or finally removed. */
  rosterVersion = 0;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit() {
    this.dirty = false;
    this.listeners.forEach((fn) => fn());
  }

  // ───────────────────────── Inputs ─────────────────────────

  /** New floor plan (only when the layout revision changes): rebuild navigation and re-resolve desks. */
  setPlan(plan: OfficePlan) {
    if (this.plan === plan) return;
    this.plan = plan;
    this.navs = plan.floors.map((f) => new NavGrid(f));
    for (const a of this.list) {
      if (a.floor >= plan.floors.length) a.floor = 0;
      a.path = null;
      a.awaySpot = null;
      a.meetingSeat = null;
      a.loungeSeat = null;
      if (a.visit) a.visit.goal = null;
    }
    this.assignDesks();
    for (const a of this.list) if (a.visit && a.visit.stage === "go") a.visit.goal = this.visitGoal(a, a.visit);
  }

  setSettings(s: SimSettings) {
    const scaleChanged = s.characterScale !== this.settings.characterScale;
    this.settings = s;
    if (scaleChanged) for (const a of this.list) a.scale = this.scaleOf(a.profile);
  }

  private scaleOf(p: AgentProfile) {
    return (p.appearance.height / REF_HEIGHT) * Math.min(1.25, Math.max(0.8, this.settings.characterScale || 1));
  }

  /** Diff the roster by slug: new agents walk in, removed agents walk out, the rest keep their state. */
  setProfiles(profiles: AgentProfile[]) {
    const incoming = new Set(profiles.map((p) => p.slug));
    let changed = false;
    for (const profile of profiles) {
      const existing = this.agents.get(profile.slug);
      if (existing) {
        existing.profile = profile;
        existing.scale = this.scaleOf(profile);
        if (existing.leaving) { existing.leaving = false; changed = true; }
        continue;
      }
      const a = this.createAgent(profile);
      this.agents.set(profile.slug, a);
      this.list.push(a);
      changed = true;
    }
    for (const a of this.list) {
      if (incoming.has(a.slug) || a.leaving) continue;
      if (!this.initialized || !a.placed || a.fade <= 0) { a.removed = true; continue; }
      a.leaving = true;
      a.visit = null;
      a.queue = [];
    }
    if (this.list.some((a) => a.removed)) this.purge();
    this.assignDesks();
    // Newcomers after the initial placement walk in from the entrance / elevator.
    for (const a of this.list) if (!a.placed && this.initialized && this.plan) this.spawn(a);
    if (changed) { this.rosterVersion++; this.dirty = true; }
  }

  private createAgent(profile: AgentProfile): AgentRuntime {
    return {
      slug: profile.slug, index: this.nextIndex++, profile, scale: this.scaleOf(profile), desk: null,
      floor: 0, x: 0, z: 0, yaw: 0, desiredYaw: 0, speed: 0, mode: "stand", fade: 1, transitFloor: null, leaving: false, removed: false,
      seat: null, sit: 0, trans: 0, transFrom: { x: 0, z: 0 },
      goal: null, arrived: false, path: null, pathIdx: 0, replanAt: 0, waitT: 0, progressT: 0, progressDist: Infinity, ghostUntil: 0,
      status: "idle", presenceZone: null, meetingId: null, waitingFor: null, idleSinceMs: Date.now(), placed: false,
      meetingSeat: null, loungeSeat: null, awaySpot: null,
      toolAnim: null, toolUntil: 0, celebrateUntil: 0, errorUntil: 0, speakUntil: 0,
      listenTo: null, listenUntil: 0, visit: null, queue: [], bubble: null,
      anim: "idle", idleVariant: null, animStart: 0, look: 0, phase: 0, gait: 0,
      pose: new Float32Array(CHANNELS), target: new Float32Array(CHANNELS), out: new Float32Array(CHANNELS), snapPose: true,
    };
  }

  private purge() {
    for (const a of this.list) if (a.removed) this.agents.delete(a.slug);
    this.list = this.list.filter((a) => !a.removed);
    this.rosterVersion++;
    this.dirty = true;
  }

  /** Desk = the profile's workstation, else the first free desk of its department. */
  private assignDesks() {
    const plan = this.plan;
    if (!plan) return;
    const taken = new Set<string>();
    const active = this.list.filter((a) => !a.leaving);
    for (const a of active) {
      const d = a.profile.workstationId ? plan.desks.get(a.profile.workstationId) : undefined;
      if (d && !taken.has(d.id)) { a.desk = d; taken.add(d.id); } else a.desk = null;
    }
    for (const a of active) {
      if (a.desk) continue;
      const free = (plan.deptDesks.get(a.profile.deskZone) ?? []).find((d) => !taken.has(d.id) && (!d.agentSlug || d.agentSlug === a.slug))
        ?? (plan.deptDesks.get(a.profile.deskZone) ?? []).find((d) => !taken.has(d.id));
      if (free) { a.desk = free; taken.add(free.id); }
    }
  }

  setPresence(presence: AgentPresence[]) {
    const now = Date.now();
    const by = new Map(presence.map((p) => [p.agent, p]));
    for (const a of this.list) {
      const p = by.get(a.slug);
      const status: AgentStatus = p?.status ?? "idle";
      if (status === "idle") {
        // The backend resets `since` whenever status or zone changes; fall back to the first time we saw idle.
        const since = p ? Date.parse(p.since) : NaN;
        a.idleSinceMs = Number.isFinite(since) ? Math.min(now, since) : a.status === "idle" && a.placed ? a.idleSinceMs : now;
      }
      if (status === "meeting" && status !== a.status && a.visit) a.visit = null;
      a.status = status;
      a.presenceZone = p?.zone ?? null;
      a.meetingId = p?.meetingId ?? null;
      a.waitingFor = p?.waitingFor ?? null;
    }
    if (!this.initialized && this.plan) {
      this.initialized = true;
      for (const a of this.list) if (!a.placed) this.place(a);
    }
  }

  setMessages(messages: AgentMessage[]) {
    this.messages = messages;
    this.messagesById = new Map(messages.map((m) => [m.id, m]));
  }

  /** Feed the full (ascending) event list; only ids newer than the first batch are acted on. */
  ingestEvents(events: ActivityEvent[]) {
    if (!this.baseline) {
      this.baseline = true;
      for (const e of events) if (!this.lastEventId || compareIds(e.id, this.lastEventId) > 0) this.lastEventId = e.id;
      return;
    }
    const fresh = events.filter((e) => !this.lastEventId || compareIds(e.id, this.lastEventId) > 0).sort((x, y) => compareIds(x.id, y.id));
    for (const e of fresh) {
      this.lastEventId = e.id;
      this.handleEvent(e);
    }
  }

  private handleEvent(e: ActivityEvent) {
    const a = this.agents.get(e.agent);
    if (!a || a.leaving) return;
    const messageId = typeof e.payload.messageId === "string" ? e.payload.messageId : e.payload.messageId != null ? String(e.payload.messageId) : null;
    switch (e.type) {
      case "tool_used": {
        const tool = typeof e.payload.tool === "string" ? e.payload.tool : "";
        a.toolAnim = classifyTool(tool);
        a.toolUntil = this.time + TOOL_ANIM_SECONDS;
        break;
      }
      case "delegated": {
        const target = e.relatedAgent;
        if (!target || !this.agents.has(target) || target === a.slug) break;
        if (messageId) this.seenMessageVisits.add(messageId);
        this.enqueue(a, { kind: "delegation", target, messageId, stepId: e.stepId, fallback: e.summary, createdMs: Date.now(), stage: "go", goal: null, startedAt: 0, talkUntil: 0 });
        break;
      }
      case "message_sent": {
        const target = e.relatedAgent;
        if (!target || !this.agents.has(target) || target === a.slug) break;
        if (messageId && this.seenMessageVisits.has(messageId)) break;
        const b = this.agents.get(target)!;
        if (a.status === "meeting" || b.status === "meeting") break;
        if (messageId) this.seenMessageVisits.add(messageId);
        this.enqueue(a, { kind: "message", target, messageId, stepId: e.stepId, fallback: e.summary, createdMs: Date.now(), stage: "go", goal: null, startedAt: 0, talkUntil: 0 });
        break;
      }
      case "meeting_message": {
        const content = typeof e.payload.content === "string" ? e.payload.content : (messageId && this.messagesById.get(messageId)?.content) || e.summary;
        const dur = this.talkDuration(content);
        a.speakUntil = this.time + dur;
        this.setBubble(a, content, dur);
        for (const o of this.list) {
          if (o === a || o.status !== "meeting") continue;
          if (e.meetingId && o.meetingId && o.meetingId !== e.meetingId) continue;
          o.listenTo = a.slug;
          o.listenUntil = this.time + dur;
        }
        break;
      }
      case "task_completed":
        if (a.profile.isOrchestrator && a.status !== "meeting") a.celebrateUntil = this.time + CELEBRATE_SECONDS;
        break;
      case "step_failed":
        a.errorUntil = this.time + ERROR_SECONDS;
        break;
      default:
        break;
    }
  }

  private enqueue(a: AgentRuntime, v: Visit) {
    a.queue.push(v);
    if (a.queue.length > 4) a.queue.shift();
  }

  // ───────────────────────── Helpers ─────────────────────────

  private nav(floor: number): NavGrid | null {
    return this.navs[floor] ?? this.navs[0] ?? null;
  }

  private zoneSpot(zone: OfficeZone): { spot: Spot; floor: number } | null {
    const info = this.plan?.zones.get(zone);
    if (!info) return null;
    const c = rectCenter(info.rect);
    const nav = this.nav(info.floor);
    const idx = nav ? nav.nearestWalkable(c.x, c.z, 14) : -1;
    const p = idx >= 0 && nav ? nav.centerOf(idx) : c;
    return { spot: { x: p.x, z: p.z, yaw: 0 }, floor: info.floor };
  }

  private homeGoal(a: AgentRuntime): Goal {
    if (a.desk) return { key: `stand:${a.desk.id}@${a.desk.stand.x.toFixed(2)},${a.desk.stand.z.toFixed(2)}`, zone: a.desk.zone, floor: a.desk.floor, seat: null, spot: a.desk.stand };
    const z = this.zoneSpot(a.profile.deskZone);
    if (z) return { key: `home:${a.slug}:${z.spot.x.toFixed(2)},${z.spot.z.toFixed(2)}`, zone: a.profile.deskZone, floor: z.floor, seat: null, spot: z.spot };
    const f = this.plan?.floors[0];
    const spot = f?.entrance ?? f?.coreSpot ?? { x: 0, z: 2, yaw: 0 };
    return { key: `home:${a.slug}:entrance`, zone: a.profile.deskZone, floor: 0, seat: null, spot };
  }

  private exitSpot(floor: number): Spot {
    const f = this.plan?.floors[floor];
    return (floor === 0 ? f?.entrance : null) ?? f?.coreSpot ?? f?.entrance ?? { x: 0, z: 1, yaw: 0 };
  }

  private talkDuration(text: string) {
    return Math.min(8, Math.max(5, 3.5 + text.length / 30));
  }

  private setBubble(a: AgentRuntime, text: string, seconds: number) {
    a.bubble = { id: ++this.bubbleSeq, text: truncate(text), until: this.time + seconds + 0.4 };
    this.dirty = true;
  }

  private resolveVisitText(v: Visit, from: string): string {
    if (v.messageId) {
      const m = this.messagesById.get(v.messageId);
      if (m) return m.content;
    }
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.from !== from || m.to !== v.target) continue;
      if (v.kind === "delegation" && m.kind !== "delegation") continue;
      if (v.stepId && m.stepId && m.stepId !== v.stepId) continue;
      return m.content;
    }
    return v.fallback;
  }

  /** Persistent placement derived from presence (or the active visit / exit). */
  private decideGoal(a: AgentRuntime): Goal {
    if (a.leaving) {
      const spot = this.exitSpot(a.floor);
      return { key: `exit:${a.floor}`, zone: a.goal?.zone ?? a.profile.deskZone, floor: a.floor, seat: null, spot, exit: true };
    }
    if (a.visit?.goal) return a.visit.goal;
    const plan = this.plan;
    const deskZone = a.profile.deskZone;
    const zone = a.presenceZone ?? deskZone;
    const room = plan?.meetingRooms.get(zone);
    if (a.status !== "meeting" && !room) a.meetingSeat = null;

    if (a.status === "meeting" || room) {
      const seat = this.meetingSeatFor(a, room?.key ?? null);
      if (seat) return { key: seatKey(seat), zone: seat.zone, floor: seat.floor, seat, spot: null };
    }
    if (plan?.lounges.has(zone)) {
      const g = this.loungeGoal(a, zone);
      if (g) return g;
    } else if (zone !== deskZone && plan?.zones.has(zone)) {
      const key = `away:${zone}:${plan.revision}`;
      if (!a.awaySpot || a.awaySpot.key !== key) {
        const first = plan.deptDesks.get(zone)?.[0];
        const info = plan.zones.get(zone)!;
        const spot = first ? this.freeSpotNear(a, info.floor, first.visit, { x: first.seat.x, z: first.seat.z }) : this.zoneSpot(zone)?.spot;
        if (spot) a.awaySpot = { key, spot };
      }
      if (a.awaySpot) return { key: a.awaySpot.key, zone, floor: plan.zones.get(zone)!.floor, seat: null, spot: a.awaySpot.spot };
    }
    if (a.status === "idle" && this.settings.ambientLounge && Date.now() - a.idleSinceMs > LOUNGE_AFTER_MS) {
      const g = this.loungeGoal(a, null);
      if (g) return g;
    }
    a.loungeSeat = null;
    if (a.status === "idle") {
      if (a.desk && a.profile.defaultAnimation !== "idle") return { key: seatKey(a.desk.seat), zone: a.desk.zone, floor: a.desk.floor, seat: a.desk.seat, spot: null };
      return this.homeGoal(a);
    }
    if (a.desk) return { key: seatKey(a.desk.seat), zone: a.desk.zone, floor: a.desk.floor, seat: a.desk.seat, spot: null };
    return this.homeGoal(a);
  }

  /**
   * The orchestrator chairs from the head; others take the first free side seat in alternating
   * north/south order and keep it for as long as they are in that meeting.
   */
  private meetingSeatFor(a: AgentRuntime, roomKey: string | null): Seat | null {
    const plan = this.plan;
    if (!plan || plan.meetingRooms.size === 0) return null;
    const room = (roomKey && plan.meetingRooms.get(roomKey))
      || plan.meetingRooms.get(plan.zones.get(a.profile.deskZone)?.meetingRoomKey ?? "")
      || [...plan.meetingRooms.values()].find((r) => r.floor === (a.desk?.floor ?? 0))
      || [...plan.meetingRooms.values()][0];
    if (a.meetingSeat && a.meetingSeat.zone === room.key) return a.meetingSeat;
    const taken = new Set(this.list.filter((o) => o !== a).map((o) => o.meetingSeat?.id).filter(Boolean));
    const seat = a.profile.isOrchestrator && !taken.has(room.head.id) ? room.head : room.sides.find((s) => !taken.has(s.id)) ?? (!taken.has(room.head.id) ? room.head : null);
    a.meetingSeat = seat;
    return seat;
  }

  private loungeGoal(a: AgentRuntime, key: string | null): Goal | null {
    const plan = this.plan;
    if (!plan || plan.lounges.size === 0) return null;
    const lounges = [...plan.lounges.values()];
    const preferred = (key && plan.lounges.get(key)) || lounges.find((l) => l.floor === (a.desk?.floor ?? a.floor)) || lounges[0];
    if (!a.loungeSeat || a.loungeSeat.zone !== preferred.key) {
      const taken = new Set(this.list.filter((o) => o !== a).map((o) => o.loungeSeat?.id).filter(Boolean));
      a.loungeSeat = preferred.seats.find((s) => !taken.has(s.id)) ?? null;
    }
    if (!a.loungeSeat) return null;
    return { key: seatKey(a.loungeSeat), zone: preferred.key, floor: preferred.floor, seat: a.loungeSeat, spot: null };
  }

  private occupiedNear(floor: number, x: number, z: number, self: AgentRuntime, radius: number) {
    for (const o of this.list) {
      if (o === self || o.floor !== floor) continue;
      if (Math.hypot(o.x - x, o.z - z) < radius) return true;
      const g = o.goal;
      const e = g && g.floor === floor ? (g.seat ? g.seat.approach : g.spot) : null;
      if (e && o.mode !== "seated" && Math.hypot(e.x - x, e.z - z) < radius) return true;
    }
    return false;
  }

  /** Preferred spot if free and walkable, else the nearest free walkable point on rings around `focus`. */
  private freeSpotNear(self: AgentRuntime, floor: number, preferred: Spot | null, focus: Vec2): Spot {
    const nav = this.nav(floor);
    if (!nav) return preferred ?? { x: focus.x, z: focus.z + 1, yaw: Math.PI };
    if (preferred && nav.walkable(preferred.x, preferred.z) && !this.occupiedNear(floor, preferred.x, preferred.z, self, 0.75)) return preferred;
    let best: Spot | null = null, bestScore = Infinity;
    for (const r of [1.0, 1.3, 1.65, 2.0, 2.5]) {
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2;
        const x = focus.x + Math.sin(ang) * r, z = focus.z + Math.cos(ang) * r;
        if (!nav.walkable(x, z) || this.occupiedNear(floor, x, z, self, 0.75)) continue;
        const score = (self.floor === floor ? Math.hypot(x - self.x, z - self.z) * 0.25 : 0) + r;
        if (score < bestScore) { bestScore = score; best = { x, z, yaw: Math.atan2(focus.x - x, focus.z - z) }; }
      }
      if (best) return best;
    }
    return preferred ?? { x: focus.x, z: focus.z + 1, yaw: Math.PI };
  }

  private visitGoal(a: AgentRuntime, v: Visit): Goal | null {
    const b = this.agents.get(v.target);
    if (!b || b.leaving) return null;
    const bGoal = b.goal ?? this.decideGoal(b);
    const atDesk = b.desk && bGoal.zone === b.desk.zone && (bGoal.seat?.id === b.desk.seat.id || bGoal.key.startsWith("stand:"));
    if ((v.kind === "delegation" || atDesk) && b.desk) {
      const spot = this.freeSpotNear(a, b.desk.floor, b.desk.visit, { x: b.desk.seat.x, z: b.desk.seat.z });
      return { key: `visit:${v.createdMs}:${b.slug}`, zone: b.desk.zone, floor: b.desk.floor, seat: null, spot };
    }
    const anchor = bGoal.seat ?? bGoal.spot ?? { x: b.x, z: b.z };
    const spot = this.freeSpotNear(a, bGoal.floor, null, { x: anchor.x, z: anchor.z });
    return { key: `visit:${v.createdMs}:${b.slug}`, zone: bGoal.zone, floor: bGoal.floor, seat: null, spot };
  }

  private startNextVisit(a: AgentRuntime) {
    while (!a.visit && a.queue.length && a.status !== "meeting" && !a.leaving) {
      const v = a.queue.shift()!;
      if (Date.now() - v.createdMs > QUEUE_MAX_AGE_MS) continue;
      const b = this.agents.get(v.target);
      if (!b || b.leaving) continue;
      if (b.status === "meeting") {
        if (v.kind === "message") continue;
        // Delegating to someone in a meeting: brief from where we are.
        v.goal = null;
        this.beginTalk(a, v);
        a.visit = v;
        return;
      }
      v.goal = this.visitGoal(a, v);
      if (!v.goal) continue;
      v.startedAt = this.time;
      a.visit = v;
    }
  }

  private beginTalk(a: AgentRuntime, v: Visit) {
    const text = this.resolveVisitText(v, a.slug);
    const dur = this.talkDuration(text);
    v.stage = "talk";
    v.talkUntil = this.time + dur;
    a.speakUntil = v.talkUntil;
    this.setBubble(a, text, dur);
    const b = this.agents.get(v.target);
    if (b && b.status !== "meeting") { b.listenTo = a.slug; b.listenUntil = v.talkUntil; }
  }

  private place(a: AgentRuntime) {
    const g = this.decideGoal(a);
    a.goal = g;
    a.placed = true;
    a.path = null;
    a.snapPose = true;
    a.fade = 1;
    a.floor = g.floor;
    if (g.seat) {
      a.x = g.seat.x; a.z = g.seat.z; a.yaw = a.desiredYaw = g.seat.yaw;
      a.mode = "seated"; a.seat = g.seat; a.sit = 1; a.arrived = true;
    } else if (g.spot) {
      a.x = g.spot.x; a.z = g.spot.z; a.yaw = a.desiredYaw = g.spot.yaw;
      a.mode = "stand"; a.seat = null; a.sit = 0; a.arrived = true;
    }
  }

  /** A newly created agent appears at the entrance (ground floor) or the elevator of its desk's floor. */
  private spawn(a: AgentRuntime) {
    const target = this.decideGoal(a);
    const floor = target.floor;
    const f = this.plan!.floors[floor] ?? this.plan!.floors[0];
    const at = (floor === 0 ? f.entrance : null) ?? f.coreSpot ?? f.entrance ?? { x: 0, z: 1, yaw: 0 };
    a.placed = true;
    a.floor = f.index;
    a.x = at.x; a.z = at.z; a.yaw = a.desiredYaw = at.yaw;
    a.mode = "appearing"; a.fade = 0; a.sit = 0; a.seat = null; a.snapPose = true; a.arrived = false;
  }

  // ───────────────────────── Simulation step ─────────────────────────

  update(rawDt: number) {
    // Large frame gaps (slow devices, tab resume) are sub-stepped so behaviour stays real-time without tunnelling.
    const total = Math.min(1, Math.max(0, rawDt));
    if (!this.plan) return;
    const steps = Math.max(1, Math.ceil(total / 0.05));
    for (let i = 0; i < steps; i++) this.step(total / steps);
    if (this.list.some((a) => a.removed)) this.purge();
    for (const a of this.list) this.animate(a, total);
    if (this.dirty) this.emit();
  }

  private step(dt: number) {
    this.time += dt;
    const t = this.time;
    for (const a of this.list) {
      if (!a.placed || a.removed) continue;
      if (a.bubble && a.bubble.until <= t) { a.bubble = null; this.dirty = true; }
      if (a.listenTo && a.listenUntil <= t) a.listenTo = null;

      if (!a.visit) this.startNextVisit(a);
      const v = a.visit;
      if (v) {
        if (v.stage === "go" && (t - v.startedAt > VISIT_TIMEOUT || !v.goal)) a.visit = null;
        else if (v.stage === "go" && a.arrived && a.goal?.key === v.goal?.key) this.beginTalk(a, v);
        else if (v.stage === "talk" && t >= v.talkUntil) a.visit = null;
      }

      const goal = this.decideGoal(a);
      if (!a.goal || goal.key !== a.goal.key || goal.floor !== a.goal.floor) {
        a.goal = goal;
        a.arrived = false;
        a.path = null;
        a.progressDist = Infinity;
        a.progressT = 0;
      } else {
        a.goal = goal;
      }
      this.move(a, dt);
    }
  }

  private move(a: AgentRuntime, dt: number) {
    const g = a.goal!;
    switch (a.mode) {
      case "appearing": {
        a.fade = Math.min(1, a.fade + dt / FADE_TIME);
        if (a.fade >= 1) a.mode = "stand";
        return;
      }
      case "vanishing": {
        a.fade = Math.max(0, a.fade - dt / FADE_TIME);
        if (a.fade > 0) return;
        if (a.leaving) { a.removed = true; return; }
        // Elevator ride: re-appear at the core of the destination floor.
        const to = a.transitFloor ?? g.floor;
        const spot = this.plan!.floors[to]?.coreSpot ?? this.plan!.floors[to]?.entrance;
        a.transitFloor = null;
        a.floor = to;
        if (spot) { a.x = spot.x; a.z = spot.z; a.yaw = a.desiredYaw = spot.yaw; }
        a.path = null;
        a.mode = "appearing";
        return;
      }
      case "seated": {
        if (g.seat && a.seat && seatKey(g.seat) === seatKey(a.seat) && g.floor === a.floor) {
          a.arrived = true;
          a.desiredYaw = a.seat.yaw;
          return;
        }
        a.mode = "rising";
        a.trans = 0;
        a.transFrom = { x: a.x, z: a.z };
        return;
      }
      case "rising": {
        const seat = a.seat!;
        a.trans = Math.min(1, a.trans + dt / RISE_TIME);
        const p = ease(a.trans);
        a.x = a.transFrom.x + (seat.approach.x - a.transFrom.x) * p;
        a.z = a.transFrom.z + (seat.approach.z - a.transFrom.z) * p;
        a.sit = 1 - p;
        if (a.trans >= 1) { a.mode = "stand"; a.seat = null; a.sit = 0; }
        return;
      }
      case "sitting": {
        const seat = a.seat!;
        a.trans = Math.min(1, a.trans + dt / SIT_TIME);
        const p = ease(a.trans);
        a.x = a.transFrom.x + (seat.x - a.transFrom.x) * p;
        a.z = a.transFrom.z + (seat.z - a.transFrom.z) * p;
        a.sit = p;
        a.desiredYaw = seat.yaw;
        if (a.trans >= 1) { a.mode = "seated"; a.sit = 1; a.arrived = Boolean(g.seat && seatKey(g.seat) === seatKey(seat)); }
        return;
      }
      default: {
        // Different floor: walk to this floor's elevator core first.
        const changeFloor = g.floor !== a.floor;
        const entry: Vec2 | null = changeFloor ? this.exitSpot(a.floor) : g.seat ? g.seat.approach : g.spot;
        if (!entry) return;
        const d = Math.hypot(entry.x - a.x, entry.z - a.z);
        if (d < ARRIVE || (a.mode === "stand" && a.arrived && d < 0.5)) {
          a.mode = "stand";
          a.speed = 0;
          a.path = null;
          if (changeFloor || g.exit) {
            a.transitFloor = changeFloor ? g.floor : null;
            a.mode = "vanishing";
            return;
          }
          if (g.seat) {
            a.desiredYaw = g.seat.yaw;
            if (Math.abs(wrapAngle(a.yaw - g.seat.yaw)) < 0.35) {
              a.mode = "sitting"; a.seat = g.seat; a.trans = 0; a.transFrom = { x: a.x, z: a.z };
            }
          } else {
            if (!a.arrived) a.desiredYaw = g.spot!.yaw;
            a.arrived = true;
          }
          return;
        }
        a.arrived = false;
        this.walk(a, entry, dt);
      }
    }
  }

  private planPath(a: AgentRuntime, entry: Vec2, avoidOthers: boolean) {
    const nav = this.nav(a.floor);
    if (!nav) { a.path = [{ x: a.x, z: a.z }, { x: entry.x, z: entry.z }]; a.pathIdx = 1; return; }
    let extra: ((idx: number) => boolean) | undefined;
    if (avoidOthers) {
      const blocked = new Set<number>();
      for (const o of this.list) {
        if (o === a || o.mode === "walk" || o.floor !== a.floor || o.fade < 0.5) continue;
        if (Math.hypot(o.x - entry.x, o.z - entry.z) < 0.7) continue;
        for (let dx = -0.4; dx <= 0.41; dx += 0.4) for (let dz = -0.4; dz <= 0.41; dz += 0.4) {
          const idx = nav.indexAt(o.x + dx, o.z + dz);
          if (idx >= 0) blocked.add(idx);
        }
      }
      extra = (idx) => blocked.has(idx);
    }
    const path = nav.findPath(a.x, a.z, entry.x, entry.z, extra) ?? (extra ? nav.findPath(a.x, a.z, entry.x, entry.z) : null);
    a.path = path ?? [{ x: a.x, z: a.z }, { x: entry.x, z: entry.z }];
    a.pathIdx = 1;
  }

  private walk(a: AgentRuntime, entry: Vec2, dt: number) {
    const nav = this.nav(a.floor)!;
    if (!a.path) this.planPath(a, entry, false);
    const path = a.path!;
    let wp = path[a.pathIdx];
    while (a.pathIdx < path.length - 1 && Math.hypot(wp.x - a.x, wp.z - a.z) < 0.3) wp = path[++a.pathIdx];
    const dx = wp.x - a.x, dz = wp.z - a.z;
    const dist = Math.hypot(dx, dz) || 1e-6;
    let dirX = dx / dist, dirZ = dz / dist;
    const last = a.pathIdx === path.length - 1;
    const remaining = Math.hypot(entry.x - a.x, entry.z - a.z);
    let targetSpeed = WALK_SPEED * (last ? Math.min(1, dist / 0.7 + 0.25) : 1);

    // Local avoidance: separation from walkers, yielding by priority, re-plan around stationary people.
    let sepX = 0, sepZ = 0, yieldTo: AgentRuntime | null = null, blockedByStatic = false;
    const ghost = this.time < a.ghostUntil;
    for (const o of this.list) {
      if (o === a || o.floor !== a.floor || o.fade < 0.5) continue;
      const ox = o.x - a.x, oz = o.z - a.z;
      const od = Math.hypot(ox, oz);
      if (od > 1.6 || od < 1e-4) continue;
      const ahead = (ox * dirX + oz * dirZ) / od;
      if (o.mode === "walk") {
        if (od < 1.0) { sepX -= (ox / od) * (1.0 - od); sepZ -= (oz / od) * (1.0 - od); }
        if (!ghost && od < 0.95 && ahead > 0.55 && o.index < a.index) yieldTo = o;
      } else if (od < 1.0 && ahead > 0.5 && remaining > 1.0) {
        blockedByStatic = true;
      }
    }
    if (blockedByStatic && this.time > a.replanAt) {
      a.replanAt = this.time + 1.5;
      this.planPath(a, entry, true);
    }
    if (yieldTo) {
      a.waitT += dt;
      if (a.waitT > 1.2) {
        // Step aside (to the right of the travel direction) so the other walker can pass.
        const rx = -dirZ, rz = dirX;
        dirX = rx; dirZ = rz;
        targetSpeed = 0.45;
      } else targetSpeed = 0;
    } else a.waitT = 0;

    a.speed += (targetSpeed - a.speed) * (1 - Math.exp(-6 * dt));
    let vx = dirX + sepX * 0.7, vz = dirZ + sepZ * 0.7;
    const vl = Math.hypot(vx, vz) || 1;
    vx /= vl; vz /= vl;
    const step = a.speed * dt;
    let nx = a.x + vx * step, nz = a.z + vz * step;
    const finalApproach = last && remaining < 1.2; // seat/spot entries may sit inside inflated furniture cells
    if (!finalApproach && nav.walkable(a.x, a.z) && !nav.walkable(nx, nz)) {
      // Steering pushed us toward an obstacle: follow the path direction, else slide along an axis.
      const options: Array<[number, number]> = [[a.x + dirX * step, a.z + dirZ * step], [a.x + dirX * step, a.z], [a.x, a.z + dirZ * step]];
      const ok = options.find(([x, z]) => Math.hypot(x - a.x, z - a.z) > step * 0.3 && nav.walkable(x, z));
      [nx, nz] = ok ?? [a.x + dirX * step, a.z + dirZ * step];
    }
    // Hard non-overlap: never step closer to someone already within personal space.
    if (!ghost) {
      for (const o of this.list) {
        if (o === a || o.floor !== a.floor || o.fade < 0.5) continue;
        const minD = 0.5;
        const nd = Math.hypot(nx - o.x, nz - o.z);
        if (nd < minD && nd < Math.hypot(a.x - o.x, a.z - o.z)) {
          if (o.mode === "walk" && o.index > a.index && nd > 0.44) continue; // priority walker keeps going; the other yields
          const ux = (nx - o.x) / (nd || 1), uz = (nz - o.z) / (nd || 1);
          nx = o.x + ux * minD; nz = o.z + uz * minD;
          if (!nav.walkable(nx, nz)) { nx = a.x; nz = a.z; }
        }
      }
    }
    // Hard guarantee: never step through a wall or glass partition.
    if (nav.crossesWall(a.x, a.z, nx, nz)) {
      if (!nav.crossesWall(a.x, a.z, nx, a.z)) nz = a.z;
      else if (!nav.crossesWall(a.x, a.z, a.x, nz)) nx = a.x;
      else { nx = a.x; nz = a.z; }
    }
    const moved = Math.hypot(nx - a.x, nz - a.z);
    if (moved > 1e-3) a.desiredYaw = Math.atan2(nx - a.x, nz - a.z);
    a.x = nx; a.z = nz;
    a.mode = "walk";
    a.phase += (moved / (1.35 * a.scale)) * Math.PI * 2;

    // Stuck detection → re-plan around people, then briefly ignore them as a last resort.
    a.progressT += dt;
    if (a.progressT > 2) {
      if (remaining > a.progressDist - 0.3) {
        this.planPath(a, entry, true);
        if (a.progressDist !== Infinity && remaining > a.progressDist - 0.05) a.ghostUntil = this.time + 2;
      }
      a.progressDist = remaining;
      a.progressT = 0;
    }
  }

  private currentAnim(a: AgentRuntime): CharacterAnimation {
    const t = this.time;
    if (a.mode === "walk") return "walking";
    if (a.celebrateUntil > t) return "celebrating";
    if (a.errorUntil > t) return "error";
    if (a.speakUntil > t) return "talking";
    if (a.listenTo && a.listenUntil > t) return "listening";
    switch (a.status) {
      case "working": return a.toolAnim && a.toolUntil > t ? a.toolAnim : "typing";
      case "thinking": return "thinking";
      case "collaborating":
      case "waiting": return "waiting";
      case "meeting": return "listening";
      case "error": return "error";
      case "paused": return "sitting";
      default: return "idle";
    }
  }

  private lookTarget(a: AgentRuntime): Vec2 | null {
    const t = this.time;
    const same = (slug: string | null) => {
      const o = slug ? this.agents.get(slug) : undefined;
      return o && o.floor === a.floor && o.fade > 0.5 ? { x: o.x, z: o.z } : null;
    };
    if (a.listenTo && a.listenUntil > t) { const p = same(a.listenTo); if (p) return p; }
    if (a.visit?.stage === "talk") { const p = same(a.visit.target); if (p) return p; }
    if (a.status === "collaborating" && a.waitingFor && a.waitingFor !== "approval") return same(a.waitingFor);
    return null;
  }

  private animate(a: AgentRuntime, dt: number) {
    const anim = this.currentAnim(a);
    if (anim !== a.anim) { a.anim = anim; a.animStart = this.time; }
    // Idle-at-desk pose preference: a subtle, clearly non-working seated variant.
    a.idleVariant = anim === "idle" && a.mode === "seated" && a.desk && a.seat?.id === a.desk.seat.id && a.profile.defaultAnimation !== "idle"
      ? a.profile.defaultAnimation : null;

    // Facing: standing characters turn their whole body toward a conversation partner; seated ones turn the head.
    const look = this.lookTarget(a);
    let lookRel = 0;
    if (look) {
      const want = Math.atan2(look.x - a.x, look.z - a.z);
      if (a.mode === "stand" && a.arrived) a.desiredYaw = want;
      else if (a.mode === "seated") lookRel = wrapAngle(want - a.yaw);
    }
    const yawErr = wrapAngle(a.desiredYaw - a.yaw);
    const turnK = 1 - Math.exp(-(a.mode === "walk" ? 7 : 5) * dt);
    a.yaw = wrapAngle(a.yaw + yawErr * turnK);
    if (a.mode === "stand" && look) lookRel = wrapAngle(Math.atan2(look.x - a.x, look.z - a.z) - a.yaw);

    // Gait weight follows speed; turning on the spot shuffles the feet a little.
    let gaitTarget = a.mode === "walk" ? Math.min(1, a.speed / 0.9) : 0;
    if (a.mode === "stand" && Math.abs(yawErr) > 0.3) {
      gaitTarget = 0.3;
      a.phase += Math.abs(yawErr * turnK) * 2.2;
    }
    a.gait += (gaitTarget - a.gait) * (1 - Math.exp(-8 * dt));

    const seat = a.seat;
    const seatH = seat ? seat.height : 0.47;
    const sitDrop = (seatH + 0.065) / a.scale - HIP_HEIGHT;
    computeTargetPose(a.target, {
      anim: a.anim, sit: a.sit, sitDrop,
      atTable: Boolean(seat && this.plan?.meetingRooms.has(seat.zone)),
      lounge: seat?.kind === "sofa",
      t: this.time, animTime: this.time - a.animStart, seed: a.index * 1.618, look: lookRel,
      idleVariant: a.idleVariant,
    });
    if (a.snapPose) { a.pose.set(a.target); a.snapPose = false; }
    else {
      dampPose(a.pose, a.target, 10, dt);
      // Hip height must track the scripted sit/stand exactly so the pelvis meets the seat.
      a.pose[0] = a.target[0];
    }
    a.out.set(a.pose);
    addLayers(a.out, a.phase, a.gait, this.time, a.index);
    a.look = lookRel;
  }

  // ───────────────────────── Outputs ─────────────────────────

  snapshot(): Record<string, CharacterSnapshot> {
    const out: Record<string, CharacterSnapshot> = {};
    for (const a of this.list) {
      if (a.leaving) continue;
      out[a.slug] = {
        zone: a.goal?.zone ?? a.profile.deskZone,
        floor: a.floor,
        position: [Math.round(a.x * 100) / 100, Math.round(a.z * 100) / 100],
        animation: a.anim,
        walking: a.mode === "walk",
        bubble: a.bubble?.text ?? null,
      };
    }
    return out;
  }

  isSpeaking(slug: string) {
    const a = this.agents.get(slug);
    return Boolean(a && a.speakUntil > this.time);
  }
}
