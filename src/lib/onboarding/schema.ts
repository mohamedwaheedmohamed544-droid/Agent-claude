/**
 * Company onboarding questionnaire — client-safe contract shared by the wizard and the server.
 *
 * Six steps (Blueprint §5.2): identity, business, structure, work, systems, priorities.
 * Questions are conditional: `visibleQuestions(answers)` decides what a given company is asked,
 * and the server validates against the same rules, so hidden answers are never required.
 */
import { z } from "zod";

export type Bi = { en: string; ar: string };
export interface Option<K extends string = string> { key: K; label: Bi; hint?: Bi }
const o = <K extends string>(key: K, en: string, ar: string, hint?: Bi): Option<K> => ({ key, label: { en, ar }, hint });

// ───────────────────────── Option catalogues ─────────────────────────

export const STEPS = ["identity", "business", "structure", "work", "systems", "priorities"] as const;
export type StepKey = (typeof STEPS)[number];
export const STEP_LABELS: Record<StepKey, Bi> = {
  identity: { en: "Company identity", ar: "هوية الشركة" },
  business: { en: "Business model", ar: "نموذج العمل" },
  structure: { en: "Teams", ar: "الفرق" },
  work: { en: "Work & processes", ar: "العمل والإجراءات" },
  systems: { en: "Systems", ar: "الأنظمة" },
  priorities: { en: "Priorities", ar: "الأولويات" },
};

export const COUNTRIES = [
  o("SA", "Saudi Arabia", "السعودية"), o("AE", "United Arab Emirates", "الإمارات"), o("QA", "Qatar", "قطر"),
  o("KW", "Kuwait", "الكويت"), o("BH", "Bahrain", "البحرين"), o("OM", "Oman", "عُمان"), o("OTHER", "Other", "أخرى"),
];

export const INDUSTRIES = [
  o("consulting", "Consulting & professional services", "الاستشارات والخدمات المهنية"),
  o("agency", "Marketing & creative agency", "وكالة تسويق وإبداع"),
  o("technology", "Technology & digital services", "التقنية والخدمات الرقمية"),
  o("recruitment", "Recruitment & HR services", "التوظيف والموارد البشرية"),
  o("business_services", "Business support & operations services", "خدمات دعم الأعمال والعمليات"),
  o("other", "Other", "أخرى"),
] as const;
export type IndustryKey = (typeof INDUSTRIES)[number]["key"];

export const SIZES = [
  o("1-9", "1–9 employees", "١–٩ موظفين"), o("10-24", "10–24 employees", "١٠–٢٤ موظفًا"),
  o("25-49", "25–49 employees", "٢٥–٤٩ موظفًا"), o("50-100", "50–100 employees", "٥٠–١٠٠ موظف"), o("100+", "More than 100", "أكثر من ١٠٠"),
] as const;
export type SizeKey = (typeof SIZES)[number]["key"];

export const BUSINESS_TYPES = [o("b2b", "B2B — businesses", "شركات (B2B)"), o("b2c", "B2C — consumers", "أفراد (B2C)"), o("b2g", "B2G — government", "جهات حكومية (B2G)"), o("mixed", "Mixed", "مختلط")] as const;
export type BusinessTypeKey = (typeof BUSINESS_TYPES)[number]["key"];

export const LANGUAGES = [o("ar", "Arabic", "العربية"), o("en", "English", "الإنجليزية"), o("both", "Arabic and English", "العربية والإنجليزية")] as const;
export type LanguageKey = (typeof LANGUAGES)[number]["key"];

export const REVENUE_CHANNELS = [
  o("direct_sales", "Direct sales", "المبيعات المباشرة"), o("tenders", "Tenders & RFPs", "المناقصات وطلبات العروض"),
  o("referrals", "Referrals & network", "الإحالات والعلاقات"), o("online", "Online / website", "القنوات الإلكترونية"),
  o("partners", "Partners & resellers", "الشركاء والموزعون"), o("retainers", "Retainers & contracts", "العقود والاشتراكات"),
] as const;

