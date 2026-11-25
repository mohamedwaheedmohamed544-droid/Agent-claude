import type { ToolDefinition } from "./types";

/**
 * Tools backed by OAuth integrations (Gmail, Outlook, Google Calendar, Google Drive …).
 * Populated by src/lib/integrations/*. Each tool declares `integration` so the executor can
 * refuse cleanly when the provider is not connected.
 */
export const INTEGRATION_TOOLS: ToolDefinition[] = [];
