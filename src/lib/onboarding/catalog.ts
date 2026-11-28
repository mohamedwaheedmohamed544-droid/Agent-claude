/**
 * Workforce catalogue used by the blueprint engine (data, not behaviour).
 *
 * - FUNCTION_DEPARTMENTS: how a business function becomes a department (reusing the seeded keys
 *   where the meaning matches, so existing agents/office zones stay valid).
 * - ROLES: reusable agent roles. A role is recommended only when answers trigger it; `reuse` names a
 *   starter agent that already performs this role (it is reconfigured instead of duplicated).
 * - WORKFLOWS: initial workflows, proposed only when every role they need is in the workforce.
 */
import type { Bi, FunctionKey, ObjectiveKey, ChallengeKey, TaskKey, PriorityKey } from "./schema";

export interface FunctionDepartment { key: string; name: Bi; color: string; objective: Bi }

export const FUNCTION_DEPARTMENTS: Record<FunctionKey, FunctionDepartment> = {
  sales: { key: "bizdev", name: { en: "Sales & Business Development", ar: "المبيعات وتطوير الأعمال" }, color: "#0d9488", objective: { en: "Build a steady pipeline of qualified opportunities.", ar: "بناء تدفق مستمر من الفرص المؤهلة." } },
  marketing: { key: "marketing", name: { en: "Marketing & Content", ar: "التسويق والمحتوى" }, color: "#ca8a04", objective: { en: "Keep the brand visible with consistent, researched content.", ar: "إبقاء العلامة حاضرة بمحتوى منتظم ومدروس." } },
  delivery: { key: "delivery", name: { en: "Client Delivery", ar: "تنفيذ أعمال العملاء" }, color: "#0284c7", objective: { en: "Deliver client work on time with visible status and quality checks.", ar: "تسليم أعمال العملاء في وقتها مع وضوح الحالة وضبط الجودة." } },
  operations: { key: "operations", name: { en: "Operations & Administration", ar: "العمليات والإدارة" }, color: "#16a34a", objective: { en: "Remove administrative load and keep follow-ups on track.", ar: "تخفيف الأعباء الإدارية وضبط المتابعات." } },
  finance: { key: "finance", name: { en: "Finance", ar: "المالية" }, color: "#b45309", objective: { en: "Accurate financial reporting and timely collections.", ar: "تقارير مالية دقيقة وتحصيل في الوقت المناسب." } },
  hr: { key: "people", name: { en: "People & HR", ar: "الموارد البشرية" }, color: "#be185d", objective: { en: "Support hiring and people administration.", ar: "دعم التوظيف وشؤون الموظفين." } },
  recruitment: { key: "recruitment", name: { en: "Recruitment Services", ar: "خدمات التوظيف" }, color: "#9333ea", objective: { en: "Screen and shortlist candidates for clients faster.", ar: "فرز المرشحين وترشيحهم للعملاء بشكل أسرع." } },
  customer_support: { key: "customer_experience", name: { en: "Customer Experience", ar: "تجربة العملاء" }, color: "#0891b2", objective: { en: "Fast, accurate answers to customer inquiries.", ar: "إجابات سريعة ودقيقة لاستفسارات العملاء." } },
  research: { key: "research", name: { en: "Research & Analysis", ar: "البحث والتحليل" }, color: "#2563eb", objective: { en: "Evidence-based research and reporting for decisions.", ar: "أبحاث وتقارير مبنية على الأدلة لدعم القرار." } },
  proposals: { key: "documents", name: { en: "Proposals & Tenders", ar: "العروض والمناقصات" }, color: "#7c3aed", objective: { en: "Faster, compliant proposals and tender responses.", ar: "عروض وردود مناقصات أسرع ومطابقة للشروط." } },
};

/** Answer references that can trigger a role. Each key is `<group>:<value>`. */
type Trigger =
  | `task:${TaskKey}` | `objective:${ObjectiveKey}` | `challenge:${ChallengeKey}` | `priority:${PriorityKey}`
  | `research:${string}` | `reporting:${string}` | `followup:${string}` | `channel:${string}` | `approval:${string}`;