export const OBJECTIVES = [
  o("grow_revenue", "Grow revenue and win more clients", "زيادة الإيرادات وكسب عملاء أكثر"),
  o("faster_delivery", "Deliver client work faster", "تسليم أعمال العملاء بشكل أسرع"),
  o("better_reporting", "Better reporting and decisions", "تقارير وقرارات أفضل"),
  o("reduce_admin", "Reduce administrative workload", "تقليل الأعباء الإدارية"),
  o("customer_experience", "Improve customer experience", "تحسين تجربة العملاء"),
  o("hire_faster", "Hire faster and better", "التوظيف بشكل أسرع وأفضل"),
  o("brand_awareness", "Build brand awareness", "بناء الوعي بالعلامة التجارية"),
] as const;
export type ObjectiveKey = (typeof OBJECTIVES)[number]["key"];

export const CHALLENGES = [
  o("manual_reporting", "Reports take too long to prepare", "إعداد التقارير يستغرق وقتًا طويلًا"),
  o("slow_proposals", "Proposals and tenders take too long", "إعداد العروض والمناقصات بطيء"),
  o("lead_generation", "Not enough qualified leads", "قلة العملاء المحتملين المؤهلين"),
  o("follow_up", "Follow-ups fall through the cracks", "ضياع المتابعات"),
  o("scattered_info", "Information is scattered across tools", "تشتت المعلومات بين الأدوات"),
  o("slow_handoffs", "Slow handoffs between teams", "بطء التسليم بين الفرق"),
  o("small_team", "Small team, too much workload", "فريق صغير وعبء عمل كبير"),
  o("no_visibility", "Little visibility into work status", "ضعف الرؤية لحالة العمل"),
  o("content_consistency", "Inconsistent marketing content", "عدم انتظام المحتوى التسويقي"),
  o("support_volume", "Too many customer inquiries", "كثرة استفسارات العملاء"),
] as const;
export type ChallengeKey = (typeof CHALLENGES)[number]["key"];

/** Business functions a company may have. Some only apply to certain industries/business types. */
export const FUNCTIONS = [
  o("sales", "Sales & business development", "المبيعات وتطوير الأعمال"),
  o("marketing", "Marketing & content", "التسويق والمحتوى"),
  o("delivery", "Client delivery & projects", "تنفيذ أعمال العملاء والمشاريع"),
  o("operations", "Operations & administration", "العمليات والإدارة"),
  o("finance", "Finance & accounting", "المالية والمحاسبة"),
  o("hr", "HR & people", "الموارد البشرية"),
  o("recruitment", "Recruitment for clients", "التوظيف لصالح العملاء"),
  o("customer_support", "Customer support", "دعم العملاء"),
  o("research", "Research & analysis", "البحث والتحليل"),
  o("proposals", "Proposals & tenders", "العروض والمناقصات"),
] as const;
export type FunctionKey = (typeof FUNCTIONS)[number]["key"];

export const FUNCTION_STATUSES = [
  o("internal", "We have a team", "لدينا فريق"), o("outsourced", "Outsourced", "مُسند لجهة خارجية"),
  o("missing", "We need it but don't have it", "نحتاجها وليست لدينا"), o("not_needed", "Not relevant", "غير مطلوبة"),
] as const;
export type FunctionStatus = (typeof FUNCTION_STATUSES)[number]["key"];

export const TASKS = [
  o("weekly_reporting", "Weekly / monthly reports", "التقارير الأسبوعية والشهرية"),
  o("lead_research", "Finding and qualifying leads", "البحث عن العملاء المحتملين وتأهيلهم"),
  o("proposal_writing", "Writing proposals", "كتابة العروض"),
  o("tender_review", "Reviewing tenders & RFPs", "مراجعة المناقصات وكراسات الشروط"),
  o("email_followup", "Email follow-ups", "متابعة الرسائل"),
  o("scheduling", "Scheduling meetings", "جدولة الاجتماعات"),
  o("meeting_notes", "Meeting notes & action items", "محاضر الاجتماعات والمهام"),
  o("document_review", "Reviewing contracts & documents", "مراجعة العقود والمستندات"),
  o("data_entry", "Data entry & spreadsheet updates", "إدخال البيانات وتحديث الجداول"),
  o("market_research", "Market & competitor research", "أبحاث السوق والمنافسين"),
  o("social_content", "Social media & marketing content", "محتوى التواصل الاجتماعي والتسويق"),
  o("customer_inquiries", "Answering customer inquiries", "الرد على استفسارات العملاء"),
  o("invoice_followup", "Invoice & payment follow-up", "متابعة الفواتير والمدفوعات"),
  o("candidate_screening", "Screening candidates & CVs", "فرز المرشحين والسير الذاتية"),
  o("project_tracking", "Tracking project status", "متابعة حالة المشاريع"),
  o("client_reporting", "Client progress reports", "تقارير تقدم العملاء"),
] as const;
export type TaskKey = (typeof TASKS)[number]["key"];

