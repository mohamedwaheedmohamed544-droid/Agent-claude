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
  if (Array.isArray(content)) {
    return content.map((p) => {
      if (!p || typeof p !== "object") return "";
      const b = p as { type?: string; text?: string; content?: unknown };
      if (b.type === "text") return b.text ?? "";
      if (b.type === "tool_result") return textOf(b.content);
      return "";
    }).join(" ");
  }
  return "";
}

function isToolResultTurn(m: { role: string; content?: unknown } | undefined): boolean {
  return Boolean(m && m.role === "user" && Array.isArray(m.content) && m.content.some((b: { type?: string }) => b?.type === "tool_result"));
}

let callCounter = 0;

function planFor(objective: string) {
  const o = objective.toLowerCase();
  const step = (key: string, agent: string, title: string, instruction: string, depends_on: string[] = []) => ({
    key, kind: "agent", agent, participants: [] as string[], title, instruction, expected_output: `Output of ${title}`, depends_on, condition: null as string | null,
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
  if (o.includes("[meeting]") || o.includes("comparison report")) {
    return {
      mode: "multi", title: "Competitor comparison", reply: null,
      steps: [
        step("research", "research", "Research the competitors", `Search the knowledge base and web for: ${objective}`),
        { key: "review", kind: "meeting", agent: "research", participants: ["research", "documents"], title: "Review research findings",
          instruction: "Review the research findings; agree the comparison criteria; decide the report structure", expected_output: "Decisions and action items",
          depends_on: ["research"], condition: null as string | null },
        step("write", "writing", "Write the comparison report", `Write a document report based on prior findings for: ${objective}`, ["review"]),
      ],
    };
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
  const allText = [req.system, ...req.messages.map((m) => textOf(m.content))].join("\n");
  const promptTokens = estimateTokens(allText);
  const done = (content: string | null, toolCalls: ToolCall[] = []) => ({
    content, toolCalls, promptTokens, completionTokens: estimateTokens(content ?? JSON.stringify(toolCalls)),
  });
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user" && !isToolResultTurn(m));
  const userText = textOf(lastUser?.content);

  if (req.jsonSchema?.name === "task_plan") {
    const m = userText.match(/<user_request>([\s\S]*?)<\/user_request>/);
    return done(JSON.stringify(planFor((m?.[1] ?? userText).trim())));
  }
  if (req.jsonSchema?.name === "step_condition") return done(JSON.stringify({ proceed: true, reason: "mock: condition satisfied" }));
  if (req.jsonSchema?.name === "agent_draft") {
    const m = userText.match(/<request>([\s\S]*?)<\/request>/);
    const request = (m?.[1] ?? userText).trim();
    const lower = request.toLowerCase();
    const name = request.match(/(?:called|named|اسمه|يسمى)\s+["“]?([^\s"”.,،]+)/i)?.[1] ?? "مساعد";
    const skills = [
      ...(lower.includes("web research") || lower.includes("research") ? ["web_research"] : []),
      ...(lower.includes("document") ? ["document_analysis"] : []),
      ...(lower.includes("tender") ? ["tender_analysis"] : []),
    ];
    return done(JSON.stringify({
      nameAr: name, nameEn: lower.includes("procurement") ? "Procurement Researcher" : "Assistant Agent",
      roleTitle: lower.includes("procurement") ? "Procurement Research Agent" : "Specialist Agent", roleTitleAr: "وكيل متخصص",
      description: `[mock] Agent designed from: ${request.slice(0, 160)}`, descriptionAr: "[mock] وكيل مصمم من الطلب",
      personality: "Precise and concise.", main: request.slice(0, 300), instructions: "[mock] Follow the request; report findings to the supervisor.",
      expertise: ["Procurement research"], deliverables: ["Opportunity reports"], methodology: "Search, analyse, report.", successCriteria: ["Accurate, cited findings"],
      skills, tools: ["web_search", "fetch_url", "knowledge_search", "list_files", "read_file", "create_document"], maxRiskLevel: 2,
      departmentKey: "research", supervisor: "orchestrator", collaboratesWith: ["documents"], avatarPreset: "neutral_turtleneck", tier: "standard",
      rationale: "[mock] Research + document skills match the request; drafting only (risk level 2).",
      missingCapabilities: lower.includes("procurement") ? [{ capability: "Monitoring government procurement portals", skillKey: "procurement_monitoring", skillName: "Procurement monitoring", skillDescription: "Track government tender portals and summarise new opportunities.", requiredTools: ["web_search", "fetch_url"] }] : [],
    }));
  }
  if (req.jsonSchema?.name === "meeting_summary") {
    return done(JSON.stringify({
      summary: "[mock] The team reviewed the findings and agreed the comparison structure.",
      decisions: ["[mock] Compare competitors on pricing, features and market share"],
      action_items: [{ owner: "documents", item: "[mock] Prepare the comparison matrix" }],
    }));
  }
  if (req.ctx.purpose === "meeting_statement") {
    const round = userText.match(/Round (\d+) of/)?.[1] ?? "1";
    return done(`[mock] ${req.ctx.agentSlug} contribution, round ${round}: findings reviewed against the agenda.`);
  }
  if (req.jsonSchema?.name === "memory_extraction") return done(JSON.stringify({ memories: [] }));
  if (req.jsonSchema) return done("{}");

  const last = req.messages[req.messages.length - 1];
  const toolNames = new Set((req.tools ?? []).map((t) => t.name));
  if (isToolResultTurn(last)) {
    const toolResults = req.messages.filter(isToolResultTurn).map((m) => textOf(m.content).slice(0, 200));
    return done(`[mock] Step complete. Based on ${toolResults.length} tool result(s): ${toolResults.join(" | ")}`);
  }
  if (req.tools?.length) {
    const step = userText.toLowerCase();
    const call = (name: string, args: Record<string, unknown>): ToolCall => ({ id: `toolu_mock_${++callCounter}`, name, input: args });
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
  const v = new Array(1024).fill(0);
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 2)) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[Math.abs(h) % 1024] += 1;
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
