/**
 * Shared, client-safe contract between the Nexus office backend (events/presence/meetings)
 * and the 3D office UI. Every value here is derived from real orchestration state.
 */

/**
 * Logical place in the office: a department key (e.g. "research"), a meeting room key
 * (e.g. "meeting_room", "meeting_room_2") or a lounge key ("lounge", "lounge_2").
 * Zones are data-driven (departments are created by admins); positions come from the layout engine.
 */
export type OfficeZone = string;

export type OfficeLayoutMode = "compact" | "standard" | "expanded" | "large" | "multi_floor" | "custom";

export interface LayoutWorkstation {
  id: string;
  index: number;              // stable order within its department
  agentSlug: string | null;   // occupant (null = free desk)
}

export interface LayoutDepartment {
  key: string;
  name: string;
  nameAr: string;
  color: string;
  kind: "executive" | "department";
  floor: number;              // 0-based
  managerSlug: string | null;
  meetingRoomKey: string | null;
  workstations: LayoutWorkstation[];
}

export interface LayoutMeetingRoom { key: string; name: string; nameAr: string; floor: number; seats: number }
export interface LayoutLounge { key: string; floor: number }

/**
 * Logical office plan computed on the server from departments, workstations, visible agents and
 * office settings. The 3D layout engine turns it into geometry deterministically, so the same spec
 * always yields the same positions (stable identities across incremental updates).
 */
export interface OfficeLayoutSpec {
  mode: OfficeLayoutMode;
  auto: boolean;
  floors: number;
  departments: LayoutDepartment[];
  meetingRooms: LayoutMeetingRoom[];
  lounges: LayoutLounge[];
  characterScale: number;     // 0.8–1.25
  showLabels: boolean;
  ambientLounge: boolean;     // idle agents may stroll to the lounge after 60 s
  camera: { defaultView: "overview" | "executive"; autoRotate: boolean };
  /** Monotonic hash of the spec; changes whenever the plan changes. */
  revision: string;
}

/** Persistent operational status of an agent (changes only on real backend events). */
export type AgentStatus =
  | "idle"
  | "working"     // a task step is running for this agent
  | "thinking"    // orchestrator planning a newly received task
  | "collaborating" // blocked on another agent's output (waitingFor = that agent)
  | "waiting"     // waiting for a user approval
  | "meeting"     // participating in an in-progress meeting
  | "error"       // its latest step failed recently
  | "paused";     // deactivated by an admin (lifecycle inactive) — not shown in the active office

/** Animation the character should play. Derived on the client from status + latest event. */
export type CharacterAnimation =
  | "idle" | "walking" | "working" | "typing" | "thinking" | "reading" | "talking"
  | "listening" | "meeting" | "waiting" | "celebrating" | "error" | "sitting";

export type ActivityEventType =
  | "task_received"        // orchestrator received a user task
  | "delegated"            // orchestrator delegated a step to a specialist (related_agent = specialist)
  | "step_started"         // agent started working on its assigned step
  | "tool_used"            // agent used a tool (payload.tool, payload.status, payload.riskLevel)
  | "waiting_approval"     // agent paused for a user approval
  | "message_sent"         // agent sent a message (related_agent = recipient, payload.messageId)
  | "message_received"     // agent received a message (related_agent = sender, payload.messageId)
  | "meeting_started"      // meeting began (meeting_id)
  | "meeting_message"      // an agent spoke in a meeting (payload.messageId, payload.content)
  | "meeting_ended"
  | "step_completed"
  | "step_failed"
  | "task_completed"
  | "task_failed"
  | "idle"
  // Workforce changes (payload.slug): the office reloads profiles + layout incrementally.
  | "agent_created" | "agent_updated" | "agent_activated" | "agent_deactivated" | "agent_archived"
  | "agent_restored" | "agent_deleted" | "agent_moved" | "office_layout_changed";