export const RESEARCH_NEEDS = [
  o("market", "Market trends & sizing", "اتجاهات السوق وحجمه"), o("competitors", "Competitors", "المنافسون"),
  o("tenders", "Tender opportunities", "فرص المناقصات"), o("leads", "Prospective clients", "العملاء المحتملون"),
  o("industry_news", "Industry news & regulations", "أخبار القطاع والأنظمة"),
] as const;

export const REPORTING_NEEDS = [
  o("kpi", "Internal KPI reports", "تقارير مؤشرات الأداء الداخلية"), o("financial", "Financial reports", "التقارير المالية"),
  o("client", "Client reports", "تقارير العملاء"), o("management", "Management briefings", "إحاطات للإدارة"),
] as const;

export const FOLLOWUPS = [
  o("leads", "Prospects & leads", "العملاء المحتملون"), o("clients", "Existing clients", "العملاء الحاليون"),
  o("internal", "Internal tasks & owners", "المهام الداخلية والمسؤولون"), o("payments", "Payments & invoices", "المدفوعات والفواتير"),
  o("candidates", "Candidates", "المرشحون"),
] as const;

/** Actions the customer wants a human to approve before they happen. */
export const APPROVAL_AREAS = [
  o("external_emails", "Sending emails to people outside the company", "إرسال رسائل لأشخاص خارج الشركة"),
  o("client_documents", "Documents sent to clients", "المستندات المرسلة للعملاء"),
  o("pricing", "Pricing and quotations", "الأسعار وعروض الأسعار"),
  o("financial", "Anything financial", "أي أمر مالي"),
  o("publishing", "Publishing content", "نشر المحتوى"),
  o("hiring_decisions", "Hiring decisions", "قرارات التوظيف"),
  o("data_changes", "Changing records in our systems", "تعديل السجلات في أنظمتنا"),
  o("calendar_changes", "Creating meetings & calendar invites", "إنشاء الاجتماعات ودعوات التقويم"),
] as const;
export type ApprovalAreaKey = (typeof APPROVAL_AREAS)[number]["key"];

/** Work that must stay human-only — agents may prepare, never perform. */
export const HUMAN_ONLY = [
  o("client_negotiation", "Client negotiations", "التفاوض مع العملاء"), o("final_pricing", "Final pricing decisions", "قرارات التسعير النهائية"),
  o("payments", "Making payments", "تنفيذ المدفوعات"), o("hiring", "Final hiring decisions", "قرارات التوظيف النهائية"),
  o("external_communication", "All external communication", "جميع المراسلات الخارجية"), o("legal", "Legal commitments & contracts", "الالتزامات القانونية والعقود"),
] as const;
export type HumanOnlyKey = (typeof HUMAN_ONLY)[number]["key"];

export const SENSITIVE_DATA = [
  o("customer_personal", "Customers' personal data", "البيانات الشخصية للعملاء"), o("financial", "Financial records", "السجلات المالية"),
  o("employee", "Employee & HR records", "سجلات الموظفين"), o("contracts", "Contracts & pricing", "العقود والأسعار"),
  o("candidate", "Candidate CVs", "السير الذاتية للمرشحين"), o("government_ids", "National IDs / Iqama", "الهويات الوطنية / الإقامات"),
  o("health", "Health information", "المعلومات الصحية"),
] as const;
export type SensitiveKey = (typeof SENSITIVE_DATA)[number]["key"];

