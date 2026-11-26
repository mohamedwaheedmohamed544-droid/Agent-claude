/**
 * Seed catalogue. These are DATA used to (a) seed a new workspace's starter workforce and departments
 * once, (b) populate the built-in Skills Registry and Template Library. After seeding, every agent is
 * a database record managed from the Agent Management UI — nothing here is consulted at runtime to
 * decide which agents exist.
 */
import { AGENTS } from "./definitions";
import { AGENT_PROFILES } from "../office/profiles";
import { AVATAR_BY_KEY, DEFAULT_AVATAR } from "../office/avatars";
import type { AgentDefinitionInput, SkillRecord } from "./types";

// ───────────────────────── Departments ─────────────────────────

export const SEED_DEPARTMENTS = [
  { key: "executive", name: "Executive Management", nameAr: "الإدارة التنفيذية", color: "#4f46e5", kind: "executive" as const },
  { key: "research", name: "Research & Analysis", nameAr: "البحث والتحليل", color: "#2563eb", kind: "department" as const },
  { key: "bizdev", name: "Business Development", nameAr: "تطوير الأعمال", color: "#0d9488", kind: "department" as const },
  { key: "documents", name: "Document Management", nameAr: "إدارة الوثائق", color: "#7c3aed", kind: "department" as const },
  { key: "writing", name: "Writing & Content", nameAr: "الكتابة والمحتوى", color: "#db2777", kind: "department" as const },
  { key: "analytics", name: "Analytics", nameAr: "التحليلات", color: "#ea580c", kind: "department" as const },
  { key: "operations", name: "Operations", nameAr: "العمليات", color: "#16a34a", kind: "department" as const },
  { key: "marketing", name: "Marketing Intelligence", nameAr: "ذكاء التسويق", color: "#ca8a04", kind: "department" as const },
];

// ───────────────────────── Skills registry (built-in) ─────────────────────────

type SeedSkill = Omit<SkillRecord, "builtin" | "agentCount">;
const sk = (key: string, name: string, nameAr: string, category: string, description: string, instructions: string, requiredTools: string[], dependsOn: string[] = []): SeedSkill =>
  ({ key, name, nameAr, category, description, instructions, requiredTools, dependsOn });

