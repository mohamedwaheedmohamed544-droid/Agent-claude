import { z } from "zod";
import ExcelJS from "exceljs";
import { query, queryOne } from "../db";
import { webSearch } from "../ai/llm";
import { searchKnowledge } from "../knowledge/search";
import { addMemory, searchMemory } from "../memory/store";
import { markdownToDocx, rowsToXlsx, saveArtifact } from "../artifacts";
import { htmlToText, safeFetch } from "../security/net";
import { parseCsv } from "../knowledge/parsers";
import { getWorkspaceSettings } from "../settings";
import { defineTool, ToolUserError, type ToolDefinition } from "./types";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a UUID");

// ─────────────── Level 1: Read ───────────────

const knowledgeSearch = defineTool({
  name: "knowledge_search",
  description: "Semantic + keyword search over the workspace's uploaded documents and knowledge bases. Returns relevant passages with file names.",
  category: "knowledge",
  riskLevel: 1,
  input: z.object({
    query: z.string().min(2).max(500),
    limit: z.number().int().min(1).max(12).optional(),
    file_ids: z.array(uuid).max(20).optional(),
  }),
  output: { hits: "Array<{ file, file_id, chunk, score, content }>" },
  requiredPermissions: ["knowledge:read"],
  handler: async (i, ctx) => {
    const hits = await searchKnowledge(ctx.workspaceId, i.query, { userId: ctx.userId, taskId: ctx.taskId, agentSlug: ctx.agentSlug }, { limit: i.limit ?? 6, fileIds: i.file_ids });
    return { hits: hits.map((h) => ({ file: h.filename, file_id: h.fileId, chunk: h.chunkIndex, score: h.score, content: h.content })) };
  },
});

const memorySearch = defineTool({
  name: "memory_search",
  description: "Search approved long-term memory (user preferences, workspace facts, past decisions).",
  category: "memory",
  riskLevel: 1,
  input: z.object({ query: z.string().min(2).max(300), limit: z.number().int().min(1).max(10).optional() }),
  output: { memories: "Array<{ kind, scope, content }>" },
  requiredPermissions: ["memory:read"],
  handler: async (i, ctx) => {
    const items = await searchMemory(ctx.workspaceId, ctx.userId, i.query, {
      limit: i.limit ?? 5, taskId: ctx.taskId, agentSlug: ctx.agentSlug, includeOtherAgents: ctx.memoryAccess === "shared",
    });
    return { memories: items.map((m) => ({ kind: m.kind, scope: m.scope, content: m.content })) };
  },
});

const webSearchTool = defineTool({
  name: "web_search",
  description: "Search the live web. Returns a sourced summary and the list of source URLs. Use for current or external information.",
  category: "web",
  riskLevel: 1,
  input: z.object({ query: z.string().min(2).max(400) }),
  output: { answer: "string", sources: "Array<{ title, url }>" },
  requiredPermissions: ["web:read"],
  timeoutMs: 90_000,
  handler: async (i, ctx) => webSearch(i.query, { workspaceId: ctx.workspaceId, userId: ctx.userId, taskId: ctx.taskId, agentSlug: ctx.agentSlug, purpose: "web_search" }),
});

