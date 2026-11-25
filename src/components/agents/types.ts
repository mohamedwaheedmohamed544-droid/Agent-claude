/** Client-side shapes of the agents/tools APIs (see src/app/api/agents/** and src/app/api/tools). */

export type Tier = "fast" | "standard" | "advanced";

export interface AgentListItem {
  slug: string; name: string; nameAr: string | null; description: string; descriptionAr: string | null;
  icon: string; color: string; capabilities: string[]; active: boolean; customized: boolean; version: number; tier: Tier; tools: string[];
  stats: { runs: number; completed: number; failed: number; avgMs: number | null; lastRun: string | null };
}

export interface AgentConfig {
  id: string; slug: string; name: string; nameAr: string | null; description: string; descriptionAr: string | null;
  icon: string; color: string; capabilities: string[]; isSystem: boolean; active: boolean; workspaceScoped: boolean;
  version: number; systemPrompt: string; allowedTools: string[]; tier: Tier; modelOverride: string | null; builtInPrompt: string | null;
}

export interface AgentVersion { id: string; version: number; system_prompt: string; allowed_tools: string[]; model_tier: Tier; created_at: string }

export interface AgentStep { id: string; title: string; status: string; taskId: string; taskTitle: string; startedAt: string | null; completedAt: string | null }

export interface AgentDetailResponse {
  agent: AgentConfig;
  versions: AgentVersion[];
  recentSteps: AgentStep[];
  toolUsage: Array<{ tool: string; calls: number; succeeded: number }>;
  availableTools: Array<{ name: string; description: string; riskLevel: number; category: string; integration: string | null }>;
}

export interface ToolInfo {
  name: string; description: string; category: string; riskLevel: number; requiredPermissions: string[];
  integration: string | null; integrationConnected: boolean | null; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>;
  enabled: boolean; requiresApproval: boolean; agents: string[]; calls: number; failed: number;
}

export const TOOL_CATEGORIES = ["knowledge", "memory", "web", "documents", "data", "operations", "communication", "integration"] as const;

/** Localised agent name/description, preferring the Arabic fields when the UI is in Arabic. */
export function localizedAgent(a: { name: string; nameAr: string | null; description: string; descriptionAr: string | null }, locale: string) {
  return {
    name: locale === "ar" && a.nameAr ? a.nameAr : a.name,
    description: locale === "ar" && a.descriptionAr ? a.descriptionAr : a.description,
  };
}