export const BUILTIN_SKILLS: SeedSkill[] = [
  sk("web_research", "Web research", "البحث على الويب", "research", "Find and synthesise current information from the public web.",
    "Use web_search for current facts; open primary sources with fetch_url when detail matters; prefer official, recent and reputable sources; record the date of information.", ["web_search", "fetch_url"]),
  sk("source_verification", "Source verification", "التحقق من المصادر", "research", "Cross-check claims across independent sources.",
    "Verify important claims against at least two independent sources; flag single-source or conflicting facts explicitly; never present estimates as facts.", ["web_search"], ["web_research"]),
  sk("knowledge_retrieval", "Knowledge base retrieval", "الاسترجاع من قاعدة المعرفة", "research", "Search the workspace's own documents and memory.",
    "Search the workspace knowledge base and memory before external research; cite file names for document facts.", ["knowledge_search", "memory_search"]),
  sk("competitor_analysis", "Competitor analysis", "تحليل المنافسين", "research", "Structured competitor profiling and comparison.",
    "Profile competitors on offering, pricing signals, positioning, strengths, weaknesses and recent moves; compare in a table; cite sources.", ["web_search"], ["web_research"]),
  sk("document_analysis", "Document analysis", "تحليل المستندات", "documents", "Read and analyse uploaded PDF/DOCX/XLSX/PPTX files.",
    "Locate files with list_files/knowledge_search and read them fully with read_file (page through long files); quote section references; never invent content.", ["list_files", "read_file", "knowledge_search"]),
  sk("tender_analysis", "Tender & RFP analysis", "تحليل المناقصات وكراسات الشروط", "documents", "Extract scope, dates, criteria and mandatory requirements from tenders.",
    "For tenders/RFPs produce: scope, key dates, eligibility, evaluation criteria and weights, mandatory requirements, deliverables, risks and clarification questions.", ["read_file"], ["document_analysis"]),
  sk("compliance_matrix", "Compliance matrix", "مصفوفة الامتثال", "documents", "Requirement-by-requirement compliance spreadsheets.",
    "Build one row per requirement (ID, text, source ref, category, mandatory, proposed response, status) and deliver it with create_spreadsheet.", ["create_spreadsheet"], ["tender_analysis"]),
  sk("proposal_writing", "Proposal writing", "كتابة العروض", "writing", "Technical and commercial proposal drafting.",
    "Structure proposals: executive summary, understanding of requirements, approach & methodology, team, timeline, compliance, commercial summary; save with create_document.", ["create_document"]),
  sk("business_writing", "Business writing", "الكتابة المهنية", "writing", "Clear professional writing for reports and correspondence.",
    "Write concise, well-structured business text with clear headings, active voice and a clear call to action.", ["create_document"]),
  sk("arabic_writing", "Arabic business writing", "الكتابة العربية المهنية", "writing", "Formal Modern Standard Arabic for business.",
    "Write formal, fluent Modern Standard Arabic suitable for Gulf business and government audiences; correct RTL punctuation; avoid literal translation.", []),
  sk("email_drafting", "Email drafting", "صياغة الرسائل", "writing", "Prepare email drafts (never sends).",
    "Prepare emails with draft_email; keep subject lines specific; only send when the user explicitly asked and approval is granted.", ["draft_email"]),
  sk("data_analysis", "Data analysis", "تحليل البيانات", "analytics", "Exact statistics from spreadsheets and CSV files.",
    "Compute numbers with analyze_spreadsheet rather than estimating; show the figures used; state assumptions.", ["analyze_spreadsheet", "read_file"]),
  sk("kpi_reporting", "KPI reporting", "تقارير مؤشرات الأداء", "analytics", "KPI dashboards and performance summaries.",
    "Report KPIs with period-over-period change, targets vs actuals, and drivers; recommend chart types; deliver tables with create_spreadsheet.", ["create_spreadsheet"], ["data_analysis"]),
  sk("forecasting", "Forecasting", "التنبؤ", "analytics", "Forecasts with explicit assumptions and ranges.",
    "Forecast with stated assumptions and ranges (base/low/high); never false precision.", [], ["data_analysis"]),
  sk("financial_analysis", "Financial analysis", "التحليل المالي", "analytics", "Budgets, P&L, unit economics and ratios.",
    "Analyse budgets, margins, cash flow and unit economics with explicit formulas and assumptions; highlight risks.", ["analyze_spreadsheet"], ["data_analysis"]),
  sk("lead_research", "Lead research", "البحث عن العملاء المحتملين", "business", "Company and prospect discovery from authorised public sources.",
    "Research companies/prospects from public, authorised sources only; never guess personal contact details; qualify with explicit criteria and a score.", ["web_search"], ["web_research"]),
  sk("crm_preparation", "CRM preparation", "تجهيز بيانات إدارة العملاء", "business", "CRM-ready lead and opportunity tables.",
    "Prepare CRM import tables (company, contact role, source, fit score, next step) with create_spreadsheet.", ["create_spreadsheet"]),
  sk("market_research", "Market research", "أبحاث السوق", "marketing", "Market sizing, trends and segmentation.",
    "Size markets with clear method (top-down/bottom-up), identify trends and segments, cite sources and dates.", ["web_search"], ["web_research"]),
  sk("positioning_strategy", "Positioning strategy", "استراتيجية التموضع", "marketing", "Positioning, messaging and growth recommendations.",
    "Produce positioning statements, value propositions per segment and prioritised recommendations with expected impact and effort.", [], ["market_research"]),
  sk("task_coordination", "Task coordination", "تنسيق المهام", "operations", "Turn objectives into owned, dated work items.",
    "Break work into work items with owner, priority and due date using create_work_item; track status with list_work_items.", ["create_work_item", "list_work_items"]),
  sk("scheduling", "Scheduling", "الجدولة", "operations", "Calendar coordination (requires a connected calendar).",
    "Check calendars with calendar_list_events before proposing times; creating events requires approval.", ["calendar_list_events"]),
  sk("customer_support", "Customer support", "دعم العملاء", "support", "Empathetic, accurate support responses.",
    "Answer from the knowledge base; acknowledge the issue, give precise steps, escalate when unsure; never promise what the policy does not allow.", ["knowledge_search"]),
  sk("quality_review", "Quality review", "مراجعة الجودة", "quality", "Review deliverables against requirements and standards.",
    "Check deliverables against the brief and success criteria; list defects by severity with concrete fixes; verify facts and numbers.", []),
  sk("executive_support", "Executive support", "الدعم التنفيذي", "operations", "Briefings, agendas and follow-ups for executives.",
    "Prepare concise briefings, meeting agendas and action-item follow-ups; prioritise ruthlessly.", ["create_document"]),
];

