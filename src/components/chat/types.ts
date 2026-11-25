import type { ArtifactRef, Source } from "@/components/tasks/types";

export interface Conversation {
  id: string;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

export interface MessageMeta {
  kind?: "direct" | "task_started" | "task_result" | "task_failed" | "error";
  attachments?: Array<{ id: string; filename: string }>;
  plan?: { mode?: string; steps: Array<{ key: string; agent: string; title: string; depends_on: string[] }> };
  sources?: Source[];
  artifacts?: ArtifactRef[];
  agents?: string[];
  summary?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentSlug: string | null;
  taskId: string | null;
  metadata: MessageMeta | null;
  createdAt: string;
  /** Client-only: optimistic message not yet confirmed by the server. */
  pending?: boolean;
}

export interface ChatResponse {
  conversationId: string;
  userMessage: ChatMessage;
  reply: ChatMessage;
  taskId: string | null;
  mode: string;
}

export interface UploadedFile {
  id: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  status: string;
  error?: string | null;
}
