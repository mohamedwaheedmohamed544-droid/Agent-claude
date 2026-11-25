import OpenAI from "openai";
import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { query, queryOne } from "../db";
import { AppError, unavailable } from "../errors";
import { getWorkspaceSettings } from "../settings";
import { redactSecrets } from "../security/crypto";
import { estimateCostUsd, modelForTier, resolveModels, type ModelTier } from "./models";
import { mockChat, mockEmbed, mockWebSearch } from "./mock";

export type ChatMessage = ChatCompletionMessageParam;
export type ToolSpec = ChatCompletionFunctionTool;

export interface CallContext {
  workspaceId: string;
  userId?: string | null;
  taskId?: string | null;
  agentSlug?: string | null;
  purpose: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Forces a JSON object matching this schema (OpenAI structured outputs, strict mode). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  tier?: ModelTier;
  modelOverride?: string | null;
  maxTokens?: number;
  ctx: CallContext;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  model: string;
  usage: { promptTokens: number; completionTokens: number; costUsd: number };
  usedFallback: boolean;
}

export function isMockMode(): boolean {
  if (process.env.NEXUS_LLM_PROVIDER !== "mock") return false;
  if (process.env.NODE_ENV === "production" && process.env.NEXUS_ALLOW_MOCK !== "1") {
    throw new Error("Mock LLM provider is not allowed in production");
  }
  return true;
}

export function isAiConfigured(): boolean {
  return isMockMode() || Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
}

let client: OpenAI | null = null;
export function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw unavailable("OPENAI_API_KEY is not configured");
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 120_000, maxRetries: 2 });
  return client;
}