export const BUILTIN_SKILL_KEYS = new Set(BUILTIN_SKILLS.map((s) => s.key));

// ───────────────────────── Defaults ─────────────────────────

export function defaultConfig(partial: Partial<AgentDefinitionInput> & Pick<AgentDefinitionInput, "nameAr" | "nameEn">): AgentDefinitionInput {
  const preset = DEFAULT_AVATAR;
  return {
    nameAr: partial.nameAr,
    nameEn: partial.nameEn,
    roleTitle: partial.roleTitle ?? "",
    roleTitleAr: partial.roleTitleAr ?? "",
    description: partial.description ?? "",
    descriptionAr: partial.descriptionAr ?? "",
    personality: partial.personality ?? "Professional, precise and concise.",
    color: partial.color ?? "#6366f1",
    capabilities: partial.capabilities ?? [],
    responsibilities: {
      main: "", instructions: "", expertise: [], deliverables: [], methodology: "", successCriteria: [],
      ...(partial.responsibilities ?? {}),
    },
    ai: {
      provider: "anthropic", model: null, tier: "standard", temperature: null, systemInstructions: "",
      ...(partial.ai ?? {}),
      memory: { useWorkspaceMemory: true, useAgentMemory: true, useKnowledgeBase: true, maxContextTokens: 90_000, ...(partial.ai?.memory ?? {}) },
    },
    tools: partial.tools ?? ["knowledge_search", "memory_search", "create_document"],
    permissions: { maxRiskLevel: 2, alwaysApproveModify: true, restrictedCategories: [], memoryAccess: "own", ...(partial.permissions ?? {}) },
    relationships: {
      supervisor: "orchestrator", delegatesTo: [], collaboratesWith: [], canJoinMeetings: true, canInitiateCollaboration: true,
      ...(partial.relationships ?? {}),
    },
    office: {
      departmentKey: "research", workstationId: null, avatarPreset: preset.key, appearance: preset.appearance,
      defaultAnimation: "idle", preferredMeetingRoom: null, visible: true,
      ...(partial.office ?? {}),
    },
    skills: partial.skills ?? [],
  };
}

// ───────────────────────── Starter workforce (seed) ─────────────────────────

const SEED_SKILLS: Record<string, string[]> = {
  research: ["web_research", "source_verification", "knowledge_retrieval", "competitor_analysis"],
  business_development: ["lead_research", "crm_preparation", "email_drafting", "web_research"],
  documents: ["document_analysis", "tender_analysis", "compliance_matrix", "proposal_writing"],
  writing: ["business_writing", "arabic_writing", "email_drafting", "proposal_writing"],
  analytics: ["data_analysis", "kpi_reporting", "forecasting", "financial_analysis"],
  operations: ["task_coordination", "scheduling", "executive_support"],
  marketing: ["market_research", "positioning_strategy", "competitor_analysis", "web_research"],
};
const SEED_RISK: Record<string, 1 | 2 | 3 | 4> = { writing: 4, operations: 4, documents: 3, research: 2, business_development: 2, analytics: 2, marketing: 2 };