const fetchUrl = defineTool({
  name: "fetch_url",
  description: "Fetch a public web page and return its readable text (max ~20k characters). Private/internal addresses are blocked.",
  category: "web",
  riskLevel: 1,
  input: z.object({ url: z.string().url().max(2000) }),
  output: { url: "string", title: "string", text: "string", truncated: "boolean" },
  requiredPermissions: ["web:read"],
  handler: async (i) => {
    const res = await safeFetch(i.url, { headers: { "user-agent": "NexusAI/1.0 (+research agent)", accept: "text/html,text/plain,application/json" } });
    if (res.status >= 400) throw new ToolUserError(`Fetch failed with HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    const { title, text } = ct.includes("html") ? htmlToText(res.body) : { title: "", text: res.body };
    return { url: res.finalUrl, title, text: text.slice(0, 20_000), truncated: res.truncated || text.length > 20_000 };
  },
});

const listFiles = defineTool({
  name: "list_files",
  description: "List documents uploaded to this workspace (id, name, type, size, status). Optionally filter by name.",
  category: "documents",
  riskLevel: 1,
  input: z.object({ name_contains: z.string().max(100).optional(), limit: z.number().int().min(1).max(50).optional() }),
  output: { files: "Array<{ id, filename, mime_type, size_bytes, status, created_at }>" },
  requiredPermissions: ["files:read"],
  handler: async (i, ctx) => ({
    files: await query(
      `SELECT id, filename, mime_type, size_bytes, status, chunk_count, created_at FROM knowledge_files
        WHERE workspace_id=$1 AND ($2::text IS NULL OR filename ILIKE '%' || $2 || '%') ORDER BY created_at DESC LIMIT $3`,
      [ctx.workspaceId, i.name_contains ?? null, i.limit ?? 25],
    ),
  }),
});

const readFile = defineTool({
  name: "read_file",
  description: "Read the extracted text of an uploaded document by id. Use offset to page through long documents (20k chars per call).",
  category: "documents",
  riskLevel: 1,
  input: z.object({ file_id: uuid, offset: z.number().int().min(0).optional() }),
  output: { filename: "string", text: "string", offset: "number", next_offset: "number|null", total_chars: "number" },
  requiredPermissions: ["files:read"],
  handler: async (i, ctx) => {
    const f = await queryOne<{ filename: string; extracted_text: string | null; status: string }>(
      "SELECT filename, extracted_text, status FROM knowledge_files WHERE id=$1 AND workspace_id=$2", [i.file_id, ctx.workspaceId],
    );
    if (!f) throw new ToolUserError("File not found in this workspace");
    if (f.status !== "ready" || !f.extracted_text) throw new ToolUserError(`File is not ready (status: ${f.status})`);
    const offset = i.offset ?? 0;
    const text = f.extracted_text.slice(offset, offset + 20_000);
    const next = offset + text.length < f.extracted_text.length ? offset + text.length : null;
    return { filename: f.filename, text, offset, next_offset: next, total_chars: f.extracted_text.length };
  },
});

async function loadTable(workspaceId: string, fileId: string, sheet?: string) {
  const f = await queryOne<{ filename: string; mime_type: string; content: Buffer; extracted_text: string | null }>(
    "SELECT filename, mime_type, content, extracted_text FROM knowledge_files WHERE id=$1 AND workspace_id=$2", [fileId, workspaceId],
  );
  if (!f) throw new ToolUserError("File not found in this workspace");
  let rows: string[][] = [];
  if (/\.csv$/i.test(f.filename) || f.mime_type.includes("csv")) {
    rows = parseCsv(f.content.toString("utf8"));
  } else if (/\.xlsx$/i.test(f.filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(f.content as unknown as ArrayBuffer);
    const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
    if (!ws) throw new ToolUserError(`Sheet not found. Available: ${wb.worksheets.map((w) => w.name).join(", ")}`);
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals = (r.values as unknown[]).slice(1).map((v) => cellText(v));
      rows.push(vals);
    });
  } else {
    throw new ToolUserError("analyze_spreadsheet supports .xlsx and .csv files only");
  }
  if (!rows.length) throw new ToolUserError("The sheet is empty");
  const headers = rows[0].map((h, idx) => h || `column_${idx + 1}`);
  return { filename: f.filename, headers, data: rows.slice(1) };
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return String(o.result ?? "");
    if ("text" in o) return String(o.text ?? "");
    if ("richText" in o) return (o.richText as Array<{ text: string }>).map((t) => t.text).join("");
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

const num = (s: string) => {
  const n = Number(String(s).replace(/[,\s%$€£]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  return s !== "" && Number.isFinite(n) ? n : null;
};

const analyzeSpreadsheet = defineTool({
  name: "analyze_spreadsheet",
  description: "Compute exact statistics for an uploaded .xlsx/.csv file: column profile (count, numeric sum/mean/min/max, top values) and optional group-by aggregation.",
  category: "data",
  riskLevel: 1,
  input: z.object({
    file_id: uuid,
    sheet: z.string().max(100).optional(),
    group_by: z.string().max(200).optional(),
    metric: z.string().max(200).optional(),
    aggregate: z.enum(["sum", "avg", "count", "min", "max"]).optional(),
    sample_rows: z.number().int().min(0).max(50).optional(),
  }),
  output: { filename: "string", rows: "number", columns: "Array<profile>", groups: "Array<{ key, value }>?", sample: "rows[]" },
  requiredPermissions: ["files:read"],
  handler: async (i, ctx) => {
    const t = await loadTable(ctx.workspaceId, i.file_id, i.sheet);
    const columns = t.headers.map((h, idx) => {
      const vals = t.data.map((r) => r[idx] ?? "").filter((v) => v !== "");
      const nums = vals.map(num).filter((n): n is number => n !== null);
      const numeric = nums.length >= Math.max(1, vals.length * 0.8);
      const freq = new Map<string, number>();
      vals.forEach((v) => freq.set(v, (freq.get(v) ?? 0) + 1));
      return {
        name: h, non_empty: vals.length, distinct: freq.size, numeric,
        ...(numeric && nums.length ? {
          sum: +nums.reduce((a, b) => a + b, 0).toFixed(4), mean: +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4),
          min: Math.min(...nums), max: Math.max(...nums),
        } : { top_values: [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value, count]) => ({ value, count })) }),
      };
    });
    let groups: Array<{ key: string; value: number; count: number }> | undefined;
    if (i.group_by) {
      const gi = t.headers.indexOf(i.group_by);
      if (gi < 0) throw new ToolUserError(`Unknown group_by column. Columns: ${t.headers.join(", ")}`);
      const mi = i.metric ? t.headers.indexOf(i.metric) : -1;
      if (i.metric && mi < 0) throw new ToolUserError(`Unknown metric column. Columns: ${t.headers.join(", ")}`);
      const agg = i.aggregate ?? (mi >= 0 ? "sum" : "count");
      const m = new Map<string, number[]>();
      for (const r of t.data) {
        const k = r[gi] ?? "";
        const v = mi >= 0 ? num(r[mi] ?? "") : 1;
        if (v === null) continue;
        m.set(k, [...(m.get(k) ?? []), v]);
      }
      groups = [...m.entries()].map(([key, vs]) => ({
        key, count: vs.length,
        value: +(agg === "sum" ? vs.reduce((a, b) => a + b, 0) : agg === "avg" ? vs.reduce((a, b) => a + b, 0) / vs.length
          : agg === "min" ? Math.min(...vs) : agg === "max" ? Math.max(...vs) : vs.length).toFixed(4),
      })).sort((a, b) => b.value - a.value).slice(0, 100);
    }
    return { filename: t.filename, rows: t.data.length, columns, groups, sample: t.data.slice(0, i.sample_rows ?? 5) };
  },
});

const listWorkItems = defineTool({
  name: "list_work_items",
  description: "List the workspace's operational work items (to-dos) with status, priority and due date.",
  category: "operations",
  riskLevel: 1,
  input: z.object({ status: z.enum(["todo", "in_progress", "done", "blocked"]).optional(), limit: z.number().int().min(1).max(100).optional() }),
  output: { items: "Array<work item>" },
  requiredPermissions: ["work:read"],
  handler: async (i, ctx) => ({
    items: await query(
      `SELECT id, title, description, status, priority, due_date, assignee FROM work_items
        WHERE workspace_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC LIMIT $3`,
      [ctx.workspaceId, i.status ?? null, i.limit ?? 50],
    ),
  }),
});

// ─────────────── Level 2: Prepare ───────────────

const createDocument = defineTool({
  name: "create_document",
  description: "Create a downloadable document deliverable from Markdown (headings, lists, tables). format 'docx' produces a Word file; 'markdown' keeps it as Markdown.",
  category: "documents",
  riskLevel: 2,
  input: z.object({
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(200_000),
    format: z.enum(["docx", "markdown"]).optional(),
    kind: z.enum(["document", "report", "presentation_outline", "email_draft"]).optional(),
  }),
  output: { artifact_id: "uuid", title: "string", format: "string", download_url: "string" },
  requiredPermissions: ["artifacts:write"],
  handler: async (i, ctx) => {
    const format = i.format ?? "docx";
    const art = await saveArtifact({
      workspaceId: ctx.workspaceId, taskId: ctx.taskId, stepId: ctx.stepId, conversationId: ctx.conversationId, agentSlug: ctx.agentSlug,
      kind: i.kind ?? "document", title: i.title, format, text: i.content,
      bytes: format === "docx" ? await markdownToDocx(i.title, i.content) : undefined,
    });
    return { artifact_id: art.id, title: art.title, format: art.format, download_url: `/api/artifacts/${art.id}` };
  },
});

const createSpreadsheet = defineTool({
  name: "create_spreadsheet",
  description: "Create a downloadable Excel (.xlsx) deliverable, e.g. compliance matrices, lead lists, CRM imports, data tables.",
  category: "data",
  riskLevel: 2,
  input: z.object({
    title: z.string().min(1).max(200),
    sheets: z.array(z.object({
      name: z.string().min(1).max(31),
      columns: z.array(z.string().max(200)).min(1).max(50),
      rows: z.array(z.array(z.union([z.string().max(5000), z.number(), z.null()]))).max(5000),
    })).min(1).max(10),
  }),
  output: { artifact_id: "uuid", title: "string", download_url: "string" },
  requiredPermissions: ["artifacts:write"],
  handler: async (i, ctx) => {
    const bytes = await rowsToXlsx(i.title, i.sheets);
    const preview = i.sheets.map((s) => `## ${s.name}\n| ${s.columns.join(" | ")} |\n|${s.columns.map(() => "---").join("|")}|\n${s.rows.slice(0, 20).map((r) => `| ${r.map((c) => String(c ?? "")).join(" | ")} |`).join("\n")}`).join("\n\n");
    const art = await saveArtifact({
      workspaceId: ctx.workspaceId, taskId: ctx.taskId, stepId: ctx.stepId, conversationId: ctx.conversationId, agentSlug: ctx.agentSlug,
      kind: "spreadsheet", title: i.title, format: "xlsx", text: preview, bytes,
    });
    return { artifact_id: art.id, title: art.title, download_url: `/api/artifacts/${art.id}` };
  },
});

const draftEmail = defineTool({
  name: "draft_email",
  description: "Prepare an email draft as a deliverable. Drafts are NEVER sent; sending requires send_email and user approval.",
  category: "communication",
  riskLevel: 2,
  input: z.object({
    to: z.array(z.string().email()).max(20).optional(),
    cc: z.array(z.string().email()).max(20).optional(),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(50_000),
  }),
  output: { artifact_id: "uuid", download_url: "string" },
  requiredPermissions: ["artifacts:write"],
  handler: async (i, ctx) => {
    const text = `To: ${(i.to ?? []).join(", ")}\n${i.cc?.length ? `Cc: ${i.cc.join(", ")}\n` : ""}Subject: ${i.subject}\n\n${i.body}`;
    const art = await saveArtifact({
      workspaceId: ctx.workspaceId, taskId: ctx.taskId, stepId: ctx.stepId, conversationId: ctx.conversationId, agentSlug: ctx.agentSlug,
      kind: "email_draft", title: `Email draft: ${i.subject}`, format: "text", text,
    });
    return { artifact_id: art.id, download_url: `/api/artifacts/${art.id}`, sent: false };
  },
});

const createWorkItem = defineTool({
  name: "create_work_item",
  description: "Create an internal work item (to-do) in the workspace's operations board.",
  category: "operations",
  riskLevel: 2,
  input: z.object({
    title: z.string().min(1).max(300),
    description: z.string().max(5000).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    assignee: z.string().max(200).optional(),
  }),
  output: { id: "uuid", title: "string" },
  requiredPermissions: ["work:write"],
  handler: async (i, ctx) => queryOne(
    `INSERT INTO work_items(workspace_id, task_id, title, description, priority, due_date, assignee, created_by_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, title, status, priority, due_date`,
    [ctx.workspaceId, ctx.taskId, i.title, i.description ?? null, i.priority ?? "medium", i.due_date ?? null, i.assignee ?? null, ctx.agentSlug],
  ),
});

const proposeMemory = defineTool({
  name: "propose_memory",
  description: "Propose a durable fact, preference or decision to remember for future work. Proposals require user approval before they are used (unless the workspace auto-approves). Never include secrets.",
  category: "memory",
  riskLevel: 2,
  input: z.object({
    content: z.string().min(5).max(1000),
    kind: z.enum(["preference", "fact", "decision", "context", "workflow"]),
    scope: z.enum(["user", "workspace", "agent"]).describe("agent = your own private memory"),
  }),
  output: { id: "uuid", status: "proposed|active" },
  requiredPermissions: ["memory:write"],
  handler: async (i, ctx) => {
    const settings = await getWorkspaceSettings(ctx.workspaceId);
    const m = await addMemory({
      workspaceId: ctx.workspaceId, scope: i.scope, kind: i.kind, content: i.content, source: "agent",
      status: settings.autoApproveAgentMemories || i.scope === "agent" ? "active" : "proposed", userId: ctx.userId, importance: 0.5, agentSlug: ctx.agentSlug,
    });
    return { id: m.id, status: m.status };
  },
});

// ─────────────── Level 3: Modify ───────────────

const updateWorkItem = defineTool({
  name: "update_work_item",
  description: "Modify an existing work item (status, priority, due date, assignee, title). Requires approval per workspace policy.",
  category: "operations",
  riskLevel: 3,
  input: z.object({
    id: uuid,
    status: z.enum(["todo", "in_progress", "done", "blocked"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    assignee: z.string().max(200).optional(),
    title: z.string().max(300).optional(),
  }),
  output: { id: "uuid", updated: "boolean" },
  requiredPermissions: ["work:write"],
  preview: (i) => ({
    summary: `Update work item ${i.id}: ${Object.entries(i).filter(([k, v]) => k !== "id" && v !== undefined).map(([k, v]) => `${k} → ${v}`).join(", ") || "no changes"}`,
    destination: `work_item:${i.id}`,
  }),
  handler: async (i, ctx) => {
    const row = await queryOne(
      `UPDATE work_items SET status=COALESCE($3,status), priority=COALESCE($4,priority), due_date=COALESCE($5::date,due_date),
              assignee=COALESCE($6,assignee), title=COALESCE($7,title), updated_at=now()
        WHERE id=$1 AND workspace_id=$2 RETURNING id, title, status, priority, due_date, assignee`,
      [i.id, ctx.workspaceId, i.status ?? null, i.priority ?? null, i.due_date ?? null, i.assignee ?? null, i.title ?? null],
    );
    if (!row) throw new ToolUserError("Work item not found in this workspace");
    return { updated: true, item: row };
  },
});

// ─────────────── Level 4: External execution ───────────────

const httpPostWebhook = defineTool({
  name: "http_post_webhook",
  description: "POST a JSON payload to an external HTTPS webhook URL (e.g. Zapier, Make, Slack incoming webhook, CRM). External action: ALWAYS requires explicit user approval of the exact URL and payload.",
  category: "integration",
  riskLevel: 4,
  input: z.object({
    url: z.string().url().max(2000).refine((u) => u.startsWith("https://"), "Webhook URL must use https"),
    payload: z.record(z.string(), z.unknown()),
  }),
  output: { status: "number", response: "string" },
  requiredPermissions: ["external:execute"],
  preview: (i) => ({ summary: `POST JSON payload (${JSON.stringify(i.payload).length} bytes) to ${i.url}`, destination: i.url }),
  handler: async (i, ctx) => {
    const res = await safeFetch(i.url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "NexusAI/1.0", ...(ctx.idempotencyKey ? { "idempotency-key": ctx.idempotencyKey } : {}) },
      body: JSON.stringify(i.payload),
    }, { maxBytes: 100_000, maxRedirects: 0 });
    if (res.status >= 400) throw new Error(`Webhook responded with HTTP ${res.status}`);
    return { status: res.status, response: res.body.slice(0, 2000) };
  },
});

export const BUILTIN_TOOLS: ToolDefinition[] = [
  knowledgeSearch, memorySearch, webSearchTool, fetchUrl, listFiles, readFile, analyzeSpreadsheet, listWorkItems,
  createDocument, createSpreadsheet, draftEmail, createWorkItem, proposeMemory,
  updateWorkItem,
  httpPostWebhook,
] as ToolDefinition[];
