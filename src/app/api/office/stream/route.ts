import { workspaceRoute } from "@/lib/api";
import { eventsAfter, getPresence, messagesByIds } from "@/lib/office/events";
import type { OfficeStreamEvent } from "@/lib/office/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STREAM_MS = 50_000;
const POLL_MS = 1_000;

/**
 * Server-Sent Events stream of real office activity. Serverless-friendly: each connection lives
 * ~50 s and the browser's EventSource reconnects with Last-Event-ID, so no events are lost.
 */
export const GET = workspaceRoute(async ({ req, workspaceId }) => {
  const url = new URL(req.url);
  let cursor = req.headers.get("last-event-id") ?? url.searchParams.get("after");
  if (cursor && !/^\d+$/.test(cursor)) cursor = null;
  const encoder = new TextEncoder();
  const signal = req.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: OfficeStreamEvent, id?: string) => {
        controller.enqueue(encoder.encode(`${id ? `id: ${id}\n` : ""}data: ${JSON.stringify(data)}\n\n`));
      };
      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      const started = Date.now();
      let lastBeat = Date.now();
      try {
        if (!cursor) {
          // Fresh connection without a cursor: start from "now" (the client loads history via /api/office/state).
          const latest = await eventsAfter(workspaceId, null, 1);
          cursor = latest.at(-1)?.id ?? "0";
        }
        send({ kind: "presence", presence: await getPresence(workspaceId) }, cursor);
        while (!signal.aborted && Date.now() - started < STREAM_MS) {
          const events = await eventsAfter(workspaceId, cursor, 200);
          if (events.length) {
            cursor = events.at(-1)!.id;
            const ids = events.map((e) => e.payload?.messageId).filter((x): x is string => typeof x === "string");
            if (ids.length) send({ kind: "messages", messages: await messagesByIds(workspaceId, [...new Set(ids)]) });
            send({ kind: "events", events }, cursor);
            send({ kind: "presence", presence: await getPresence(workspaceId) }, cursor);
          } else if (Date.now() - lastBeat > 15_000) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            lastBeat = Date.now();
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
      } catch (e) {
        if (!signal.aborted) console.error("[office stream]", (e as Error).message);
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}, { rate: { limit: 120, windowSec: 60, bucket: "office-stream" } });