export const ORCHESTRATOR_SEED: AgentDefinitionInput = defaultConfig({
  nameAr: "راشد", nameEn: "Rashed", roleTitle: "Chief Orchestrator", roleTitleAr: "المنسّق الرئيسي",
  description: "Central intelligence: interprets requests, plans, delegates to specialists, chairs meetings and consolidates results.",
  descriptionAr: "العقل المركزي: يفهم الطلبات ويخطط ويسند المهام للمتخصصين ويترأس الاجتماعات ويجمع النتائج.",
  personality: "Calm, decisive and structured; communicates clearly and keeps everyone aligned.",
  color: "#4f46e5",
  capabilities: ["Planning", "Delegation", "Coordination", "Consolidation"],
  responsibilities: { main: "Plan, delegate, coordinate and consolidate all work.", instructions: "", expertise: ["Planning", "Delegation"], deliverables: ["Execution plans", "Consolidated results"], methodology: "Decompose, delegate to the best-fit specialist, review, consolidate.", successCriteria: ["Right specialist for each step", "Coherent final deliverable"] },
  tools: [],
  permissions: { maxRiskLevel: 1, alwaysApproveModify: true, restrictedCategories: [], memoryAccess: "shared" },
  relationships: { supervisor: null, delegatesTo: [], collaboratesWith: [], canJoinMeetings: true, canInitiateCollaboration: true },
  office: { departmentKey: "executive", workstationId: null, avatarPreset: "executive_thobe_shemagh", appearance: AVATAR_BY_KEY.get("executive_thobe_shemagh")!.appearance, defaultAnimation: "idle", preferredMeetingRoom: null, visible: true },
});

/** Starter specialists derived from the original definitions + office profiles. */
export function starterWorkforce(): Array<{ slug: string; config: AgentDefinitionInput; isOrchestrator: boolean }> {
  const out: Array<{ slug: string; config: AgentDefinitionInput; isOrchestrator: boolean }> = [{ slug: "orchestrator", config: ORCHESTRATOR_SEED, isOrchestrator: true }];
  for (const def of AGENTS) {
    const prof = AGENT_PROFILES.find((p) => p.slug === def.slug)!;
    out.push({
      slug: def.slug,
      isOrchestrator: false,
      config: defaultConfig({
        nameAr: prof.nameAr, nameEn: prof.nameEn, roleTitle: prof.titleEn, roleTitleAr: prof.titleAr,
        description: def.description, descriptionAr: def.descriptionAr, color: prof.color, capabilities: def.capabilities,
        personality: "Professional, precise and evidence-driven.",
        responsibilities: { main: def.description, instructions: def.prompt, expertise: def.capabilities.slice(0, 6), deliverables: [], methodology: "", successCriteria: [] },
        ai: { provider: "anthropic", model: null, tier: def.tier, temperature: null, systemInstructions: "", memory: { useWorkspaceMemory: true, useAgentMemory: true, useKnowledgeBase: true, maxContextTokens: 90_000 } },
        tools: def.tools,
        permissions: { maxRiskLevel: SEED_RISK[def.slug] ?? 2, alwaysApproveModify: false, restrictedCategories: [], memoryAccess: "own" },
        skills: (SEED_SKILLS[def.slug] ?? []).map((key) => ({ key, mandatory: false })),
        office: { departmentKey: prof.deskZone, workstationId: null, avatarPreset: "custom", appearance: prof.appearance, defaultAnimation: "idle", preferredMeetingRoom: null, visible: true },
      }),
    });
  }
  return out;
}

// ───────────────────────── Template library (built-in) ─────────────────────────

const tpl = (key: string, name: string, nameAr: string, category: string, description: string, c: Partial<AgentDefinitionInput> & Pick<AgentDefinitionInput, "nameAr" | "nameEn">) =>
  ({ key, name, nameAr, category, description, config: defaultConfig(c) });
const look = (k: string) => ({ avatarPreset: k, appearance: AVATAR_BY_KEY.get(k)!.appearance });