export interface RoleDef {
  key: string;
  /** Functions the role can sit in, in order of preference. */
  functions: FunctionKey[];
  /** Existing starter agent that already performs this role. */
  reuse?: string;
  /** Built-in agent template the configuration starts from. */
  templateKey?: string;
  persona: { nameEn: string; nameAr: string };
  title: Bi;
  summary: Bi;
  duties: Bi[];
  triggers: Trigger[];
  tools: string[];
  skills: string[];
  /** Highest risk level the role needs: 1 read, 2 prepare, 3 modify, 4 external. */
  risk: 1 | 2 | 3 | 4;
  /** Integration capabilities this role uses when the customer connects them. */
  uses?: Array<"email" | "calendar" | "storage">;
  tier: "fast" | "standard" | "advanced";
  /** Department lead preference: lower = more likely to lead its department. */
  rank: number;
}

const b = (en: string, ar: string): Bi => ({ en, ar });

export const ROLES: RoleDef[] = [
  {
    key: "bd_specialist", functions: ["sales"], reuse: "business_development", templateKey: "business_development_specialist",
    persona: { nameEn: "Raed", nameAr: "رائد" }, title: b("Business Development Specialist", "أخصائي تطوير الأعمال"),
    summary: b("Finds and qualifies prospects and prepares outreach for your team to send.", "يبحث عن العملاء المحتملين ويؤهلهم ويجهّز رسائل التواصل ليرسلها فريقك."),
    duties: [b("Research and qualify prospects from public sources", "البحث عن العملاء المحتملين وتأهيلهم من المصادر العامة"), b("Prepare CRM-ready lead lists", "تجهيز قوائم عملاء جاهزة لنظام إدارة العملاء"), b("Draft outreach and follow-up emails", "صياغة رسائل التواصل والمتابعة")],
    triggers: ["task:lead_research", "research:leads", "followup:leads", "challenge:lead_generation", "objective:grow_revenue", "priority:revenue"],
    tools: ["web_search", "fetch_url", "knowledge_search", "memory_search", "create_spreadsheet", "draft_email", "create_work_item"], skills: ["lead_research", "crm_preparation", "email_drafting"],
    risk: 2, uses: ["email"], tier: "standard", rank: 1,
  },
  {
    key: "proposal_specialist", functions: ["proposals", "sales"], reuse: "documents", templateKey: "proposal_specialist",
    persona: { nameEn: "Bayan", nameAr: "بيان" }, title: b("Proposal & Tender Specialist", "أخصائي العروض والمناقصات"),
    summary: b("Analyses tenders and drafts compliant proposals for your review.", "يحلل المناقصات ويصوغ عروضًا مطابقة للشروط لمراجعتك."),
    duties: [b("Extract scope, dates and mandatory requirements from tenders", "استخراج النطاق والمواعيد والمتطلبات الإلزامية من المناقصات"), b("Build compliance matrices", "إعداد مصفوفات الامتثال"), b("Draft technical and commercial proposals", "صياغة العروض الفنية والمالية")],
    triggers: ["task:proposal_writing", "task:tender_review", "research:tenders", "challenge:slow_proposals", "channel:tenders"],
    tools: ["list_files", "read_file", "knowledge_search", "create_document", "create_spreadsheet"], skills: ["tender_analysis", "document_analysis", "compliance_matrix", "proposal_writing"],
    risk: 2, uses: ["storage"], tier: "advanced", rank: 1,
  },
  {
    key: "research_analyst", functions: ["research", "marketing", "sales"], reuse: "research", templateKey: "research_analyst",
    persona: { nameEn: "Baheth", nameAr: "باحث" }, title: b("Research Analyst", "محلل أبحاث"),
    summary: b("Researches markets, competitors and industry news with cited sources.", "يبحث في الأسواق والمنافسين وأخبار القطاع مع ذكر المصادر."),
    duties: [b("Market and competitor research", "أبحاث السوق والمنافسين"), b("Verify facts across independent sources", "التحقق من المعلومات من مصادر مستقلة"), b("Summarise industry news and regulations", "تلخيص أخبار القطاع والأنظمة")],
    triggers: ["task:market_research", "research:market", "research:competitors", "research:industry_news", "challenge:scattered_info"],
    tools: ["web_search", "fetch_url", "knowledge_search", "memory_search", "create_document"], skills: ["web_research", "source_verification", "competitor_analysis", "knowledge_retrieval"],
    risk: 2, uses: ["storage"], tier: "standard", rank: 1,
  },
  {
    key: "data_analyst", functions: ["research", "operations", "finance"], reuse: "analytics", templateKey: "data_analyst",
    persona: { nameEn: "Basira", nameAr: "بصيرة" }, title: b("Reporting & Data Analyst", "محللة التقارير والبيانات"),
    summary: b("Turns your spreadsheets into exact KPI reports and management summaries.", "تحوّل جداولك إلى تقارير مؤشرات أداء دقيقة وملخصات للإدارة."),
    duties: [b("Compute KPIs from spreadsheets (no estimates)", "حساب مؤشرات الأداء من الجداول دون تقدير"), b("Prepare weekly and monthly reports", "إعداد التقارير الأسبوعية والشهرية"), b("Explain trends and drivers", "شرح الاتجاهات ومسبباتها")],
    triggers: ["task:weekly_reporting", "task:data_entry", "reporting:kpi", "reporting:management", "challenge:manual_reporting", "challenge:no_visibility", "objective:better_reporting", "priority:reporting"],
    tools: ["list_files", "read_file", "analyze_spreadsheet", "knowledge_search", "create_spreadsheet", "create_document"], skills: ["data_analysis", "kpi_reporting", "forecasting"],
    risk: 2, tier: "advanced", rank: 2,
  },
  {
    key: "marketing_strategist", functions: ["marketing"], reuse: "marketing", templateKey: "marketing_strategist",
    persona: { nameEn: "Athar", nameAr: "أثر" }, title: b("Marketing Strategist", "استراتيجي التسويق"),
    summary: b("Plans positioning and campaigns based on market research.", "يخطط للتموضع والحملات بناءً على أبحاث السوق."),
    duties: [b("Positioning and messaging per segment", "التموضع والرسائل لكل شريحة"), b("Campaign and content planning", "تخطيط الحملات والمحتوى"), b("Track competitors' marketing moves", "متابعة تحركات المنافسين التسويقية")],
    triggers: ["objective:brand_awareness", "research:market", "research:competitors", "task:market_research"],
    tools: ["web_search", "fetch_url", "knowledge_search", "memory_search", "create_document"], skills: ["market_research", "positioning_strategy", "competitor_analysis"],
    risk: 2, tier: "standard", rank: 1,
  },
  {
    key: "content_writer", functions: ["marketing", "sales"], reuse: "writing", templateKey: "content_writer",
    persona: { nameEn: "Qalam", nameAr: "قلم" }, title: b("Content Writer", "كاتب المحتوى"),
    summary: b("Writes Arabic and English content and documents in your voice.", "يكتب المحتوى والمستندات بالعربية والإنجليزية بأسلوبكم."),
    duties: [b("Social media and website content drafts", "مسودات محتوى التواصل والموقع"), b("Arabic and English business writing", "الكتابة المهنية بالعربية والإنجليزية"), b("Keep a consistent content calendar", "الحفاظ على تقويم محتوى منتظم")],
    triggers: ["task:social_content", "challenge:content_consistency", "objective:brand_awareness"],
    tools: ["knowledge_search", "memory_search", "create_document", "draft_email"], skills: ["business_writing", "arabic_writing", "email_drafting"],
    risk: 2, tier: "standard", rank: 2,
  },
  {
    key: "project_manager", functions: ["delivery", "operations"], templateKey: "project_manager",
    persona: { nameEn: "Khalid", nameAr: "خالد" }, title: b("Delivery Project Manager", "مدير مشاريع التنفيذ"),
    summary: b("Tracks client work, owners and deadlines, and prepares progress reports.", "يتابع أعمال العملاء والمسؤولين والمواعيد ويجهّز تقارير التقدم."),
    duties: [b("Break client work into owned, dated tasks", "تقسيم أعمال العملاء إلى مهام بمسؤولين ومواعيد"), b("Track status and flag risks", "متابعة الحالة والتنبيه للمخاطر"), b("Draft client progress reports", "صياغة تقارير التقدم للعملاء")],
    triggers: ["task:project_tracking", "task:client_reporting", "challenge:slow_handoffs", "challenge:no_visibility", "objective:faster_delivery", "priority:delivery_speed", "reporting:client"],
    tools: ["list_work_items", "create_work_item", "update_work_item", "create_document", "knowledge_search"], skills: ["task_coordination", "scheduling"],
    risk: 3, uses: ["calendar"], tier: "fast", rank: 1,
  },
  {
    key: "quality_reviewer", functions: ["delivery", "proposals", "operations"], templateKey: "quality_assurance_specialist",
    persona: { nameEn: "Huda", nameAr: "هدى" }, title: b("Quality Reviewer", "مراجعة الجودة"),
    summary: b("Reviews deliverables against the brief before a person sends them.", "تراجع المخرجات مقابل المتطلبات قبل أن يرسلها أحد من فريقك."),
    duties: [b("Check deliverables against requirements", "مطابقة المخرجات مع المتطلبات"), b("Verify facts and numbers", "التحقق من المعلومات والأرقام"), b("List defects with concrete fixes", "حصر الملاحظات مع حلول محددة")],
    triggers: ["approval:client_documents", "task:document_review"],
    tools: ["knowledge_search", "read_file", "list_files", "create_document"], skills: ["quality_review", "document_analysis"],
    risk: 2, tier: "standard", rank: 3,
  },
  {
    key: "operations_coordinator", functions: ["operations", "delivery"], reuse: "operations", templateKey: "operations_manager",
    persona: { nameEn: "Tamim", nameAr: "تميم" }, title: b("Operations Coordinator", "منسّق العمليات"),
    summary: b("Keeps internal follow-ups, checklists and work items on track.", "يضبط المتابعات الداخلية وقوائم المهام وبنود العمل."),
    duties: [b("Turn requests into tracked work items", "تحويل الطلبات إلى بنود عمل متابَعة"), b("Chase overdue internal tasks", "متابعة المهام الداخلية المتأخرة"), b("Maintain operating checklists", "تحديث قوائم الإجراءات التشغيلية")],
    triggers: ["followup:internal", "challenge:follow_up", "challenge:small_team", "objective:reduce_admin", "priority:workload", "priority:productivity"],
    tools: ["list_work_items", "create_work_item", "update_work_item", "create_document", "knowledge_search"], skills: ["task_coordination"],
    risk: 3, uses: ["calendar"], tier: "fast", rank: 1,
  },
  {
    key: "executive_assistant", functions: ["operations"], templateKey: "executive_assistant",
    persona: { nameEn: "Lina", nameAr: "لينا" }, title: b("Executive Assistant", "المساعدة التنفيذية"),
    summary: b("Prepares briefings, meeting notes, schedules and follow-up drafts.", "تجهّز الإحاطات ومحاضر الاجتماعات والجداول ومسودات المتابعة."),
    duties: [b("Meeting agendas, notes and action items", "جداول أعمال الاجتماعات والمحاضر والمهام"), b("Propose meeting times from calendars", "اقتراح مواعيد الاجتماعات من التقويم"), b("Draft follow-up emails", "صياغة رسائل المتابعة")],
    triggers: ["task:scheduling", "task:meeting_notes", "task:email_followup", "followup:clients", "reporting:management"],
    tools: ["knowledge_search", "memory_search", "create_document", "draft_email", "create_work_item"], skills: ["executive_support", "email_drafting", "scheduling"],
    risk: 2, uses: ["email", "calendar"], tier: "fast", rank: 2,
  },
  {
    key: "financial_analyst", functions: ["finance"], templateKey: "financial_analyst",
    persona: { nameEn: "Majed", nameAr: "ماجد" }, title: b("Financial Analyst", "المحلل المالي"),
    summary: b("Prepares financial reports, budgets and margin analysis from your figures.", "يجهّز التقارير المالية والموازنات وتحليل الهوامش من أرقامكم."),
    duties: [b("Monthly financial summaries", "ملخصات مالية شهرية"), b("Budget vs actual analysis", "تحليل الموازنة مقابل الفعلي"), b("Margin and cash-flow insights", "مؤشرات الهوامش والتدفق النقدي")],
    triggers: ["reporting:financial"],
    tools: ["list_files", "read_file", "analyze_spreadsheet", "create_spreadsheet", "create_document"], skills: ["financial_analysis", "data_analysis", "forecasting"],
    risk: 2, tier: "advanced", rank: 1,
  },
  {
    key: "collections_coordinator", functions: ["finance"],
    persona: { nameEn: "Sara", nameAr: "سارة" }, title: b("Collections Coordinator", "منسّقة التحصيل"),
    summary: b("Tracks unpaid invoices and drafts polite payment reminders for approval.", "تتابع الفواتير غير المسددة وتصوغ تذكيرات دفع لبقة للموافقة."),
    duties: [b("Maintain an overdue-invoice list from your files", "تحديث قائمة الفواتير المتأخرة من ملفاتكم"), b("Draft payment reminders", "صياغة تذكيرات السداد"), b("Flag accounts that need a call", "تحديد الحسابات التي تحتاج اتصالًا")],
    triggers: ["task:invoice_followup", "followup:payments"],
    tools: ["list_files", "read_file", "analyze_spreadsheet", "create_spreadsheet", "draft_email", "create_work_item"], skills: ["data_analysis", "email_drafting"],
    risk: 2, uses: ["email"], tier: "fast", rank: 2,
  },
  {
    key: "hr_coordinator", functions: ["hr"],
    persona: { nameEn: "Noura", nameAr: "نورة" }, title: b("HR Coordinator", "منسّقة الموارد البشرية"),
    summary: b("Drafts job descriptions, onboarding documents and HR policies.", "تصوغ الأوصاف الوظيفية ووثائق الانضمام وسياسات الموارد البشرية."),
    duties: [b("Job descriptions and interview guides", "الأوصاف الوظيفية وأدلة المقابلات"), b("Onboarding checklists", "قوائم انضمام الموظفين الجدد"), b("HR policy drafts", "مسودات سياسات الموارد البشرية")],
    triggers: ["objective:hire_faster", "followup:candidates"],
    tools: ["knowledge_search", "memory_search", "create_document", "create_work_item"], skills: ["business_writing", "task_coordination"],
    risk: 2, tier: "standard", rank: 1,
  },
  {
    key: "recruiter", functions: ["recruitment", "hr"],
    persona: { nameEn: "Faisal", nameAr: "فيصل" }, title: b("Recruitment Specialist", "أخصائي التوظيف"),
    summary: b("Screens CVs against role requirements and prepares shortlists for your decision.", "يفرز السير الذاتية مقابل متطلبات الوظيفة ويجهّز قوائم مختصرة لقرارك."),
    duties: [b("Screen CVs against criteria", "فرز السير الذاتية حسب المعايير"), b("Prepare candidate shortlists with reasons", "إعداد قوائم مرشحين مختصرة مع الأسباب"), b("Draft candidate communications", "صياغة المراسلات مع المرشحين")],
    triggers: ["task:candidate_screening", "followup:candidates", "objective:hire_faster"],
    tools: ["list_files", "read_file", "knowledge_search", "create_spreadsheet", "create_document", "draft_email"], skills: ["document_analysis", "email_drafting"],
    risk: 2, uses: ["email"], tier: "standard", rank: 1,
  },
  {
    key: "support_specialist", functions: ["customer_support"], templateKey: "customer_support_specialist",
    persona: { nameEn: "Salma", nameAr: "سلمى" }, title: b("Customer Support Specialist", "أخصائية دعم العملاء"),
    summary: b("Drafts accurate answers to customer inquiries from your knowledge base.", "تصوغ إجابات دقيقة لاستفسارات العملاء من قاعدة معرفتكم."),
    duties: [b("Answer inquiries from approved knowledge", "الرد على الاستفسارات من المعرفة المعتمدة"), b("Escalate when unsure", "التصعيد عند عدم التأكد"), b("Keep an FAQ up to date", "تحديث الأسئلة الشائعة")],
    triggers: ["task:customer_inquiries", "challenge:support_volume", "objective:customer_experience", "priority:customer_experience"],
    tools: ["knowledge_search", "memory_search", "draft_email", "create_document"], skills: ["customer_support", "email_drafting"],
    risk: 2, uses: ["email"], tier: "fast", rank: 1,
  },
];