async function recordUsage(
  ctx: CallContext, model: string, promptTokens: number, completionTokens: number,
  latencyMs: number, success: boolean, error?: string,
): Promise<number> {
  const cost = estimateCostUsd(model, promptTokens, completionTokens);
  await query(
    `INSERT INTO usage_records(workspace_id, user_id, task_id, agent_slug, model, purpose, prompt_tokens, completion_tokens, cost_usd, latency_ms, success, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [ctx.workspaceId, ctx.userId ?? null, ctx.taskId ?? null, ctx.agentSlug ?? null, model, ctx.purpose,
      promptTokens, completionTokens, cost, latencyMs, success, error ? redactSecrets(error).slice(0, 500) : null],
  ).catch((e) => console.error("[usage] record failed", e.message));
  return cost;
}

async function enforceBudget(workspaceId: string, limitUsd: number) {
  if (!limitUsd) return;
  const row = await queryOne<{ spent: string }>(
    "SELECT COALESCE(SUM(cost_usd),0) AS spent FROM usage_records WHERE workspace_id=$1 AND created_at > now() - interval '1 day'",
    [workspaceId],
  );
  if (Number(row?.spent ?? 0) >= limitUsd) {
    throw new AppError(402, "budget_exceeded", `Daily AI spend limit of $${limitUsd} reached for this workspace`);
  }
}

/** Errors where retrying with a different model may help. */
function isFallbackable(e: unknown): boolean {
  if (e instanceof OpenAI.APIError) {
    return e.status === 404 || e.status === 429 || (e.status !== undefined && e.status >= 500) ||
      /model/i.test(e.message ?? "");
  }
  return e instanceof OpenAI.APIConnectionError || e instanceof OpenAI.APIConnectionTimeoutError;
}

export async function chat(req: ChatRequest): Promise<ChatResult> {
  const settings = await getWorkspaceSettings(req.ctx.workspaceId);
  if (settings.emergencyStop) throw new AppError(423, "emergency_stop", "Emergency stop is active for this workspace");
  await enforceBudget(req.ctx.workspaceId, settings.dailyCostLimitUsd);

  if (isMockMode()) {
    const started = Date.now();
    const r = mockChat(req);
    const cost = await recordUsage(req.ctx, "mock", r.promptTokens, r.completionTokens, Date.now() - started, true);
    return { content: r.content, toolCalls: r.toolCalls, model: "mock", usage: { promptTokens: r.promptTokens, completionTokens: r.completionTokens, costUsd: cost }, usedFallback: false };
  }

  const models = resolveModels(settings);
  const primary = req.modelOverride || modelForTier(models, req.tier ?? "standard");
  if (!primary) throw unavailable("No AI model configured. Set OPENAI_MODEL.");
  const candidates = [primary, models.fallback].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const started = Date.now();
    try {
      const res = await openai().chat.completions.create({
        model,
        messages: req.messages,
        ...(req.tools?.length ? { tools: req.tools, parallel_tool_calls: true } : {}),
        ...(req.jsonSchema
          ? { response_format: { type: "json_schema", json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: true } } }
          : {}),
        ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}),
      });
      const choice = res.choices[0];
      const pt = res.usage?.prompt_tokens ?? 0;
      const ct = res.usage?.completion_tokens ?? 0;
      const cost = await recordUsage(req.ctx, res.model ?? model, pt, ct, Date.now() - started, true);
      if (choice?.message?.refusal) {
        throw new AppError(422, "model_refusal", `The model declined: ${choice.message.refusal}`);
      }
      return {
        content: choice?.message?.content ?? null,
        toolCalls: (choice?.message?.tool_calls ?? [])
          .filter((t) => t.type === "function")
          .map((t) => ({ id: t.id, name: (t as { function: { name: string } }).function.name, arguments: (t as { function: { arguments: string } }).function.arguments })),
        model: res.model ?? model,
        usage: { promptTokens: pt, completionTokens: ct, costUsd: cost },
        usedFallback: i > 0,
      };
    } catch (e) {
      lastErr = e;
      await recordUsage(req.ctx, model, 0, 0, Date.now() - started, false, e instanceof Error ? e.message : String(e));
      if (e instanceof AppError || !isFallbackable(e) || i === candidates.length - 1) break;
      console.warn(`[llm] model ${model} failed, trying fallback`);
    }
  }
  if (lastErr instanceof AppError) throw lastErr;
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new AppError(502, "ai_provider_error", `AI provider error: ${redactSecrets(msg).slice(0, 300)}`);
}

/** Parses a structured-output JSON response. */
export async function chatJson<T>(req: ChatRequest & { jsonSchema: NonNullable<ChatRequest["jsonSchema"]> }): Promise<{ data: T; result: ChatResult }> {
  const result = await chat(req);
  try {
    return { data: JSON.parse(result.content ?? "") as T, result };
  } catch {
    throw new AppError(502, "invalid_model_output", "The model returned malformed structured output");
  }
}

export const EMBEDDING_DIMENSIONS = 1536;

export async function embed(texts: string[], ctx: CallContext): Promise<{ vectors: number[][]; model: string }> {
  if (!texts.length) return { vectors: [], model: "none" };
  if (isMockMode()) return { vectors: texts.map(mockEmbed), model: "mock-embedding" };
  const model = resolveModels().embedding;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 96) {
    const batch = texts.slice(i, i + 96).map((t) => t.slice(0, 24_000));
    const started = Date.now();
    try {
      const res = await openai().embeddings.create({ model, input: batch, dimensions: EMBEDDING_DIMENSIONS });
      await recordUsage(ctx, model, res.usage?.prompt_tokens ?? 0, 0, Date.now() - started, true);
      out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    } catch (e) {
      await recordUsage(ctx, model, 0, 0, Date.now() - started, false, e instanceof Error ? e.message : String(e));
      throw new AppError(502, "embedding_error", `Embedding failed: ${redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
  }
  return { vectors: out, model };
}

export interface WebSearchResult {
  answer: string;
  sources: Array<{ title: string; url: string }>;
}

/** Live web search through the OpenAI Responses API's built-in web_search tool. */
export async function webSearch(q: string, ctx: CallContext): Promise<WebSearchResult> {
  if (isMockMode()) return mockWebSearch(q);
  const settings = await getWorkspaceSettings(ctx.workspaceId);
  await enforceBudget(ctx.workspaceId, settings.dailyCostLimitUsd);
  const models = resolveModels(settings);
  const model = process.env.OPENAI_SEARCH_MODEL || models.primary;
  if (!model) throw unavailable("No AI model configured");
  const started = Date.now();
  try {
    const res = await openai().responses.create({
      model,
      tools: [{ type: "web_search" }],
      input: `Search the web and answer factually with sources. Query: ${q}`,
    });
    const sources: WebSearchResult["sources"] = [];
    for (const item of res.output ?? []) {
      if (item.type !== "message") continue;
      for (const part of item.content ?? []) {
        if (part.type !== "output_text") continue;
        for (const a of part.annotations ?? []) {
          if (a.type === "url_citation" && !sources.some((s) => s.url === a.url)) sources.push({ title: a.title, url: a.url });
        }
      }
    }
    await recordUsage(ctx, model, res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0, Date.now() - started, true);
    return { answer: res.output_text ?? "", sources };
  } catch (e) {
    await recordUsage(ctx, model, 0, 0, Date.now() - started, false, e instanceof Error ? e.message : String(e));
    throw new AppError(502, "web_search_error", `Web search failed: ${redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
}

/** Checks that configured models are actually available to this API key. Cached for 10 minutes. */
const accessCache = new Map<string, { at: number; value: ModelAccessReport }>();
export interface ModelAccessReport {
  checked: boolean;
  error?: string;
  models: Array<{ role: string; model: string | null; available: boolean | null }>;
}
export async function verifyModelAccess(force = false, models?: ReturnType<typeof resolveModels>): Promise<ModelAccessReport> {
  const m = models ?? resolveModels();
  const cacheKey = [m.primary, m.fallback, m.fast, m.advanced, m.embedding].join("|");
  const cached = accessCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < 600_000) return cached.value;
  const roles: Array<[string, string | null]> = [["primary", m.primary], ["fallback", m.fallback], ["fast", m.fast], ["advanced", m.advanced], ["embedding", m.embedding]];
  let report: ModelAccessReport;
  if (isMockMode()) {
    report = { checked: true, models: roles.map(([role, model]) => ({ role, model: model ?? "mock", available: true })) };
  } else if (!process.env.OPENAI_API_KEY) {
    report = { checked: false, error: "OPENAI_API_KEY is not configured", models: roles.map(([role, model]) => ({ role, model, available: null })) };
  } else {
    try {
      const ids = new Set<string>();
      for await (const model of openai().models.list()) ids.add(model.id);
      report = { checked: true, models: roles.map(([role, model]) => ({ role, model, available: model ? ids.has(model) : null })) };
    } catch (e) {
      report = { checked: false, error: redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200), models: roles.map(([role, model]) => ({ role, model, available: null })) };
    }
  }
  accessCache.set(cacheKey, { at: Date.now(), value: report });
  return report;
}
