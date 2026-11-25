/**
 * Exercises the real Anthropic SDK code path (not the mock LLM) against a local fake of the
 * Messages API that streams genuine SSE events. Verifies request shape and response handling.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { chat, chatJson, webSearch, embed } from "@/lib/ai/llm";
import { query } from "@/lib/db";
import { makeUser } from "./helpers";

type Captured = { headers: http.IncomingHttpHeaders; body: Record<string, unknown> };
const captured: Captured[] = [];
let nextResponses: Array<{ blocks: Array<Record<string, unknown>>; stop: string; usage?: Record<string, unknown> }> = [];
let server: http.Server;
const saved: Record<string, string | undefined> = {};

function sse(res: http.ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...(data as object) })}\n\n`);
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      captured.push({ headers: req.headers, body });
      const next = nextResponses.shift() ?? { blocks: [{ type: "text", text: "ok" }], stop: "end_turn" };
      res.writeHead(200, { "content-type": "text/event-stream" });
      sse(res, "message_start", { message: { id: "msg_test", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 50, cache_creation_input_tokens: 0, ...(next.usage ?? {}) } } });
      next.blocks.forEach((b, index) => {
        if (b.type === "text") {
          sse(res, "content_block_start", { index, content_block: { type: "text", text: "", ...(b.citations ? { citations: [] } : {}) } });
          sse(res, "content_block_delta", { index, delta: { type: "text_delta", text: b.text } });
          for (const c of (b.citations as unknown[]) ?? []) sse(res, "content_block_delta", { index, delta: { type: "citations_delta", citation: c } });
        } else if (b.type === "tool_use") {
          sse(res, "content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
          sse(res, "content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
        } else if (b.type === "thinking") {
          sse(res, "content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
          sse(res, "content_block_delta", { index, delta: { type: "signature_delta", signature: b.signature } });
        } else {
          sse(res, "content_block_start", { index, content_block: b });
        }
        sse(res, "content_block_stop", { index });
      });
      sse(res, "message_delta", { delta: { stop_reason: next.stop, stop_sequence: null }, usage: { output_tokens: 40 } });
      sse(res, "message_stop", {});
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  for (const k of ["NEXUS_LLM_PROVIDER", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL", "VOYAGE_API_KEY"]) saved[k] = process.env[k];
  process.env.NEXUS_LLM_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.VOYAGE_API_KEY;
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  await new Promise<void>((r) => server.close(() => r()));
});

describe("Claude provider (real SDK path, local fake API)", () => {
  it("sends a well-formed request and parses tool calls while preserving thinking blocks", async () => {
    const u = await makeUser();
    nextResponses = [{
      stop: "tool_use",
      blocks: [
        { type: "thinking", signature: "sig-abc" },
        { type: "text", text: "Let me search." },
        { type: "tool_use", id: "toolu_1", name: "knowledge_search", input: { query: "tender" } },
      ],
    }];
    const r = await chat({
      system: "SYSTEM PROMPT", tier: "advanced",
      messages: [{ role: "user", content: "Find the tender" }],
      tools: [{ name: "knowledge_search", description: "Search", input_schema: { type: "object", properties: { query: { type: "string" } } } }],
      ctx: { workspaceId: u.workspaceId, userId: u.userId, purpose: "test" },
    });
    const req = captured.at(-1)!;
    expect(req.body.model).toBe("claude-opus-5-5");
    expect(req.body.stream).toBe(true);
    expect(req.body.fallbacks).toBe("default");
    expect(String(req.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect(req.body.output_config).toEqual({ effort: "high" });
    expect(req.body.thinking).toBeUndefined(); // adaptive thinking is the default; never disabled
    expect(req.body.tool_choice).toBeUndefined(); // forced tool choice is not allowed on current models
    expect(req.body.system).toEqual([{ type: "text", text: "SYSTEM PROMPT", cache_control: { type: "ephemeral" } }]);
    expect(r.toolCalls).toEqual([{ id: "toolu_1", name: "knowledge_search", input: { query: "tender" } }]);
    expect(r.assistantContent[0]).toMatchObject({ type: "thinking", signature: "sig-abc" });
    expect(r.content).toBe("Let me search.");
    const usage = await query<{ model: string; prompt_tokens: number; cost_usd: string }>("SELECT model, prompt_tokens, cost_usd FROM usage_records WHERE workspace_id=$1", [u.workspaceId]);
    expect(usage[0].model).toBe("claude-opus-5-5");
    expect(usage[0].prompt_tokens).toBe(150);
    expect(Number(usage[0].cost_usd)).toBeGreaterThan(0);
  });

  it("uses structured outputs for JSON and maps tiers to effort", async () => {
    const u = await makeUser();
    nextResponses = [{ stop: "end_turn", blocks: [{ type: "text", text: '{"proceed":true,"reason":"ok"}' }] }];
    const { data } = await chatJson<{ proceed: boolean }>({
      system: "s", tier: "fast", messages: [{ role: "user", content: "x" }],
      jsonSchema: { name: "step_condition", schema: { type: "object", additionalProperties: false, required: ["proceed"], properties: { proceed: { type: "boolean" } } } },
      ctx: { workspaceId: u.workspaceId, purpose: "test" },
    });
    expect(data.proceed).toBe(true);
    const cfg = captured.at(-1)!.body.output_config as { effort: string; format: { type: string } };
    expect(cfg.effort).toBe("low");
    expect(cfg.format.type).toBe("json_schema");
  });

  it("surfaces refusals as a clear error", async () => {
    const u = await makeUser();
    nextResponses = [{ stop: "refusal", blocks: [] }];
    await expect(chat({ system: "s", messages: [{ role: "user", content: "x" }], ctx: { workspaceId: u.workspaceId, purpose: "test" } })).rejects.toThrow(/declined/);
  });

  it("web search uses Claude's server tool and collects cited sources", async () => {
    const u = await makeUser();
    nextResponses = [{
      stop: "end_turn",
      usage: { server_tool_use: { web_search_requests: 1 } },
      blocks: [
        { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "GCC events" } },
        { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://example.org/report", title: "Events Report", encrypted_content: "x", page_age: null }] },
        { type: "text", text: "The market is growing.", citations: [{ type: "web_search_result_location", url: "https://example.org/report", title: "Events Report", cited_text: "growing", encrypted_index: "e" }] },
      ],
    }];
    const r = await webSearch("GCC events market", { workspaceId: u.workspaceId, purpose: "web_search" });
    expect(r.answer).toContain("growing");
    expect(r.sources).toEqual([{ title: "Events Report", url: "https://example.org/report" }]);
    const tools = captured.at(-1)!.body.tools as Array<{ type: string }>;
    expect(tools[0].type).toBe("web_search_20260209");
  });

  it("without a Voyage key, embeddings are reported unavailable (keyword search is used)", async () => {
    const u = await makeUser();
    await expect(embed(["hello"], { workspaceId: u.workspaceId, purpose: "test" })).rejects.toThrow(/VOYAGE_API_KEY/);
  });
});
