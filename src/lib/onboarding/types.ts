/** Client-safe types for the Company Operating Profile and Workforce Blueprint. */
import type { Bi, FunctionKey, SystemCategory } from "./schema";

export type Origin = "provided" | "inferred" | "needs_confirmation" | "customer_edit";

/** A customer answer a recommendation rests on (`ref` = "<answer path>:<value>"). */
export interface Basis { ref: string; label: Bi }

export interface Fact { key: string; statement: Bi; origin: Origin; basis: Basis[] }

export interface OperatingProfile {
  engine: string;
  company: { name: string; country: string; locations: string[]; industry: string; subIndustry: string; website: string; size: string; businessType: string; language: "ar" | "en" | "both" };
  model: { offerings: string[]; targetCustomers: string; revenueChannels: string[]; objectives: string[]; challenges: string[] };
  functions: Array<{ key: FunctionKey; label: Bi; status: "internal" | "outsourced" | "missing" | "not_needed"; teamSize: number | null; notes: string }>;
  demand: { repetitiveTasks: string[]; timeConsumingTasks: string[]; researchNeeds: string[]; reportingNeeds: string[]; followUps: string[] };
  governance: {
    approvalAreas: string[]; humanOnly: string[]; otherHumanOnly: string; sensitiveData: string[];
    classifications: Array<{ key: string; label: Bi; level: "confidential" | "restricted" }>;
  };
  systems: Array<{ category: SystemCategory; tools: string[]; other: string; none: boolean }>;
  priorities: string[];
  freeText: { challenges: string; humanOnly: string };
  facts: Fact[];
}

export interface BlueprintDepartment {
  key: string; function: FunctionKey; name: Bi; color: string; objective: Bi; isNew: boolean;
  why: Bi; basis: Basis[]; origin: Origin;
}

export interface BlueprintAgent {
  key: string;
  roleKey: string;
  departmentKey: string;
  function: FunctionKey;
  nameEn: string;
  nameAr: string;
  title: Bi;
  summary: Bi;
  duties: Bi[];
  /** Customer-written responsibilities that replace `duties` when set. */
  customDuties: string | null;
  /** Starter agent reconfigured instead of creating a duplicate. */
  reuse: string | null;
  templateKey: string | null;
  tier: "fast" | "standard" | "advanced";
  /** Highest risk the role needs; the customer may only lower it (`riskCap`). */
  roleRisk: 1 | 2 | 3 | 4;
  riskCap: 1 | 2 | 3 | null;
  maxRiskLevel: 1 | 2 | 3;
  alwaysApproveModify: boolean;
  tools: string[];
  skills: string[];
  integrations: string[];
  boundaries: Bi[];
  supervisorKey: string;
  delegatesTo: string[];
  collaboratesWith: string[];
  why: Bi;
  basis: Basis[];
  origin: Origin;
  edited?: boolean;
}

export interface BlueprintIntegration {
  key: string;
  provider: "google" | "microsoft" | null;
  name: Bi;
  category: SystemCategory;
  /** available = a working Nexus connector exists today. */
  status: "available" | "not_supported_yet";
  decision: "accepted" | "rejected";
  capabilities: Array<"email" | "calendar" | "storage">;
  usedBy: string[];
  why: Bi; basis: Basis[]; origin: Origin;
}

export interface BlueprintApproval {
  key: string;
  label: Bi;
  /** platform = always on · tool_policy = enforced by the tool executor · no_tool = no agent has a tool for it · instruction = agent instruction */
  enforcement: "platform" | "tool_policy" | "instruction" | "no_tool";
  locked: boolean;
  enabled: boolean;
  effect: Bi;
  why: Bi; basis: Basis[]; origin: Origin;
  appliesTo?: "all" | string[];
  ruleText?: string;
}

export interface BlueprintWorkflow {
  key: string; name: Bi; description: Bi; agents: string[]; approvals: Bi[]; prompt: Bi; why: Bi; basis: Basis[];
}

export interface WorkforceBlueprint {
  engine: string;
  company: { name: string; language: "ar" | "en" | "both"; size: string };
  departments: BlueprintDepartment[];
  agents: BlueprintAgent[];
  integrations: BlueprintIntegration[];
  approvals: BlueprintApproval[];
  workflows: BlueprintWorkflow[];
  outcomes: Array<{ text: Bi; basis: Basis[]; covered: boolean }>;
  openQuestions: Array<{ key: string; text: Bi; origin: Origin }>;
  dataPolicy: { defaultLevel: "internal"; categories: Array<{ key: string; label: Bi; level: "confidential" | "restricted" }>; note: Bi };
  settings: { autoApproveLevel3: boolean; autoApproveAgentMemories: boolean };
  edits: number;
}

export type BlueprintEdit =
  | { op: "remove_agent"; agent: string }
  | { op: "add_agent"; role: string; function?: string }
  | { op: "update_agent"; agent: string; nameEn?: string; nameAr?: string; duties?: string; riskCap?: 1 | 2 | 3 | null }
  | { op: "remove_department"; department: string }
  | { op: "rename_department"; department: string; name: string; nameAr: string }
  | { op: "set_integration"; integration: string; decision: "accepted" | "rejected" }
  | { op: "set_approval"; approval: string; enabled: boolean };

export type BlueprintStatus = "proposed" | "approved" | "applying" | "applied" | "failed" | "superseded" | "rejected";

export interface GenerationReport {
  departmentsCreated: string[];
  departmentsReused: string[];
  departmentsRemoved: string[];
  agents: Array<{ key: string; slug: string; action: "created" | "reconfigured"; name: string }>;
  deactivated: Array<{ slug: string; name: string }>;
  integrationsToConnect: Array<{ key: string; name: Bi }>;
  settings: { autoApproveLevel3: boolean; autoApproveAgentMemories: boolean };
  validation: Array<{ slug: string; warnings: string[] }>;
  error?: string;
}

export interface BlueprintRecord {
  id: string;
  version: number;
  status: BlueprintStatus;
  engine: string;
  blueprint: WorkforceBlueprint;
  hash: string;
  edits: Array<{ at: string; by: string | null; edit: BlueprintEdit }>;
  revisionNote: string | null;
  decisionNote: string | null;
  report: GenerationReport | null;
  createdAt: string;
  decidedAt: string | null;
  appliedAt: string | null;
}

export interface OnboardingState {
  status: "not_started" | "in_progress" | "proposed" | "active" | "skipped";
  answers: Record<string, unknown>;
  currentStep: string;
  profile: OperatingProfile | null;
  complete: boolean;
  blueprint: BlueprintRecord | null;
  history: Array<{ id: string; version: number; status: BlueprintStatus; createdAt: string }>;
  canManage: boolean;
}