/** Systems by category. `native` = a working Nexus integration exists today. */
export interface SystemOption extends Option { native?: "google" | "microsoft" }
const so = (key: string, en: string, ar: string, native?: "google" | "microsoft"): SystemOption => ({ key, label: { en, ar }, native });
export const SYSTEM_CATEGORIES = {
  email: { label: { en: "Email", ar: "البريد الإلكتروني" }, options: [so("google_workspace", "Google Workspace (Gmail)", "Google Workspace (Gmail)", "google"), so("microsoft_365", "Microsoft 365 (Outlook)", "Microsoft 365 (Outlook)", "microsoft")] },
  calendar: { label: { en: "Calendar", ar: "التقويم" }, options: [so("google_workspace", "Google Calendar", "تقويم Google", "google"), so("microsoft_365", "Outlook Calendar", "تقويم Outlook", "microsoft")] },
  storage: { label: { en: "Document storage", ar: "تخزين المستندات" }, options: [so("google_drive", "Google Drive", "Google Drive", "google"), so("onedrive", "OneDrive / SharePoint", "OneDrive / SharePoint"), so("dropbox", "Dropbox", "Dropbox")] },
  crm: { label: { en: "CRM", ar: "إدارة علاقات العملاء" }, options: [so("hubspot", "HubSpot", "HubSpot"), so("salesforce", "Salesforce", "Salesforce"), so("zoho_crm", "Zoho CRM", "Zoho CRM"), so("odoo", "Odoo", "Odoo"), so("spreadsheets", "Spreadsheets", "جداول بيانات")] },
  project_management: { label: { en: "Project management", ar: "إدارة المشاريع" }, options: [so("asana", "Asana", "Asana"), so("trello", "Trello", "Trello"), so("monday", "monday.com", "monday.com"), so("jira", "Jira", "Jira"), so("clickup", "ClickUp", "ClickUp")] },
  accounting: { label: { en: "Accounting / ERP", ar: "المحاسبة / تخطيط الموارد" }, options: [so("qoyod", "Qoyod", "قيود"), so("zoho_books", "Zoho Books", "Zoho Books"), so("odoo", "Odoo", "Odoo"), so("quickbooks", "QuickBooks", "QuickBooks"), so("sap", "SAP", "SAP")] },
  hr: { label: { en: "HR & recruitment", ar: "الموارد البشرية والتوظيف" }, options: [so("jisr", "Jisr", "جسر"), so("bayzat", "Bayzat", "بيزات"), so("linkedin_recruiter", "LinkedIn Recruiter", "LinkedIn Recruiter"), so("zoho_recruit", "Zoho Recruit", "Zoho Recruit")] },
  support: { label: { en: "Customer support", ar: "دعم العملاء" }, options: [so("zendesk", "Zendesk", "Zendesk"), so("freshdesk", "Freshdesk", "Freshdesk"), so("whatsapp_business", "WhatsApp Business", "واتساب للأعمال"), so("intercom", "Intercom", "Intercom")] },
  marketing: { label: { en: "Marketing & analytics", ar: "التسويق والتحليلات" }, options: [so("google_analytics", "Google Analytics", "Google Analytics"), so("meta_business", "Meta Business Suite", "Meta Business Suite"), so("mailchimp", "Mailchimp", "Mailchimp"), so("linkedin", "LinkedIn", "LinkedIn")] },
} as const satisfies Record<string, { label: Bi; options: SystemOption[] }>;
export type SystemCategory = keyof typeof SYSTEM_CATEGORIES;
export const SYSTEM_CATEGORY_KEYS = Object.keys(SYSTEM_CATEGORIES) as SystemCategory[];

export const PRIORITIES = [
  o("productivity", "Improve productivity", "رفع الإنتاجية"), o("revenue", "Increase revenue", "زيادة الإيرادات"),
  o("customer_experience", "Improve customer experience", "تحسين تجربة العملاء"), o("workload", "Reduce operational workload", "تقليل عبء العمليات"),
  o("reporting", "Better reporting & decision support", "تقارير ودعم قرار أفضل"), o("delivery_speed", "Accelerate service delivery", "تسريع تقديم الخدمة"),
] as const;
export type PriorityKey = (typeof PRIORITIES)[number]["key"];

