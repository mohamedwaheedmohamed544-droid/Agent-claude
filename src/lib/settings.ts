import { z } from "zod";
import { queryOne, type Queryable } from "./db";

export const WorkspaceSettingsSchema = z.object({
  /** Halts all agent execution and tool calls in the workspace. */
  emergencyStop: z.boolean().default(false),
  /** Level 3 (modify) actions run without approval when true. Level 4 ALWAYS requires approval. */
  autoApproveLevel3: z.boolean().default(false),
  /** Tools disabled for this workspace. */
  disabledTools: z.array(z.string()).default([]),
  /** Max steps executed concurrently within one task. */
  maxParallelSteps: z.number().int().min(1).max(6).default(3),
  /** Optional per-workspace model overrides (must be models the API account can access). */
  models: z
    .object({
      primary: z.string().max(100).optional(),
      fallback: z.string().max(100).optional(),
      fast: z.string().max(100).optional(),
      advanced: z.string().max(100).optional(),
    })
    .default({}),
  /** Soft daily spend cap in USD (estimated). 0 = unlimited. */
  dailyCostLimitUsd: z.number().min(0).default(0),
  /** Agent-proposed memories need user approval unless this is true. */
  autoApproveAgentMemories: z.boolean().default(false),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export function parseSettings(raw: unknown): WorkspaceSettings {
  const r = WorkspaceSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : WorkspaceSettingsSchema.parse({});
}

export async function getWorkspaceSettings(workspaceId: string, client?: Queryable): Promise<WorkspaceSettings> {
  const row = await queryOne<{ settings: unknown }>("SELECT settings FROM workspaces WHERE id=$1", [workspaceId], client);
  return parseSettings(row?.settings);
}
