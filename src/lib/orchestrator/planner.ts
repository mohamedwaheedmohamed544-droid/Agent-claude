import { chatJson, type ChatMessage } from "../ai/llm";
import { buildOrchestratorPrompt, type RosterEntry } from "../agents/definitions";
import { wrapUntrusted } from "../security/untrusted";

export interface PlanStep {
  key: string;
  agent: string;
  title: string;
  instruction: string;
  expected_output: string;
  depends_on: string[];
  condition: string | null;
  /** "meeting" = real multi-agent meeting chaired by the orchestrator; `agent` is ignored for meetings. */
  kind?: "agent" | "meeting";
  participants?: string[];
}

export interface Plan {
  mode: "direct" | "single" | "multi";
  title: string;
  reply: string | null;
  steps: PlanStep[];
}

export const planSchema = (slugs: string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["mode", "title", "reply", "steps"],
  properties: {
    mode: { type: "string", enum: ["direct", "single", "multi"] },
    title: { type: "string" },
    reply: { anyOf: [{ type: "string" }, { type: "null" }] },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "kind", "agent", "participants", "title", "instruction", "expected_output", "depends_on", "condition"],
        properties: {
          key: { type: "string" },
          kind: { type: "string", enum: ["agent", "meeting"] },
          agent: { type: "string", enum: slugs.length ? slugs : ["none"] },
          participants: { type: "array", items: { type: "string", enum: slugs.length ? slugs : ["none"] } },
          title: { type: "string" },
          instruction: { type: "string" },
          expected_output: { type: "string" },
          depends_on: { type: "array", items: { type: "string" } },
          condition: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    },
  },
});

export class PlanValidationError extends Error {}

/** Validates structure and makes the dependency graph a DAG. Returns a normalised plan. */
export function validatePlan(plan: Plan, activeAgents: string[], meetingCapable: string[] = activeAgents): Plan {
  if (!["direct", "single", "multi"].includes(plan.mode)) throw new PlanValidationError("Invalid mode");
  if (plan.mode === "direct") {
    if (!plan.reply?.trim()) throw new PlanValidationError("Direct mode requires a reply");
    return { ...plan, steps: [] };
  }
  if (!plan.steps.length) throw new PlanValidationError("Plan has no steps");
  if (plan.steps.length > 8) throw new PlanValidationError("Plan has too many steps (max 8)");
  const keys = new Set<string>();
  for (const s of plan.steps) {
    s.key = s.key.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || `step_${keys.size + 1}`;
    if (keys.has(s.key)) throw new PlanValidationError(`Duplicate step key ${s.key}`);
    keys.add(s.key);
    s.kind = s.kind === "meeting" ? "meeting" : "agent";
    if (s.kind === "meeting") {
      s.participants = [...new Set(s.participants ?? [])];
      if (s.participants.length < 2 || s.participants.length > 4) throw new PlanValidationError(`Meeting ${s.key} needs 2–4 specialist participants`);
      const bad = s.participants.find((p) => !activeAgents.includes(p) || !meetingCapable.includes(p));
      if (bad) throw new PlanValidationError(`Unknown or inactive meeting participant ${bad}`);
      s.agent = "orchestrator";
    } else {
      s.participants = [];
      if (!activeAgents.includes(s.agent)) throw new PlanValidationError(`Unknown or inactive agent ${s.agent}`);
    }
    if (!s.instruction?.trim()) throw new PlanValidationError(`Step ${s.key} has no instruction`);
  }
  for (const s of plan.steps) {
    s.depends_on = [...new Set(s.depends_on.filter((d) => d !== s.key))];
    const bad = s.depends_on.find((d) => !keys.has(d));
    if (bad) throw new PlanValidationError(`Step ${s.key} depends on unknown step ${bad}`);
  }
  // Cycle detection (Kahn's algorithm)
  const indeg = new Map(plan.steps.map((s) => [s.key, s.depends_on.length]));
  const queue = plan.steps.filter((s) => !s.depends_on.length).map((s) => s.key);
  let seen = 0;
  while (queue.length) {
    const k = queue.shift()!;
    seen++;
    for (const s of plan.steps) if (s.depends_on.includes(k)) {
      indeg.set(s.key, indeg.get(s.key)! - 1);
      if (indeg.get(s.key) === 0) queue.push(s.key);
    }
  }
  if (seen !== plan.steps.length) throw new PlanValidationError("Plan dependencies contain a cycle");
  return { ...plan, mode: plan.steps.length > 1 ? "multi" : "single" };
}

export interface PlanInput {
  workspaceId: string;
  userId: string | null;
  request: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  attachments?: Array<{ id: string; filename: string }>;
  memoryContext?: string[];
  /** Live roster from the database (assignable specialists). */
  roster: RosterEntry[];
  locale?: "en" | "ar";
}

export async function planRequest(input: PlanInput): Promise<Plan> {
  const historyText = input.history.slice(-10).map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 2000)}`).join("\n");
  const user = [
    historyText ? `Recent conversation (data):\n${wrapUntrusted("conversation_history", historyText)}` : "",
    input.memoryContext?.length ? `Known user/workspace context:\n${wrapUntrusted("memory", input.memoryContext.map((m) => `- ${m}`).join("\n"))}` : "",
    input.attachments?.length ? `Files attached to this message (agents can read them by id): ${input.attachments.map((a) => `${a.filename} (id ${a.id})`).join(", ")}` : "",
    `The user's interface language is ${input.locale === "ar" ? "Arabic" : "English"}.`,
    `Plan the response to this request:`,
    `<user_request>${input.request}</user_request>`,
  ].filter(Boolean).join("\n\n");
  const messages: ChatMessage[] = [{ role: "user", content: user }];

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data } = await chatJson<Plan>({
      system: buildOrchestratorPrompt(input.roster),
      messages: lastErr ? [...messages, { role: "user", content: `Your previous plan was invalid: ${lastErr.message}. Return a corrected plan.` }] : messages,
      jsonSchema: { name: "task_plan", schema: planSchema(input.roster.map((r) => r.slug)) as unknown as Record<string, unknown> },
      tier: "standard",
      ctx: { workspaceId: input.workspaceId, userId: input.userId, agentSlug: "orchestrator", purpose: "planning" },
    });
    try {
      return validatePlan(data, input.roster.map((r) => r.slug), input.roster.filter((r) => r.canJoinMeetings).map((r) => r.slug));
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new PlanValidationError("Planning failed");
}