export const ROLE_BY_KEY = new Map(ROLES.map((r) => [r.key, r]));

export interface WorkflowDef {
  key: string;
  name: Bi;
  description: Bi;
  roles: string[];
  triggers: Trigger[];
  approvals: Bi[];
  /** Instruction sent to the AI Workspace when the customer runs it. {company} is replaced. */
  prompt: Bi;
}

export const WORKFLOWS: WorkflowDef[] = [
  { key: "weekly_kpi_report", name: b("Weekly KPI report", "تقرير مؤشرات الأداء الأسبوعي"), roles: ["data_analyst"], triggers: ["task:weekly_reporting", "reporting:kpi"],
    description: b("Analyse the latest KPI spreadsheet and produce a weekly report with changes and drivers.", "تحليل أحدث جدول لمؤشرات الأداء وإعداد تقرير أسبوعي بالتغيرات ومسبباتها."), approvals: [],
    prompt: b("Analyse our latest KPI spreadsheet and prepare this week's KPI report for {company}: changes vs last period, drivers and recommended actions.", "حلّل أحدث جدول مؤشرات أداء لدينا وأعدّ تقرير مؤشرات الأداء لهذا الأسبوع لشركة {company}: التغيرات مقارنة بالفترة السابقة، والمسببات، والإجراءات المقترحة.") },
  { key: "lead_pipeline", name: b("Lead pipeline build", "بناء قائمة العملاء المحتملين"), roles: ["research_analyst", "bd_specialist"], triggers: ["task:lead_research", "research:leads"],
    description: b("Research target companies, qualify them and deliver a CRM-ready lead list.", "البحث عن الشركات المستهدفة وتأهيلها وتسليم قائمة جاهزة لنظام العملاء."), approvals: [b("Outreach emails are drafts — a person sends them", "رسائل التواصل مسودات يرسلها شخص من فريقك")],
    prompt: b("Research and qualify 15 prospective clients for {company} that match our target customers, and deliver a CRM-ready lead list with fit scores.", "ابحث عن ١٥ عميلًا محتملًا مناسبًا لشركة {company} وفق عملائنا المستهدفين، وأهّلهم، وسلّم قائمة جاهزة لنظام إدارة العملاء مع درجة الملاءمة.") },
  { key: "tender_response", name: b("Tender response", "الرد على مناقصة"), roles: ["proposal_specialist"], triggers: ["task:tender_review", "research:tenders", "channel:tenders"],
    description: b("Analyse an uploaded tender, build the compliance matrix and draft the proposal.", "تحليل كراسة شروط مرفوعة وإعداد مصفوفة الامتثال وصياغة العرض."), approvals: [b("Final pricing stays with your team", "التسعير النهائي يبقى لدى فريقك")],
    prompt: b("Analyse the tender document I uploaded, build a compliance matrix and draft {company}'s technical proposal.", "حلّل كراسة الشروط التي رفعتها، وأعدّ مصفوفة الامتثال، وصُغ العرض الفني لشركة {company}.") },
  { key: "client_progress_report", name: b("Client progress report", "تقرير تقدم العميل"), roles: ["project_manager", "quality_reviewer"], triggers: ["task:client_reporting", "reporting:client"],
    description: b("Summarise project status into a client report, reviewed for quality before sending.", "تلخيص حالة المشروع في تقرير للعميل مع مراجعة الجودة قبل الإرسال."), approvals: [b("A person sends the report to the client", "يرسل شخص من فريقك التقرير للعميل")],
    prompt: b("Prepare a client progress report from our open work items for {company}'s current projects, then review it for accuracy.", "أعدّ تقرير تقدم للعميل من بنود العمل المفتوحة لمشاريع {company} الحالية، ثم راجعه للتأكد من دقته.") },
  { key: "meeting_actions", name: b("Meeting notes → action items", "محضر الاجتماع ← المهام"), roles: ["executive_assistant"], triggers: ["task:meeting_notes"],
    description: b("Turn meeting notes into a summary and owned work items.", "تحويل ملاحظات الاجتماع إلى ملخص وبنود عمل بمسؤولين."), approvals: [],
    prompt: b("Turn these meeting notes into a short summary and create work items with owners and due dates: ", "حوّل ملاحظات الاجتماع التالية إلى ملخص قصير وأنشئ بنود عمل بمسؤولين ومواعيد: ") },
  { key: "content_calendar", name: b("Monthly content calendar", "تقويم المحتوى الشهري"), roles: ["content_writer"], triggers: ["task:social_content", "challenge:content_consistency"],
    description: b("Plan a month of posts and draft the first week.", "تخطيط منشورات شهر كامل وصياغة منشورات الأسبوع الأول."), approvals: [b("Nothing is published automatically", "لا يُنشر أي شيء تلقائيًا")],
    prompt: b("Plan next month's social media content calendar for {company} and draft the first week's posts.", "خطط تقويم محتوى التواصل الاجتماعي للشهر القادم لشركة {company} وصُغ منشورات الأسبوع الأول.") },
  { key: "invoice_followup", name: b("Invoice follow-up", "متابعة الفواتير"), roles: ["collections_coordinator"], triggers: ["task:invoice_followup", "followup:payments"],
    description: b("List overdue invoices from your file and draft reminders.", "حصر الفواتير المتأخرة من ملفكم وصياغة التذكيرات."), approvals: [b("Reminders are drafts until approved", "التذكيرات مسودات حتى الموافقة")],
    prompt: b("From our invoices spreadsheet, list overdue invoices for {company} and draft a polite reminder for each client.", "من جدول الفواتير لدينا، استخرج الفواتير المتأخرة لشركة {company} وصُغ تذكيرًا لبقًا لكل عميل.") },
  { key: "candidate_shortlist", name: b("Candidate shortlist", "القائمة المختصرة للمرشحين"), roles: ["recruiter"], triggers: ["task:candidate_screening"],
    description: b("Screen uploaded CVs against a role and produce a ranked shortlist.", "فرز السير الذاتية المرفوعة مقابل الوظيفة وإعداد قائمة مختصرة مرتبة."), approvals: [b("Hiring decisions stay with your team", "قرارات التوظيف تبقى لدى فريقك")],
    prompt: b("Screen the CVs I uploaded against the role requirements and prepare a ranked shortlist with reasons.", "افرز السير الذاتية التي رفعتها مقابل متطلبات الوظيفة وأعدّ قائمة مختصرة مرتبة مع الأسباب.") },
  { key: "competitor_watch", name: b("Competitor watch", "رصد المنافسين"), roles: ["research_analyst"], triggers: ["research:competitors"],
    description: b("Profile key competitors and summarise their recent moves.", "إعداد ملفات للمنافسين الرئيسيين وتلخيص تحركاتهم الأخيرة."), approvals: [],
    prompt: b("Profile {company}'s main competitors and summarise their recent moves with sources.", "أعدّ ملفات تعريفية لأبرز منافسي {company} ولخّص تحركاتهم الأخيرة مع المصادر.") },
  { key: "support_answers", name: b("Customer answer drafts", "مسودات الرد على العملاء"), roles: ["support_specialist"], triggers: ["task:customer_inquiries"],
    description: b("Draft answers to customer questions from your knowledge base.", "صياغة إجابات على أسئلة العملاء من قاعدة المعرفة."), approvals: [b("Replies are drafts until a person sends them", "الردود مسودات حتى يرسلها شخص")],
    prompt: b("Draft answers to these customer questions using only our knowledge base, and flag anything you are not sure about: ", "صُغ إجابات لأسئلة العملاء التالية من قاعدة معرفتنا فقط، وحدد ما لست متأكدًا منه: ") },
];
