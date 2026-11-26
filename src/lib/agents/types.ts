/**
 * Client-safe contract for database-driven agents (Agent Management, Runtime Factory, Office).
 * Agents are data: nothing in the app enumerates them in code.
 */
import type { CharacterAppearance } from "../office/types";

export type ModelTier = "fast" | "standard" | "advanced";
/** Configuration lifecycle stored in the database. Runtime activity (working, meeting…) is in presence. */
export type AgentLifecycle = "draft" | "active" | "inactive" | "archived";

export interface AgentResponsibilities {
  main: string;
  instructions: string;
  expertise: string[];
  deliverables: string[];
  methodology: string;
  successCriteria: string[];
}

export interface AgentAIConfig {
  provider: "anthropic";
  /** Specific Claude model; null = workspace/tier default. */
  model: string | null;
  tier: ModelTier;
  /** Not supported by current Claude models (ignored at runtime); kept for future providers. */
  temperature: number | null;
  /** Extra system instructions appended to the generated prompt. */
  systemInstructions: string;
  memory: {
    useWorkspaceMemory: boolean;
    useAgentMemory: boolean;
    useKnowledgeBase: boolean;
    maxContextTokens: number;
  };
}

export interface AgentPermissions {
  /** Highest tool risk level this agent may use at all: 1 read, 2 prepare, 3 modify, 4 external. */
  maxRiskLevel: 1 | 2 | 3 | 4;
  /** Require approval for level-3 actions even if the workspace auto-approves them. */
  alwaysApproveModify: boolean;
  /** Tool categories this agent may never use (e.g. "communication", "integration", "web"). */
  restrictedCategories: string[];
  /** "own" = only its private memory + workspace memory; "shared" = may also read other agents' private memory. */
  memoryAccess: "own" | "shared";
}

export interface AgentRelationships {
  supervisor: string | null;          // agent slug
  delegatesTo: string[];              // agents it may hand work to
  collaboratesWith: string[];
  canJoinMeetings: boolean;
  canInitiateCollaboration: boolean;
}

export type AvatarAnimation = "idle" | "working" | "reading" | "thinking";

export interface AgentOfficeConfig {
  departmentKey: string;
  workstationId: string | null;       // allocated by the server
  avatarPreset: string;               // key in AVATAR_PRESETS (or "custom")
  appearance: CharacterAppearance;
  defaultAnimation: AvatarAnimation;
  preferredMeetingRoom: string | null;
  visible: boolean;
}

export interface AgentSkillAssignment {
  key: string;
  mandatory: boolean;
}

/** What the builder submits (create/update/duplicate/import/template). */
export interface AgentDefinitionInput {
  nameAr: string;
  nameEn: string;
  roleTitle: string;
  roleTitleAr: string;
  description: string;
  descriptionAr: string;
  personality: string;
  color: string;
  capabilities: string[];
  responsibilities: AgentResponsibilities;
  ai: AgentAIConfig;
  tools: string[];
  permissions: AgentPermissions;
  relationships: AgentRelationships;
  office: AgentOfficeConfig;
  skills: AgentSkillAssignment[];
}

export interface AgentRecord extends AgentDefinitionInput {
  id: string;
  slug: string;                       // immutable technical identifier, never reused
  isOrchestrator: boolean;
  lifecycle: AgentLifecycle;
  version: number;
  templateKey: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface AgentVersionRecord {
  version: number;
  createdAt: string;
  createdByName: string | null;
  changeNote: string | null;
}

export interface SkillRecord {
  key: string;
  name: string;
  nameAr: string;
  description: string;
  category: string;
  instructions: string;
  requiredTools: string[];
  dependsOn: string[];                // other skill keys
  builtin: boolean;
  agentCount?: number;
}

export interface TemplateRecord {
  key: string;
  name: string;
  nameAr: string;
  description: string;
  category: string;
  builtin: boolean;
  config: AgentDefinitionInput;
}

export interface DepartmentRecord {
  id: string;
  key: string;
  name: string;
  nameAr: string;
  color: string;
  kind: "executive" | "department";
  managerSlug: string | null;
  meetingRoomKey: string | null;
  sort: number;
  agentCount: number;
}

/** Validation result for a proposed configuration (shown in the builder). */
export interface AgentValidation {
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
  /** Tools required by assigned skills that the agent is not allowed to use. */
  missingTools: string[];
  /** Skills required by assigned skills that are not assigned. */
  missingSkills: string[];
}

/** AI-assisted draft (natural-language creation). Never saved without explicit confirmation. */
export interface AgentDraftProposal {
  config: AgentDefinitionInput;
  rationale: string;
  missingCapabilities: Array<{ capability: string; suggestedSkill: { key: string; name: string; description: string; requiredTools: string[] } }>;
  validation: AgentValidation;
}
