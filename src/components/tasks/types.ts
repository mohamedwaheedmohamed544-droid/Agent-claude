/** Client-side shapes of the task / approval / artifact API responses (see src/app/api/tasks/[id]/route.ts). */

export type TaskStatus = "draft" | "planned" | "running" | "waiting_approval" | "paused" | "completed" | "failed" | "cancelled";

export interface Source { title: string; url?: string; fileId?: string; kind: "web" | "document" }
export interface ArtifactRef { id: string; title: string; format?: string }

export interface StepMeta {
  sources?: Source[];
  artifacts?: ArtifactRef[];
  toolCalls?: Array<{ name: string; status: string }>;
  model?: string;
}

export interface TaskStep {
  id: string;
  key: string;
  position: number;
  agent: string;
  title: string;
  input: string;
  expectedOutput: string | null;
  condition: string | null;
  status: string;
  output: string | null;
  meta: StepMeta | null;
  error: { message?: string; attempt?: number; recoverable?: boolean } | null;
  attempts: number;
  maxAttempts: number;
  startedAt: string | null;
  completedAt: string | null;
  dependsOn: string[];
}

export interface ToolExecution {
  id: string;
  stepId: string | null;
  toolName: string;
  agent: string | null;
  riskLevel: number;
  status: string;
  error: string | null;
  durationMs: number | null;
  approvalId: string | null;
  createdAt: string;
}

export interface TaskArtifact {
  id: string;
  kind: string;
  title: string;
  format: string;
  sizeBytes: number;
  agent: string | null;
  createdAt: string;
  taskId?: string | null;
  taskTitle?: string | null;
}

export interface Approval {
  id: string;
  taskId: string | null;
  stepId: string | null;
  toolName: string;
  riskLevel: number;
  agentSlug: string | null;
  summary: string;
  destination: string | null;
  params: Record<string, unknown>;
  paramsHash: string;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expiresAt: string;
  createdAt: string;
  taskTitle: string | null;
  taskCreatedBy: string | null;
}

export interface TaskUsage { promptTokens: number; completionTokens: number; costUsd: number; calls: number }

export interface TaskRecord {
  id: string;
  title: string;
  objective: string;
  status: TaskStatus;
  mode: string;
  result: string | null;
  summary: string | null;
  error: { message?: string } | null;
  conversationId: string | null;
  parentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  runCount: number;
  createdByName: string | null;
}

export interface TaskDetail {
  task: TaskRecord;
  steps: TaskStep[];
  toolExecutions: ToolExecution[];
  artifacts: TaskArtifact[];
  approvals: Approval[];
  usage: TaskUsage | null;
}

export interface TaskListItem {
  id: string;
  title: string;
  status: TaskStatus;
  mode: string;
  summary: string | null;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdByName: string | null;
  stepCount: number;
  stepsDone: number;
  agents: string[] | null;
  pendingApprovals: number;
}

export interface TaskListResponse { tasks: TaskListItem[]; counts: Record<string, number> }
