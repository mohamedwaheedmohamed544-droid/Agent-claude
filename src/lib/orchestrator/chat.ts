import { query, queryOne } from "../db";
import { badRequest, notFound } from "../errors";
import { searchMemory } from "../memory/store";
import { redactSecrets } from "../security/crypto";
import { createTaskFromPlan, kickTask, activeAgentSlugs } from "./engine";
import { planRequest, type Plan } from "./planner";

export interface ChatInput {
  workspaceId: string;
  userId: string;
  locale: "en" | "ar";
  conversationId?: string | null;
  text: string;
  fileIds?: string[];
}

export interface MessageRow {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentSlug: string | null;
  taskId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const MSG_COLS = `id, role, content, agent_slug AS "agentSlug", task_id AS "taskId", metadata, created_at AS "createdAt"`;

export async function handleChatMessage(input: ChatInput): Promise<{ conversationId: string; userMessage: MessageRow; reply: MessageRow; taskId: string | null; plan: Plan }> {
  const text = input.text.trim();
  if (!text) throw badRequest("Message is empty");
  if (text.length > 20_000) throw badRequest("Message is too long (max 20,000 characters)");

  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const c = await queryOne("SELECT 1 FROM conversations WHERE id=$1 AND workspace_id=$2 AND user_id=$3", [conversationId, input.workspaceId, input.userId]);
    if (!c) throw notFound("Conversation not found");
  } else {
    const c = await queryOne<{ id: string }>(
      "INSERT INTO conversations(workspace_id, user_id, title) VALUES ($1,$2,$3) RETURNING id",
      [input.workspaceId, input.userId, text.replace(/\s+/g, " ").slice(0, 80)],
    );
    conversationId = c!.id;
  }

  let attachments: Array<{ id: string; filename: string }> = [];
  if (input.fileIds?.length) {
    attachments = await query<{ id: string; filename: string }>(
      "SELECT id, filename FROM knowledge_files WHERE workspace_id=$1 AND id = ANY($2::uuid[])", [input.workspaceId, input.fileIds],
    );
  }

  // Load history BEFORE inserting the new message.
  const history = (await query<{ role: "user" | "assistant"; content: string }>(
    `SELECT role, content FROM messages WHERE conversation_id=$1 AND role IN ('user','assistant') ORDER BY created_at DESC LIMIT 12`,
    [conversationId],
  )).reverse();

  const userMessage = (await queryOne<MessageRow>(
    `INSERT INTO messages(conversation_id, workspace_id, user_id, role, content, metadata) VALUES ($1,$2,$3,'user',$4,$5) RETURNING ${MSG_COLS}`,
    [conversationId, input.workspaceId, input.userId, redactSecrets(text), { attachments }],
  ))!;

  const [memories, activeAgents] = await Promise.all([
    searchMemory(input.workspaceId, input.userId, text, { limit: 5 }).catch(() => []),
    activeAgentSlugs(input.workspaceId),
  ]);

  const objective = attachments.length ? `${text}\n\n[Attached files: ${attachments.map((a) => `${a.filename} (id ${a.id})`).join(", ")}]` : text;
  let plan: Plan;
  try {
    plan = await planRequest({
      workspaceId: input.workspaceId, userId: input.userId, request: objective, history, attachments,
      memoryContext: memories.map((m) => m.content), activeAgents, locale: input.locale,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await queryOne(
      `INSERT INTO messages(conversation_id, workspace_id, role, content, agent_slug, metadata) VALUES ($1,$2,'assistant',$3,'orchestrator',$4) RETURNING id`,
      [conversationId, input.workspaceId, `I couldn't plan this request: ${redactSecrets(msg).slice(0, 300)}`, { kind: "error" }],
    );
    throw e;
  }

  let reply: MessageRow;
  let taskId: string | null = null;
  if (plan.mode === "direct") {
    reply = (await queryOne<MessageRow>(
      `INSERT INTO messages(conversation_id, workspace_id, role, content, agent_slug, metadata) VALUES ($1,$2,'assistant',$3,'orchestrator',$4) RETURNING ${MSG_COLS}`,
      [conversationId, input.workspaceId, redactSecrets(plan.reply ?? ""), { kind: "direct" }],
    ))!;
  } else {
    taskId = await createTaskFromPlan({ workspaceId: input.workspaceId, userId: input.userId, conversationId, objective, plan });
    const agents = [...new Set(plan.steps.map((s) => s.agent))];
    const content = input.locale === "ar"
      ? `بدأت المهمة "${plan.title}" — ${plan.steps.length} خطوة/خطوات بواسطة: ${agents.join("، ")}.`
      : `Started task "${plan.title}" — ${plan.steps.length} step(s) handled by: ${agents.join(", ")}.`;
    reply = (await queryOne<MessageRow>(
      `INSERT INTO messages(conversation_id, workspace_id, role, content, agent_slug, task_id, metadata) VALUES ($1,$2,'assistant',$3,'orchestrator',$4,$5) RETURNING ${MSG_COLS}`,
      [conversationId, input.workspaceId, content, taskId, { kind: "task_started", plan: { mode: plan.mode, steps: plan.steps.map((s) => ({ key: s.key, agent: s.agent, title: s.title, depends_on: s.depends_on })) } }],
    ))!;
    kickTask(taskId);
  }
  await query("UPDATE conversations SET updated_at=now() WHERE id=$1", [conversationId]);
  return { conversationId, userMessage, reply, taskId, plan };
}

export async function listMessages(workspaceId: string, userId: string, conversationId: string): Promise<MessageRow[]> {
  const c = await queryOne("SELECT 1 FROM conversations WHERE id=$1 AND workspace_id=$2 AND user_id=$3", [conversationId, workspaceId, userId]);
  if (!c) throw notFound("Conversation not found");
  return query<MessageRow>(`SELECT ${MSG_COLS} FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT 500`, [conversationId]);
}
