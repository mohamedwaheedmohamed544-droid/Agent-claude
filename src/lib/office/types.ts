/**
 * Shared, client-safe contract between the Nexus office backend (events/presence/meetings)
 * and the 3D office UI. Every value here is derived from real orchestration state.
 */

/** Logical places in the office. Positions live in the 3D layout; the backend only uses names. */
export type OfficeZone =
  | "executive"      // راشد's office
  | "research"       // باحث
  | "bizdev"         // رائد
  | "documents"      // بيان
  | "writing"        // قلم (content studio)
  | "analytics"      // بصيرة
  | "operations"     // تميم
  | "marketing"      // أثر
  | "meeting_room"
  | "lounge";

/** Persistent operational status of an agent (changes only on real backend events). */
export type AgentStatus =
  | "idle"
  | "working"     // a task step is running for this agent
  | "waiting"     // blocked on another agent's output or on a user approval
  | "meeting"     // participating in an in-progress meeting
  | "error"       // its latest step failed recently
  | "paused";     // disabled by an admin (agents.active = false)

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
  | "idle";

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
  deskZone: OfficeZone;
  appearance: CharacterAppearance;
}

/** Stylized adult professional character description (procedurally modelled). */
export interface CharacterAppearance {
  gender: "male" | "female";
  skin: string;
  outfit: "thobe" | "suit" | "abaya" | "blazer" | "shirt";
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
  profiles: AgentProfile[];
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