// ───────────────────────── Answer schema ─────────────────────────

const keysOf = <T extends readonly Option[]>(opts: T) => opts.map((x) => x.key) as [T[number]["key"], ...T[number]["key"][]];
const multi = <T extends readonly Option[]>(opts: T, max = 20) => z.array(z.enum(keysOf(opts))).max(max).default([]);
const text = (max: number) => z.string().trim().max(max).default("");

export const FunctionAnswerSchema = z.object({
  status: z.enum(keysOf(FUNCTION_STATUSES)),
  teamSize: z.number().int().min(0).max(10_000).nullable().default(null),
  notes: text(500),
});
export type FunctionAnswer = z.infer<typeof FunctionAnswerSchema>;

export const SystemAnswerSchema = z.object({
  tools: z.array(z.string().regex(/^[a-z0-9_]{2,40}$/)).max(6).default([]),
  other: text(120),
  none: z.boolean().default(false),
});

export const AnswersSchema = z.object({
  identity: z.object({
    companyName: z.string().trim().min(1).max(120),
    country: z.enum(keysOf(COUNTRIES)),
    locations: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
    industry: z.enum(keysOf(INDUSTRIES)),
    subIndustry: text(120),
    website: z.string().trim().max(200).refine((v) => !v || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), "Enter a full URL such as https://example.com").default(""),
    size: z.enum(keysOf(SIZES)),
    businessType: z.enum(keysOf(BUSINESS_TYPES)),
    language: z.enum(keysOf(LANGUAGES)),
  }),
  business: z.object({
    offerings: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
    targetCustomers: z.string().trim().min(2).max(500),
    revenueChannels: multi(REVENUE_CHANNELS),
    objectives: multi(OBJECTIVES).refine((v) => v.length > 0, "Choose at least one objective"),
    challenges: multi(CHALLENGES),
    otherChallenges: text(500),
  }),
  structure: z.object({
    functions: z.record(z.string(), FunctionAnswerSchema).default({}),
  }),
  work: z.object({
    repetitiveTasks: multi(TASKS),
    timeConsumingTasks: multi(TASKS),
    researchNeeds: multi(RESEARCH_NEEDS),
    reportingNeeds: multi(REPORTING_NEEDS),
    followUps: multi(FOLLOWUPS),
    approvalAreas: multi(APPROVAL_AREAS),
    humanOnly: multi(HUMAN_ONLY),
    otherHumanOnly: text(500),
    sensitiveData: multi(SENSITIVE_DATA),
  }),
  systems: z.object(Object.fromEntries(SYSTEM_CATEGORY_KEYS.map((k) => [k, SystemAnswerSchema.optional()])) as Record<SystemCategory, z.ZodOptional<typeof SystemAnswerSchema>>),
  priorities: z.object({
    ranked: z.array(z.enum(keysOf(PRIORITIES))).min(1).max(3),
  }),
});
export type Answers = z.infer<typeof AnswersSchema>;
export type PartialAnswers = { [K in StepKey]?: Partial<Answers[K]> };
export const StepSchemas: Record<StepKey, z.ZodTypeAny> = {
  identity: AnswersSchema.shape.identity, business: AnswersSchema.shape.business, structure: AnswersSchema.shape.structure,
  work: AnswersSchema.shape.work, systems: AnswersSchema.shape.systems, priorities: AnswersSchema.shape.priorities,
};

// ───────────────────────── Conditional questions ─────────────────────────

/** Which business functions this company is asked about (§5.2: conditional, not every question for everyone). */
export function relevantFunctions(a: PartialAnswers): FunctionKey[] {
  const industry = a.identity?.industry;
  const type = a.identity?.businessType;
  const channels = a.business?.revenueChannels ?? [];
  const out: FunctionKey[] = ["sales", "marketing", "operations", "finance", "hr", "research"];
  if (industry !== "other" || channels.includes("retainers")) out.splice(2, 0, "delivery");
  if (industry === "recruitment") out.push("recruitment");
  if (type === "b2c" || type === "mixed" || industry === "technology" || industry === "business_services") out.push("customer_support");
  if (type === "b2g" || channels.includes("tenders") || industry === "consulting") out.push("proposals");
  return out;
}