export const BUILTIN_TEMPLATES = [
  tpl("research_analyst", "Research Analyst", "محلل أبحاث", "research", "Web and document research with verified, cited findings.", {
    nameAr: "محلل", nameEn: "Research Analyst", roleTitle: "Research Analyst", roleTitleAr: "محلل أبحاث", color: "#2563eb",
    responsibilities: { main: "Research questions and deliver verified, cited findings.", instructions: "", expertise: ["Desk research", "Source verification"], deliverables: ["Research briefs"], methodology: "Define question → search → verify → synthesise.", successCriteria: ["Every claim cited", "Gaps stated"] },
    tools: ["web_search", "fetch_url", "knowledge_search", "memory_search", "create_document"], skills: [{ key: "web_research", mandatory: true }, { key: "source_verification", mandatory: false }],
    office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "research", ...look("analyst_thobe_ghutra") } }),
  tpl("business_development_specialist", "Business Development Specialist", "أخصائي تطوير أعمال", "business", "Lead discovery, qualification and outreach preparation.", {
    nameAr: "مطور أعمال", nameEn: "BD Specialist", roleTitle: "Business Development Specialist", roleTitleAr: "أخصائي تطوير أعمال", color: "#0d9488",
    tools: ["web_search", "fetch_url", "knowledge_search", "create_spreadsheet", "draft_email", "create_work_item"], skills: [{ key: "lead_research", mandatory: true }, { key: "crm_preparation", mandatory: false }, { key: "email_drafting", mandatory: false }],
    office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "bizdev", ...look("consultant_suit") } }),
  tpl("data_analyst", "Data Analyst", "محلل بيانات", "analytics", "Exact analysis of spreadsheets, KPIs and trends.", {
    nameAr: "محلل بيانات", nameEn: "Data Analyst", roleTitle: "Data Analyst", roleTitleAr: "محلل بيانات", color: "#ea580c", ai: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).ai, tier: "advanced" },
    tools: ["list_files", "read_file", "analyze_spreadsheet", "knowledge_search", "create_spreadsheet", "create_document"], skills: [{ key: "data_analysis", mandatory: true }, { key: "kpi_reporting", mandatory: false }],
    office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "analytics", ...look("analyst_blazer_hijab") } }),
  tpl("project_manager", "Project Manager", "مدير مشروع", "operations", "Plans, work items, schedules and status tracking.", {
    nameAr: "مدير المشروع", nameEn: "Project Manager", roleTitle: "Project Manager", roleTitleAr: "مدير مشروع", color: "#16a34a", ai: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).ai, tier: "fast" },
    tools: ["list_work_items", "create_work_item", "update_work_item", "create_document", "calendar_list_events"], permissions: { maxRiskLevel: 3, alwaysApproveModify: true, restrictedCategories: [], memoryAccess: "own" },
    skills: [{ key: "task_coordination", mandatory: true }, { key: "scheduling", mandatory: false }],
    office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "operations", ...look("manager_blazer_hijab") } }),
  tpl("marketing_strategist", "Marketing Strategist", "استراتيجي تسويق", "marketing", "Market research, positioning and growth strategy.", {
    nameAr: "استراتيجي", nameEn: "Marketing Strategist", roleTitle: "Marketing Strategist", roleTitleAr: "استراتيجي تسويق", color: "#ca8a04",
    tools: ["web_search", "fetch_url", "knowledge_search", "memory_search", "create_document"], skills: [{ key: "market_research", mandatory: true }, { key: "positioning_strategy", mandatory: false }],
    office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "marketing", ...look("strategist_abaya_tablet") } }),
  tpl("proposal_specialist", "Proposal Specialist", "أخصائي عروض", "documents", "Tender analysis, compliance matrices and proposals.", {
    nameAr: "أخصائي العروض", nameEn: "Proposal Specialist", roleTitle: "Proposal Specialist", roleTitleAr: "أخصائي عروض", color: "#7c3aed", ai: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).ai, tier: "advanced" },
    tools: ["list_files", "read_file", "knowledge_search", "create_document", "create_spreadsheet"], skills: [{ key: "tender_analysis", mandatory: true }, { key: "document_analysis", mandatory: true }, { key: "compliance_matrix", mandatory: false }, { key: "proposal_writing", mandatory: false }],
    office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "documents", ...look("specialist_abaya_hijab") } }),
  tpl("financial_analyst", "Financial Analyst", "محلل مالي", "analytics", "Budgets, margins, unit economics and financial models.", {
    nameAr: "المحلل المالي", nameEn: "Financial Analyst", roleTitle: "Financial Analyst", roleTitleAr: "محلل مالي", color: "#b45309", ai: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).ai, tier: "advanced" },
    tools: ["list_files", "read_file", "analyze_spreadsheet", "create_spreadsheet", "create_document"], skills: [{ key: "financial_analysis", mandatory: true }, { key: "data_analysis", mandatory: true }, { key: "forecasting", mandatory: false }],
    office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "analytics", ...look("neutral_blazer") } }),
  tpl("operations_manager", "Operations Manager", "مدير عمليات", "operations", "Workflow coordination, checklists and execution tracking.", {
    nameAr: "مدير العمليات", nameEn: "Operations Manager", roleTitle: "Operations Manager", roleTitleAr: "مدير عمليات", color: "#15803d",
    tools: ["list_work_items", "create_work_item", "update_work_item", "create_document"], permissions: { maxRiskLevel: 3, alwaysApproveModify: true, restrictedCategories: [], memoryAccess: "own" },
    skills: [{ key: "task_coordination", mandatory: true }],
    office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "operations", ...look("coordinator_thobe_headset") } }),
  tpl("executive_assistant", "Executive Assistant", "مساعد تنفيذي", "operations", "Briefings, agendas, drafts and follow-ups for executives.", {
    nameAr: "المساعد التنفيذي", nameEn: "Executive Assistant", roleTitle: "Executive Assistant", roleTitleAr: "مساعد تنفيذي", color: "#6366f1", ai: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).ai, tier: "fast" },
    tools: ["knowledge_search", "memory_search", "create_document", "draft_email", "create_work_item", "calendar_list_events"], skills: [{ key: "executive_support", mandatory: true }, { key: "email_drafting", mandatory: false }],
    office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "executive", ...look("neutral_cardigan") } }),
  tpl("content_writer", "Content Writer", "كاتب محتوى", "writing", "Arabic and English reports, articles and LinkedIn content.", {
    nameAr: "كاتب المحتوى", nameEn: "Content Writer", roleTitle: "Content Writer", roleTitleAr: "كاتب محتوى", color: "#db2777",
    tools: ["knowledge_search", "memory_search", "create_document", "draft_email"], skills: [{ key: "business_writing", mandatory: true }, { key: "arabic_writing", mandatory: false }],
    office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "writing", ...look("writer_shirt") } }),
  tpl("customer_support_specialist", "Customer Support Specialist", "أخصائي دعم العملاء", "support", "Accurate, empathetic answers from the knowledge base.", {
    nameAr: "دعم العملاء", nameEn: "Support Specialist", roleTitle: "Customer Support Specialist", roleTitleAr: "أخصائي دعم العملاء", color: "#0891b2", ai: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).ai, tier: "fast" },
    tools: ["knowledge_search", "memory_search", "draft_email"], skills: [{ key: "customer_support", mandatory: true }],
    office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "operations", ...look("neutral_turtleneck") } }),
  tpl("quality_assurance_specialist", "Quality Assurance Specialist", "أخصائي ضمان الجودة", "quality", "Reviews deliverables against briefs and standards.", {
    nameAr: "ضمان الجودة", nameEn: "QA Specialist", roleTitle: "Quality Assurance Specialist", roleTitleAr: "أخصائي ضمان الجودة", color: "#475569",
    tools: ["knowledge_search", "read_file", "list_files", "create_document"], skills: [{ key: "quality_review", mandatory: true }],
    office: { ...defaultConfig({ nameAr: "x", nameEn: "x" }).office, departmentKey: "documents", ...look("neutral_blazer") } }),
];