export interface ActivityEvent {
  id: string;               // bigserial as string, monotonically increasing per workspace stream
  agent: string;            // agent slug ("orchestrator" = راشد)
  type: ActivityEventType;
  taskId: string | null;
  stepId: string | null;
  meetingId: string | null;
  relatedAgent: string | null;
  zone: OfficeZone | null;
  summary: string;          // short human-readable line (real content, may be Arabic/English)
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AgentPresence {
  agent: string;
  status: AgentStatus;
  zone: OfficeZone;         // where the agent should be (desk zone, meeting_room …)
  activity: string | null;  // e.g. current step title
  taskId: string | null;
  taskTitle: string | null;
  stepId: string | null;
  meetingId: string | null;
  waitingFor: string | null; // agent slug or "approval"
  since: string;
}

export interface AgentProfile {
  slug: string;             // English technical identifier
  nameAr: string;
  nameEn: string;           // transliteration
  titleAr: string;
  titleEn: string;
  color: string;            // primary accent (hex)
  deskZone: OfficeZone;     // department key
  workstationId: string | null;
  appearance: CharacterAppearance;
  defaultAnimation: "idle" | "working" | "reading" | "thinking";
  isOrchestrator: boolean;
}

/** Stylized adult professional character description (procedurally modelled). */
export interface CharacterAppearance {
  /** "neutral" = gender-neutral stylized professional (no gendered attire). */
  gender: "male" | "female" | "neutral";
  skin: string;
  outfit: "thobe" | "suit" | "abaya" | "blazer" | "shirt" | "turtleneck" | "cardigan";
  outfitColor: string;
  headwear: "ghutra" | "shemagh" | "hijab" | "none";
  headwearColor: string;
  hairColor: string;
  accessory: "glasses" | "headset" | "tablet" | "pen" | "watch" | "laptop" | "folder" | "none";
  height: number;           // metres, ~1.62–1.85
}

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  kind: "delegation" | "handoff" | "result" | "meeting_invite";
  content: string;
  taskId: string | null;
  stepId: string | null;
  meetingId: string | null;
  createdAt: string;
}

export interface MeetingSummary {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  objective: string;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  chair: string;
  participants: string[];
  startedAt: string | null;
  completedAt: string | null;
  messageCount: number;
}

export interface MeetingMessage {
  id: string;
  agent: string;
  round: number;
  kind: "statement" | "summary";
  content: string;
  createdAt: string;
}

export interface MeetingDetail extends MeetingSummary {
  agenda: string[];
  summary: string | null;
  decisions: string[];
  actionItems: Array<{ owner: string; item: string }>;
  messages: MeetingMessage[];
}

export interface OfficeDashboard {
  totalAgents: number;
  activeAgents: number;
  idleAgents: number;
  inMeetings: number;
  runningTasks: number;
  completedTasks: number;
  pendingApprovals: number;
  currentMeetings: number;
}

export interface OfficeState {
  profiles: AgentProfile[];     // active, visible agents only (the office workforce)
  layout: OfficeLayoutSpec;
  /** Every non-deleted agent (incl. inactive/archived) for resolving names in history and feeds. */
  directory: Array<{ slug: string; nameAr: string; nameEn: string; titleEn: string; titleAr: string; color: string; lifecycle: string; isOrchestrator: boolean }>;
  presence: AgentPresence[];
  dashboard: OfficeDashboard;
  meetings: MeetingSummary[];   // in-progress first, then recent
  events: ActivityEvent[];      // most recent (ascending by id)
  messages: AgentMessage[];     // most recent agent-to-agent messages (ascending)
  lastEventId: string | null;
}

/** Server-sent event payloads on /api/office/stream. */
export type OfficeStreamEvent =
  | { kind: "events"; events: ActivityEvent[] }
  | { kind: "presence"; presence: AgentPresence[] }
  | { kind: "messages"; messages: AgentMessage[] };