/** Tasks offered in the "work" step, filtered by what applies to the company. */
export function relevantTasks(a: PartialAnswers): TaskKey[] {
  const fns = new Set(relevantFunctions(a));
  const active = (f: FunctionKey) => fns.has(f) && (a.structure?.functions?.[f]?.status ?? "internal") !== "not_needed";
  return TASKS.map((t) => t.key).filter((k) => {
    if (k === "candidate_screening") return active("recruitment") || active("hr");
    if (k === "tender_review") return active("proposals");
    if (k === "customer_inquiries") return active("customer_support");
    if (k === "client_reporting" || k === "project_tracking") return active("delivery") || active("operations");
    if (k === "invoice_followup") return active("finance");
    if (k === "social_content") return active("marketing");
    return true;
  });
}

export function relevantSystemCategories(a: PartialAnswers): SystemCategory[] {
  const fns = new Set(relevantFunctions(a));
  const f = a.structure?.functions ?? {};
  const active = (k: FunctionKey) => fns.has(k) && (f[k]?.status ?? "internal") !== "not_needed";
  return SYSTEM_CATEGORY_KEYS.filter((c) => {
    if (c === "support") return active("customer_support");
    if (c === "hr") return active("hr") || active("recruitment");
    if (c === "accounting") return active("finance");
    if (c === "marketing") return active("marketing");
    if (c === "crm") return active("sales");
    return true;
  });
}

/** Team size is only asked of companies with 10+ employees, for functions they run internally. */
export function asksTeamSize(a: PartialAnswers): boolean {
  return Boolean(a.identity?.size && a.identity.size !== "1-9");
}

export function relevantResearchNeeds(a: PartialAnswers) {
  const tenders = relevantFunctions(a).includes("proposals");
  return RESEARCH_NEEDS.filter((r) => r.key !== "tenders" || tenders);
}

/**
 * Validates a single step against the conditional rules. Returns the cleaned step value
 * with answers to questions this company was not asked removed.
 */
export function cleanStep(step: StepKey, raw: unknown, context: PartialAnswers): unknown {
  const parsed = StepSchemas[step].parse(raw);
  if (step === "structure") {
    const allowed = new Set(relevantFunctions(context));
    const team = asksTeamSize(context);
    const fns: Record<string, FunctionAnswer> = {};
    for (const [k, v] of Object.entries((parsed as Answers["structure"]).functions)) {
      if (!allowed.has(k as FunctionKey)) continue;
      fns[k] = { ...v, teamSize: team && v.status === "internal" ? v.teamSize : null };
    }
    for (const k of allowed) if (!fns[k]) throw new z.ZodError([{ code: "custom", path: ["functions", k], message: `Tell us about ${k}`, input: undefined }]);
    return { functions: fns };
  }
  if (step === "work") {
    const w = parsed as Answers["work"];
    const tasks = new Set(relevantTasks(context));
    const research = new Set(relevantResearchNeeds(context).map((r) => r.key));
    const repetitive = w.repetitiveTasks.filter((t) => tasks.has(t));
    return { ...w, repetitiveTasks: repetitive, timeConsumingTasks: w.timeConsumingTasks.filter((t) => repetitive.includes(t)), researchNeeds: w.researchNeeds.filter((r) => research.has(r)) };
  }
  if (step === "systems") {
    const cats = new Set(relevantSystemCategories(context));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!cats.has(k as SystemCategory) || !v) continue;
      const known = new Set(SYSTEM_CATEGORIES[k as SystemCategory].options.map((x) => x.key) as string[]);
      const s = v as { tools: string[]; other: string; none: boolean };
      out[k] = s.none ? { tools: [], other: "", none: true } : { ...s, tools: s.tools.filter((t) => known.has(t)) };
    }
    return out;
  }
  return parsed;
}

export function isComplete(a: PartialAnswers): a is Answers {
  return AnswersSchema.safeParse(a).success && STEPS.every((s) => a[s] !== undefined);
}

export function labelOf(list: readonly Option[], key: string, locale: "en" | "ar"): string {
  return list.find((x) => x.key === key)?.label[locale] ?? key;
}
