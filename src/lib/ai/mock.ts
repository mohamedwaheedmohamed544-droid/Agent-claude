/**
 * Deterministic mock LLM used ONLY for automated tests (NEXUS_LLM_PROVIDER=mock).
 * It is blocked in production (see isMockMode) and every response is labelled as mock output.
 * It follows simple keyword rules so routing, tool calling, approvals and multi-agent
 * orchestration can be exercised end-to-end without network access.
 */
import type { ChatRequest, ToolCall, WebSearchResult } from "./llm";
import { estimateTokens } from "./models";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "object" && p && "text" in p ? String((p as { text: string }).text) : "")).join(" ");
  return "";
}

let callCounter = 0;

function planFor(objective: string) {
  const o = objective.toLowerCase();
  const step = (key: string, agent: string, title: string, instruction: string, depends_on: string[] = []) => ({
    key, agent, title, instruction, expected_output: `Output of ${title}`, depends_on, condition: null as string | null,
  });
  if (/^(hi|hello|hey|مرحبا|السلام)\b/.test(o.trim()) && o.length < 40) {
    return { mode: "direct", title: "Greeting", reply: "[mock] Hello! I'm Nexus AI. How can I help today?", steps: [] };
  }
  if (o.includes("webhook")) {
    return { mode: "single", title: "Post webhook", reply: null, steps: [step("s1", "operations", "Send webhook", objective)] };
  }
  if (o.includes("work item") && o.includes("complete")) {
    return { mode: "single", title: "Update work item", reply: null, steps: [step("s1", "operations", "Update work item", objective)] };
  }
  if (o.includes("[fail]")) {
    return { mode: "single", title: "Failing task", reply: null, steps: [step("s1", "research", "Failing step", objective)] };
  }
  if (o.includes("[multi]") || (o.includes("research") && (o.includes("write") || o.includes("report")))) {
    return {
      mode: "multi", title: "Research and write", reply: null,
      steps: [
        step("research", "research", "Research the topic", `Search the knowledge base and web for: ${objective}`),
        step("analysis", "marketing", "Analyse positioning", `Analyse market positioning for: ${objective}`),
        step("write", "writing", "Write the report", `Write a document report based on prior findings for: ${objective}`, ["research", "analysis"]),
      ],
    };
  }
  const routes: Array<[RegExp, string]> = [
    [/(document|rfp|pdf|contract|compliance)/, "documents"],
    [/(lead|prospect|company|crm|pipeline)/, "business_development"],
    [/(analy|kpi|data|spreadsheet|forecast)/, "analytics"],
    [/(schedule|task|checklist|process|work item)/, "operations"],
    [/(market|campaign|segment|positioning)/, "marketing"],
    [/(write|email|draft|linkedin|proposal)/, "writing"],
    [/(research|search|find|competitor)/, "research"],
  ];
  const agent = routes.find(([re]) => re.test(o))?.[1] ?? "research";
  return { mode: "single", title: objective.slice(0, 60), reply: null, steps: [step("s1", agent, `Handle: ${objective.slice(0, 40)}`, objective)] };
}

export function mockChat(req: ChatRequest): { content: string | null; toolCalls: ToolCall[]; promptTokens: number; completionTokens: number } {
  const allText = req.messages.map((m) => textOf((m as { content?: unknown }).content)).join("\n");
  const promptTokens = estimateTokens(allText);
  const done = (content: string | null, toolCalls: ToolCall[] = []) => ({
    content, toolCalls, promptTokens, completionTokens: estimateTokens(content ?? JSON.stringify(toolCalls)),
  });
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
  const userText = textOf(lastUser?.content);

  if (req.jsonSchema?.name === "task_plan") {
    const m = userText.match(/<user_request>([\s\S]*?)<\/user_request>/);
    return done(JSON.stringify(planFor((m?.[1] ?? userText).trim())));
  }
  if (req.jsonSchema?.name === "step_condition") return done(JSON.stringify({ proceed: true, reason: "mock: condition satisfied" }));
  if (req.jsonSchema?.name === "memory_extraction") return done(JSON.stringify({ memories: [] }));
  if (req.jsonSchema) return done("{}");

  const last = req.messages[req.messages.length - 1];
  const toolNames = new Set((req.tools ?? []).map((t) => t.function.name));
  if (last?.role === "tool") {
    const toolResults = req.messages.filter((m) => m.role === "tool").map((m) => textOf(m.content).slice(0, 200));
    return done(`[mock] Step complete. Based on ${toolResults.length} tool result(s): ${toolResults.join(" | ")}`);
  }
  if (req.tools?.length) {
    const step = userText.toLowerCase();
    const call = (name: string, args: Record<string, unknown>): ToolCall => ({ id: `call_${++callCounter}`, name, arguments: JSON.stringify(args) });
    if (step.includes("[fail]")) throw new Error("mock: simulated provider failure");
    if (step.includes("webhook") && toolNames.has("http_post_webhook")) {
      const url = userText.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? "https://example.com/hook";
      return done(null, [call("http_post_webhook", { url, payload: { message: "Hello from Nexus" } })]);
    }
    if (step.includes("work item") && step.includes("complete") && toolNames.has("update_work_item")) {
      const id = userText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? "00000000-0000-0000-0000-000000000000";
      return done(null, [call("update_work_item", { id, status: "done" })]);
    }
    if (step.includes("write a document") && toolNames.has("create_document")) {
      return done(null, [call("create_document", { title: "Mock Report", format: "docx", content: "# Mock Report\n\nGenerated in test mode.\n\n| Metric | Value |\n|---|---|\n| Market | GCC |" })]);
    }
    const calls: ToolCall[] = [];
    if (toolNames.has("knowledge_search") && /(search|knowledge|document)/.test(step)) calls.push(call("knowledge_search", { query: userText.slice(0, 100), limit: 3 }));
    if (toolNames.has("web_search") && step.includes("web")) calls.push(call("web_search", { query: userText.slice(0, 100) }));
    if (calls.length) return done(null, calls);
  }
  return done(`[mock] Response for: ${userText.slice(0, 160)}`);
}

/** Deterministic bag-of-words hashing embedding so lexical overlap ≈ semantic similarity in tests. */
export function mockEmbed(text: string): number[] {
  const v = new Array(1536).fill(0);
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 2)) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[Math.abs(h) % 1536] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function mockWebSearch(q: string): WebSearchResult {
  return {
    answer: `[mock web search — not real data] Results for "${q}".`,
    sources: [{ title: "Mock source (test mode)", url: "https://example.com/mock-source" }],
  };
}
