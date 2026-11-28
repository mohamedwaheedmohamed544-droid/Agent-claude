/**
 * Onboarding Intelligence Engine (Blueprint §5.3–5.5).
 *
 * Pure and deterministic: the same answers always produce the same Company Operating Profile and
 * Workforce Blueprint. Every recommendation carries `basis` (the customer answers it rests on) and an
 * `origin`:
 *   provided            — stated by the customer
 *   inferred            — derived by a documented rule from what the customer stated
 *   needs_confirmation  — an inference the customer must confirm before it is acted on
 *   customer_edit       — changed by the customer during review
 * The engine never invents departments, systems or business facts: a department exists only if the
 * customer runs (or says they need) that function AND their answers create demand for it.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../security/crypto";
import { getTool } from "../tools/registry";
import { BUILTIN_SKILLS } from "../agents/catalog";
import {
  APPROVAL_AREAS, CHALLENGES, COUNTRIES, FOLLOWUPS, FUNCTIONS, HUMAN_ONLY, INDUSTRIES, LANGUAGES, OBJECTIVES, PRIORITIES,
  REPORTING_NEEDS, RESEARCH_NEEDS, REVENUE_CHANNELS, SENSITIVE_DATA, SIZES, SYSTEM_CATEGORIES, TASKS, BUSINESS_TYPES,
  relevantFunctions, type Answers, type Bi, type FunctionKey, type Option, type SystemCategory,
} from "./schema";
import { FUNCTION_DEPARTMENTS, ROLES, ROLE_BY_KEY, WORKFLOWS, type RoleDef } from "./catalog";
import type {
  Basis, BlueprintAgent, BlueprintApproval, BlueprintDepartment, BlueprintEdit, BlueprintIntegration, BlueprintWorkflow,
  Fact, OperatingProfile, Origin, WorkforceBlueprint,
} from "./types";

export const ENGINE_VERSION = "rules-1";

const bi = (en: string, ar: string): Bi => ({ en, ar });
const lbl = (list: readonly Option[], key: string): Bi => list.find((x) => x.key === key)?.label ?? { en: key, ar: key };

// ───────────────────────── Basis references ─────────────────────────

const GROUPS: Record<string, { path: string; list: readonly Option[]; prefix: Bi }> = {
  task: { path: "work.repetitiveTasks", list: TASKS, prefix: bi("Repetitive task", "مهمة متكررة") },
  slow: { path: "work.timeConsumingTasks", list: TASKS, prefix: bi("Time-consuming task", "مهمة تستهلك الوقت") },
  objective: { path: "business.objectives", list: OBJECTIVES, prefix: bi("Objective", "هدف") },
  challenge: { path: "business.challenges", list: CHALLENGES, prefix: bi("Challenge", "تحدٍّ") },
  priority: { path: "priorities.ranked", list: PRIORITIES, prefix: bi("Priority", "أولوية") },
  research: { path: "work.researchNeeds", list: RESEARCH_NEEDS, prefix: bi("Research need", "احتياج بحثي") },
  reporting: { path: "work.reportingNeeds", list: REPORTING_NEEDS, prefix: bi("Reporting need", "احتياج للتقارير") },
  followup: { path: "work.followUps", list: FOLLOWUPS, prefix: bi("Follow-up", "متابعة") },
  channel: { path: "business.revenueChannels", list: REVENUE_CHANNELS, prefix: bi("Revenue channel", "قناة إيراد") },
  approval: { path: "work.approvalAreas", list: APPROVAL_AREAS, prefix: bi("Needs approval", "يتطلب موافقة") },
  humanOnly: { path: "work.humanOnly", list: HUMAN_ONLY, prefix: bi("Human-only", "للبشر فقط") },
  sensitive: { path: "work.sensitiveData", list: SENSITIVE_DATA, prefix: bi("Sensitive data", "بيانات حساسة") },
  function: { path: "structure.functions", list: FUNCTIONS, prefix: bi("Team", "فريق") },
};

function basis(group: keyof typeof GROUPS, key: string, suffix?: Bi): Basis {
  const g = GROUPS[group];
  const l = lbl(g.list, key);
  return { ref: `${g.path}:${key}`, label: { en: `${g.prefix.en}: ${l.en}${suffix ? ` — ${suffix.en}` : ""}`, ar: `${g.prefix.ar}: ${l.ar}${suffix ? ` — ${suffix.ar}` : ""}` } };
}

const STATUS_TEXT: Record<string, Bi> = {
  internal: bi("you have a team", "لديكم فريق"), missing: bi("you need it but don't have it", "تحتاجونها وليست لديكم"),
  outsourced: bi("outsourced", "مُسندة لجهة خارجية"), not_needed: bi("not relevant", "غير مطلوبة"),
};

/** Which answers support a trigger like "task:lead_research". Returns [] when the customer did not state it. */
function triggerBasis(a: Answers, trigger: string): Basis[] {
  const [group, key] = trigger.split(":") as [string, string];
  const out: Basis[] = [];
  if (group === "task") {
    if (a.work.repetitiveTasks.includes(key as never)) out.push(basis("task", key));
    if (a.work.timeConsumingTasks.includes(key as never)) out.push(basis("slow", key));
  } else if (group === "objective" && a.business.objectives.includes(key as never)) out.push(basis("objective", key));
  else if (group === "challenge" && a.business.challenges.includes(key as never)) out.push(basis("challenge", key));
  else if (group === "priority" && a.priorities.ranked.includes(key as never)) out.push(basis("priority", key, bi(`#${a.priorities.ranked.indexOf(key as never) + 1}`, `#${a.priorities.ranked.indexOf(key as never) + 1}`)));
  else if (group === "research" && a.work.researchNeeds.includes(key as never)) out.push(basis("research", key));
  else if (group === "reporting" && a.work.reportingNeeds.includes(key as never)) out.push(basis("reporting", key));
  else if (group === "followup" && a.work.followUps.includes(key as never)) out.push(basis("followup", key));
  else if (group === "channel" && a.business.revenueChannels.includes(key as never)) out.push(basis("channel", key));
  else if (group === "approval" && a.work.approvalAreas.includes(key as never)) out.push(basis("approval", key));
  return out;
}

// ───────────────────────── Operating profile ─────────────────────────

const CLASSIFICATION: Record<string, "confidential" | "restricted"> = {
  customer_personal: "confidential", financial: "confidential", employee: "confidential", contracts: "confidential",
  candidate: "confidential", government_ids: "restricted", health: "restricted",
};

export function buildOperatingProfile(a: Answers): OperatingProfile {
  const id = a.identity;
  const facts: Fact[] = [];
  const fact = (key: string, statement: Bi, origin: Origin, b: Basis[] = []) => facts.push({ key, statement, origin, basis: b });
  const relevant = relevantFunctions(a);
  const functions = relevant.map((k) => {
    const f = a.structure.functions[k] ?? { status: "not_needed" as const, teamSize: null, notes: "" };
    return { key: k, label: lbl(FUNCTIONS, k), status: f.status, teamSize: f.teamSize, notes: f.notes };
  });

  fact("company", bi(`${id.companyName} — ${lbl(INDUSTRIES, id.industry).en}${id.subIndustry ? ` (${id.subIndustry})` : ""}, ${lbl(COUNTRIES, id.country).en}`,
    `${id.companyName} — ${lbl(INDUSTRIES, id.industry).ar}${id.subIndustry ? ` (${id.subIndustry})` : ""}، ${lbl(COUNTRIES, id.country).ar}`), "provided");
  fact("size", bi(`${lbl(SIZES, id.size).en}; ${lbl(BUSINESS_TYPES, id.businessType).en}`, `${lbl(SIZES, id.size).ar}؛ ${lbl(BUSINESS_TYPES, id.businessType).ar}`), "provided");
  fact("language", bi(`Work language: ${lbl(LANGUAGES, id.language).en}`, `لغة العمل: ${lbl(LANGUAGES, id.language).ar}`), "provided");
  fact("offerings", bi(`Offers: ${a.business.offerings.join(", ")}`, `الخدمات والمنتجات: ${a.business.offerings.join("، ")}`), "provided");
  fact("customers", bi(`Target customers: ${a.business.targetCustomers}`, `العملاء المستهدفون: ${a.business.targetCustomers}`), "provided");
  if (id.website) fact("website", bi(`Website: ${id.website} (recorded, not visited)`, `الموقع: ${id.website} (مسجّل ولم تتم زيارته)`), "provided");

  const missing = functions.filter((f) => f.status === "missing").map((f) => f.key);
  const outsourced = functions.filter((f) => f.status === "outsourced").map((f) => f.key);
  if (missing.length) fact("gaps", bi(`Functions you need but don't have: ${missing.map((k) => lbl(FUNCTIONS, k).en).join(", ")}`, `وظائف تحتاجونها وليست لديكم: ${missing.map((k) => lbl(FUNCTIONS, k).ar).join("، ")}`), "provided", missing.map((k) => basis("function", k, STATUS_TEXT.missing)));
  if (outsourced.length) fact("outsourced", bi(`Outsourced: ${outsourced.map((k) => lbl(FUNCTIONS, k).en).join(", ")}`, `مُسندة لجهات خارجية: ${outsourced.map((k) => lbl(FUNCTIONS, k).ar).join("، ")}`), "provided", outsourced.map((k) => basis("function", k, STATUS_TEXT.outsourced)));

  if (id.size === "1-9") fact("lean", bi("Small team: the workforce is kept lean, and agents prepare work for people to decide on.", "فريق صغير: تبقى القوى العاملة الرقمية محدودة، ويجهّز الوكلاء العمل ليقرر فيه الأشخاص."), "inferred", [{ ref: "identity.size:1-9", label: bi("Company size: 1–9 employees", "حجم الشركة: ١–٩ موظفين") }]);
  if (id.businessType === "b2g" && !a.business.revenueChannels.includes("tenders")) {
    fact("b2g_tenders", bi("Government clients usually buy through tenders — please confirm whether you bid for tenders.", "الجهات الحكومية تشتري عادة عبر المناقصات — يرجى تأكيد ما إذا كنتم تشاركون في المناقصات."), "needs_confirmation",
      [{ ref: "identity.businessType:b2g", label: bi("Business type: B2G", "نوع العمل: جهات حكومية") }]);
  }
  const classifications = a.work.sensitiveData.map((k) => ({ key: k, label: lbl(SENSITIVE_DATA, k), level: CLASSIFICATION[k] ?? "confidential" }));
  if (classifications.some((c) => c.level === "restricted")) {
    fact("restricted", bi("You handle Restricted data (IDs or health information). It must never be stored in agent memory.", "تتعاملون مع بيانات مقيّدة (هويات أو معلومات صحية) ويجب ألا تُحفظ في ذاكرة الوكلاء."), "inferred",
      a.work.sensitiveData.filter((k) => CLASSIFICATION[k] === "restricted").map((k) => basis("sensitive", k)));
  }

  return {
    engine: ENGINE_VERSION,
    company: { name: id.companyName, country: id.country, locations: id.locations, industry: id.industry, subIndustry: id.subIndustry, website: id.website, size: id.size, businessType: id.businessType, language: id.language },
    model: { offerings: a.business.offerings, targetCustomers: a.business.targetCustomers, revenueChannels: a.business.revenueChannels, objectives: a.business.objectives, challenges: a.business.challenges },
    functions,
    demand: { repetitiveTasks: a.work.repetitiveTasks, timeConsumingTasks: a.work.timeConsumingTasks, researchNeeds: a.work.researchNeeds, reportingNeeds: a.work.reportingNeeds, followUps: a.work.followUps },
    governance: { approvalAreas: a.work.approvalAreas, humanOnly: a.work.humanOnly, otherHumanOnly: a.work.otherHumanOnly, sensitiveData: a.work.sensitiveData, classifications },
    systems: (Object.entries(a.systems) as Array<[SystemCategory, { tools: string[]; other: string; none: boolean } | undefined]>)
      .filter(([, v]) => v).map(([category, v]) => ({ category, tools: v!.tools, other: v!.other, none: v!.none })),
    priorities: a.priorities.ranked,
    freeText: { challenges: a.business.otherChallenges, humanOnly: a.work.otherHumanOnly },
    facts,
  };
}

// ───────────────────────── Blueprint generation ─────────────────────────

const STRONG = new Set(["task", "objective", "challenge", "research", "reporting", "followup", "channel", "approval"]);

function dedupe(b: Basis[]): Basis[] {
  const seen = new Set<string>();
  return b.filter((x) => (seen.has(x.ref) ? false : (seen.add(x.ref), true)));
}

function roleAgent(role: RoleDef, key: string, dept: FunctionKey, b: Basis[], origin: Origin): BlueprintAgent {
  return {
    key, roleKey: role.key, departmentKey: FUNCTION_DEPARTMENTS[dept].key, function: dept,
    nameEn: role.persona.nameEn, nameAr: role.persona.nameAr, title: role.title, summary: role.summary, duties: role.duties, customDuties: null,
    reuse: role.reuse ?? null, templateKey: role.templateKey ?? null, tier: role.tier,
    roleRisk: role.risk, riskCap: null, maxRiskLevel: Math.min(role.risk, 3) as 1 | 2 | 3, alwaysApproveModify: true,
    tools: [], skills: [], integrations: [], boundaries: [], supervisorKey: "orchestrator", collaboratesWith: [], delegatesTo: [],
    why: bi("", ""), basis: dedupe(b), origin,
  };
}

/** Builds the first proposal from a complete set of answers. */
export function generateBlueprint(a: Answers): WorkforceBlueprint {
  const profile = buildOperatingProfile(a);
  const statusOf = new Map(profile.functions.map((f) => [f.key, f.status]));
  const staffable = (f: FunctionKey) => ["internal", "missing"].includes(statusOf.get(f) ?? "");

  const agents: BlueprintAgent[] = [];
  const openQuestions: WorkforceBlueprint["openQuestions"] = [];
  const unplaced: RoleDef[] = [];

  for (const role of ROLES) {
    const strong = role.triggers.filter((t) => STRONG.has(t.split(":")[0])).flatMap((t) => triggerBasis(a, t));
    if (!strong.length) continue;
    const weak = role.triggers.filter((t) => t.startsWith("priority:")).flatMap((t) => triggerBasis(a, t));
    const fn = role.functions.find(staffable);
    if (!fn) { unplaced.push(role); continue; }
    const st = statusOf.get(fn)!;
    agents.push(roleAgent(role, role.key, fn, [...strong, ...weak, basis("function", fn, STATUS_TEXT[st])], "provided"));
  }

  // A function the customer needs but lacks gets its primary role even without task-level demand.
  for (const f of profile.functions.filter((x) => x.status === "missing")) {
    if (agents.some((ag) => ag.function === f.key)) continue;
    const role = ROLES.find((r) => r.functions[0] === f.key);
    if (!role) continue;
    agents.push(roleAgent(role, role.key, f.key, [basis("function", f.key, STATUS_TEXT.missing)], "provided"));
  }

  for (const role of unplaced) {
    const where = role.functions.map((f) => lbl(FUNCTIONS, f));
    const st = role.functions.map((f) => statusOf.get(f)).find(Boolean);
    openQuestions.push({
      key: `unplaced_${role.key}`, origin: "needs_confirmation",
      text: bi(`Your answers point to a ${role.title.en}, but ${where.map((w) => w.en).join(" / ")} is ${st ? STATUS_TEXT[st].en : "not part of your teams"}. Add one if you want this work covered.`,
        `تشير إجاباتكم إلى الحاجة لـ${role.title.ar}، لكن ${where.map((w) => w.ar).join(" / ")} ${st ? STATUS_TEXT[st].ar : "ليست ضمن فرقكم"}. أضيفوه إن رغبتم في تغطية هذا العمل.`),
    });
  }
  for (const f of profile.functions.filter((x) => x.status === "internal")) {
    if (agents.some((ag) => ag.function === f.key)) continue;
    openQuestions.push({ key: `no_demand_${f.key}`, origin: "inferred",
      text: bi(`No agent was added to ${f.label.en}: none of your selected tasks or needs call for it. You can add one during review.`, `لم يُضف وكيل إلى ${f.label.ar}: لا تتطلبه أي من المهام أو الاحتياجات التي اخترتموها. يمكنكم إضافة وكيل أثناء المراجعة.`) });
  }
  for (const f of profile.functions.filter((x) => x.status === "outsourced")) {
    openQuestions.push({ key: `outsourced_${f.key}`, origin: "inferred",
      text: bi(`${f.label.en} is outsourced, so no agents were created for it.`, `${f.label.ar} مُسندة لجهة خارجية، لذلك لم يُنشأ لها وكلاء.`) });
  }

  // Departments: only for functions that received agents.
  const departments: BlueprintDepartment[] = [];
  for (const fn of [...new Set(agents.map((x) => x.function))]) {
    const d = FUNCTION_DEPARTMENTS[fn];
    const st = statusOf.get(fn)!;
    departments.push({ key: d.key, function: fn, name: d.name, color: d.color, objective: d.objective, isNew: st === "missing",
      why: st === "missing"
        ? bi(`You told us you need ${lbl(FUNCTIONS, fn).en} but don't have it; this department fills that gap.`, `ذكرتم أنكم تحتاجون ${lbl(FUNCTIONS, fn).ar} وليست لديكم؛ هذا القسم يسد هذه الفجوة.`)
        : bi(`Your ${lbl(FUNCTIONS, fn).en} team has work that agents can prepare (see each agent).`, `لدى فريق ${lbl(FUNCTIONS, fn).ar} أعمال يمكن للوكلاء تجهيزها (انظر كل وكيل).`),
      basis: [basis("function", fn, STATUS_TEXT[st])], origin: "provided" });
  }

  // Integrations from the systems the customer actually named.
  const integrations: BlueprintIntegration[] = [];
  const nativeCaps = new Map<"google" | "microsoft", { caps: Set<"email" | "calendar" | "storage">; basis: Basis[] }>();
  for (const s of profile.systems) {
    if (s.none) continue;
    const cat = SYSTEM_CATEGORIES[s.category];
    for (const tool of s.tools) {
      const opt = cat.options.find((x) => x.key === tool) as { key: string; label: Bi; native?: "google" | "microsoft" } | undefined;
      if (!opt) continue;
      const b: Basis = { ref: `systems.${s.category}:${tool}`, label: { en: `${cat.label.en}: ${opt.label.en}`, ar: `${cat.label.ar}: ${opt.label.ar}` } };
      const cap = s.category === "email" ? "email" : s.category === "calendar" ? "calendar" : s.category === "storage" ? "storage" : null;
      if (opt.native && cap && !(cap === "storage" && opt.native !== "google")) {
        const entry = nativeCaps.get(opt.native) ?? { caps: new Set(), basis: [] };
        entry.caps.add(cap);
        entry.basis.push(b);
        nativeCaps.set(opt.native, entry);
      } else if (!integrations.some((i) => i.key === tool)) {
        integrations.push({ key: tool, provider: null, name: opt.label, category: s.category, status: "not_supported_yet", decision: "rejected", capabilities: [], usedBy: [],
          why: bi(`You use ${opt.label.en}. Nexus has no ${opt.label.en} connector yet, so agents work from files you upload instead.`, `تستخدمون ${opt.label.ar}. لا يتوفر في Nexus موصل لـ${opt.label.ar} بعد، لذلك يعمل الوكلاء من الملفات التي ترفعونها.`),
          basis: [b], origin: "provided" });
      }
    }
    if (s.other.trim()) {
      integrations.push({ key: `other_${s.category}`, provider: null, name: { en: s.other.trim(), ar: s.other.trim() }, category: s.category, status: "not_supported_yet", decision: "rejected", capabilities: [], usedBy: [],
        why: bi("Recorded. There is no connector for this system yet.", "تم التسجيل. لا يوجد موصل لهذا النظام بعد."),
        basis: [{ ref: `systems.${s.category}:other`, label: { en: `${cat.label.en}: ${s.other.trim()}`, ar: `${cat.label.ar}: ${s.other.trim()}` } }], origin: "provided" });
    }
  }
  for (const [provider, v] of nativeCaps) {
    const name = provider === "google" ? bi("Google Workspace", "Google Workspace") : bi("Microsoft 365", "Microsoft 365");
    const caps = [...v.caps];
    const capText = { email: bi("email", "البريد"), calendar: bi("calendar", "التقويم"), storage: bi("Drive", "Drive") };
    integrations.unshift({ key: provider, provider, name, category: "email", status: "available", decision: "accepted", capabilities: caps, usedBy: [],
      why: bi(`You use ${name.en}. Connecting it lets agents read ${caps.map((c) => capText[c].en).join(", ")} — reading only; nothing is sent without approval.`,
        `تستخدمون ${name.ar}. ربطه يتيح للوكلاء قراءة ${caps.map((c) => capText[c].ar).join("، ")} — قراءة فقط؛ لا يُرسل شيء دون موافقة.`),
      basis: v.basis, origin: "provided" });
  }
  const crm = profile.systems.find((s) => s.category === "crm");
  if (agents.some((x) => x.function === "sales") && (!crm || crm.none || !crm.tools.length)) {
    openQuestions.push({ key: "no_crm", origin: "inferred", text: bi("No CRM was listed, so lead lists will be delivered as spreadsheets.", "لم يُذكر نظام لإدارة العملاء، لذلك ستُسلَّم قوائم العملاء كجداول بيانات.") });
  }

  // Approval points.
  const g = profile.governance;
  const approvals: BlueprintApproval[] = [];
  const hasA = (k: string) => g.approvalAreas.includes(k as never);
  const hasH = (k: string) => g.humanOnly.includes(k as never);
  approvals.push({ key: "external_send", label: bi("Anything sent outside the company", "أي شيء يُرسل خارج الشركة"), enforcement: "platform", locked: true, enabled: true,
    effect: bi("Platform rule: every external send needs a person's approval of the exact message. Generated agents also get no send tools — they prepare drafts.", "قاعدة المنصة: أي إرسال خارجي يتطلب موافقة شخص على الرسالة نفسها. ولا يحصل الوكلاء المُنشؤون على أدوات إرسال — يجهّزون مسودات فقط."),
    why: bi("Protects your clients and reputation.", "لحماية عملائكم وسمعتكم."), basis: ["external_emails", "client_documents", "publishing"].filter(hasA).map((k) => basis("approval", k)), origin: "provided" });
  approvals.push({ key: "modify_records", label: bi("Changing records (work items, calendar, files)", "تعديل السجلات (بنود العمل، التقويم، الملفات)"), enforcement: "tool_policy", locked: false, enabled: true,
    effect: bi("Agents must get approval before any change to records in Nexus or connected systems.", "يجب أن يحصل الوكلاء على موافقة قبل أي تعديل على السجلات في Nexus أو الأنظمة المرتبطة."),
    why: hasA("data_changes") || hasA("calendar_changes") ? bi("You asked for approval on these changes.", "طلبتم الموافقة على هذه التعديلات.") : bi("Safe default for a new workforce; you can relax it.", "إعداد آمن افتراضيًا لقوى عاملة جديدة؛ يمكنكم تخفيفه."),
    basis: ["data_changes", "calendar_changes"].filter(hasA).map((k) => basis("approval", k)), origin: hasA("data_changes") || hasA("calendar_changes") ? "provided" : "inferred" });
  if (hasH("external_communication")) approvals.push({ key: "no_external", label: bi("All external communication stays human", "جميع المراسلات الخارجية تبقى للبشر"), enforcement: "tool_policy", locked: false, enabled: true,
    effect: bi("No agent can use external tools at all (risk level 4 blocked).", "لا يمكن لأي وكيل استخدام الأدوات الخارجية (المستوى ٤ محظور)."), why: bi("You marked this as human-only.", "حددتم ذلك كعمل بشري فقط."), basis: [basis("humanOnly", "external_communication")], origin: "provided" });
  const boundary = (key: string, label: Bi, effect: Bi, fns: FunctionKey[] | "all", b: Basis[], noTool = false) => {
    if (!b.length) return;
    approvals.push({ key, label, enforcement: noTool ? "no_tool" : "instruction", locked: false, enabled: true, effect, why: bi("From your answers.", "من إجاباتكم."), basis: b, origin: "provided", appliesTo: fns === "all" ? "all" : fns.map((f) => FUNCTION_DEPARTMENTS[f].key) });
  };
  boundary("pricing", bi("Pricing & quotations", "الأسعار وعروض الأسعار"), bi("Agents prepare pricing for your decision and never commit to prices or discounts.", "يجهّز الوكلاء الأسعار لقراركم ولا يلتزمون بأي سعر أو خصم."), ["sales", "proposals", "finance"],
    [...(hasA("pricing") ? [basis("approval", "pricing")] : []), ...(hasH("final_pricing") ? [basis("humanOnly", "final_pricing")] : [])]);
  boundary("financial", bi("Financial actions", "الإجراءات المالية"), bi("Agents can analyse and draft, but have no tool that moves money; payments stay with your team.", "يمكن للوكلاء التحليل والصياغة، لكن لا توجد أداة تنقل الأموال؛ المدفوعات تبقى لدى فريقكم."), "all",
    [...(hasA("financial") ? [basis("approval", "financial")] : []), ...(hasH("payments") ? [basis("humanOnly", "payments")] : [])], true);
  boundary("hiring", bi("Hiring decisions", "قرارات التوظيف"), bi("Agents recommend candidates with reasons; decisions and offers stay with your team.", "يرشّح الوكلاء المرشحين مع الأسباب؛ القرارات والعروض تبقى لدى فريقكم."), ["hr", "recruitment"],
    [...(hasA("hiring_decisions") ? [basis("approval", "hiring_decisions")] : []), ...(hasH("hiring") ? [basis("humanOnly", "hiring")] : [])]);
  boundary("publishing", bi("Publishing content", "نشر المحتوى"), bi("Agents have no publishing tool; content is delivered as drafts.", "لا يملك الوكلاء أداة نشر؛ يُسلَّم المحتوى كمسودات."), ["marketing"], hasA("publishing") ? [basis("approval", "publishing")] : [], true);
  boundary("client_documents", bi("Documents for clients", "مستندات العملاء"), bi("Client documents are drafts until a person reviews and sends them.", "مستندات العملاء مسودات حتى يراجعها شخص ويرسلها."), "all", hasA("client_documents") ? [basis("approval", "client_documents")] : []);
  boundary("negotiation", bi("Client negotiations", "التفاوض مع العملاء"), bi("Agents prepare negotiation briefs but never negotiate.", "يجهّز الوكلاء ملخصات للتفاوض لكنهم لا يتفاوضون."), ["sales"], hasH("client_negotiation") ? [basis("humanOnly", "client_negotiation")] : []);
  boundary("legal", bi("Legal commitments", "الالتزامات القانونية"), bi("Agents never accept terms or commit the company legally.", "لا يقبل الوكلاء أي شروط ولا يُلزمون الشركة قانونيًا."), "all", hasH("legal") ? [basis("humanOnly", "legal")] : []);
  if (g.otherHumanOnly.trim()) approvals.push({ key: "customer_rule", label: bi("Your own rule", "قاعدتكم الخاصة"), enforcement: "instruction", locked: false, enabled: true,
    effect: { en: `Added to every agent's instructions exactly as written: “${g.otherHumanOnly.trim()}”`, ar: `أُضيفت إلى تعليمات كل وكيل كما كُتبت: «${g.otherHumanOnly.trim()}»` },
    why: bi("You wrote this rule.", "كتبتم هذه القاعدة."), basis: [{ ref: "work.otherHumanOnly", label: { en: `Your words: ${g.otherHumanOnly.trim()}`, ar: `بكلماتكم: ${g.otherHumanOnly.trim()}` } }], origin: "provided", appliesTo: "all", ruleText: g.otherHumanOnly.trim() });

  if (profile.freeText.challenges.trim()) {
    openQuestions.push({ key: "free_challenges", origin: "needs_confirmation",
      text: { en: `We recorded your note but did not map it automatically: “${profile.freeText.challenges.trim()}”. Add or adjust agents if it needs coverage.`, ar: `سجّلنا ملاحظتكم ولم نربطها تلقائيًا: «${profile.freeText.challenges.trim()}». أضيفوا أو عدّلوا الوكلاء إن احتاجت إلى تغطية.` } });
  }
  for (const f of profile.facts.filter((x) => x.origin === "needs_confirmation")) openQuestions.push({ key: `confirm_${f.key}`, origin: "needs_confirmation", text: f.statement });

  const bp: WorkforceBlueprint = {
    engine: ENGINE_VERSION,
    company: { name: profile.company.name, language: profile.company.language, size: profile.company.size },
    departments, agents, integrations, approvals, workflows: [], outcomes: [], openQuestions,
    dataPolicy: {
      defaultLevel: "internal",
      categories: g.classifications,
      note: bi("Classification is recorded now and applied to stored data as data-classification enforcement is rolled out.", "يُسجَّل التصنيف الآن ويُطبَّق على البيانات المخزنة مع تفعيل إنفاذ تصنيف البيانات."),
    },
    settings: { autoApproveLevel3: false, autoApproveAgentMemories: false },
    edits: 0,
  };
  return finalizeBlueprint(bp, a);
}

// ───────────────────────── Derived fields (recomputed after every edit) ─────────────────────────

const SKILL_TOOLS = new Map(BUILTIN_SKILLS.map((s) => [s.key, s.requiredTools]));
const INTEGRATION_TOOLS: Record<"email" | "calendar" | "storage", Array<{ tool: string; minRisk: number }>> = {
  email: [{ tool: "email_search", minRisk: 1 }],
  calendar: [{ tool: "calendar_list_events", minRisk: 1 }, { tool: "calendar_create_event", minRisk: 3 }],
  storage: [{ tool: "drive_search", minRisk: 1 }],
};

/**
 * Recomputes everything derived from the editable inputs: permissions, tools, skills, integrations,
 * reporting lines, boundaries, workflows and outcomes. Agents never receive more than their role's risk,
 * and generated agents never receive level-4 (external send) tools.
 */
export function finalizeBlueprint(bp: WorkforceBlueprint, a?: Answers): WorkforceBlueprint {
  const enabled = (k: string) => bp.approvals.some((x) => x.key === k && x.enabled);
  const noExternal = enabled("no_external");
  const modifyApproval = enabled("modify_records");
  const accepted = bp.integrations.filter((i) => i.status === "available" && i.decision === "accepted");
  const caps = new Set(accepted.flatMap((i) => i.capabilities));

  // Department leads: lowest catalogue rank, then catalogue order.
  const leadOf = new Map<string, string>();
  for (const d of bp.departments) {
    const members = bp.agents.filter((x) => x.departmentKey === d.key);
    members.sort((x, y) => (ROLE_BY_KEY.get(x.roleKey)?.rank ?? 9) - (ROLE_BY_KEY.get(y.roleKey)?.rank ?? 9));
    if (members[0]) leadOf.set(d.key, members[0].key);
  }

  for (const ag of bp.agents) {
    const role = ROLE_BY_KEY.get(ag.roleKey)!;
    const cap = Math.min(role.risk, ag.riskCap ?? 4, noExternal ? 3 : 4, 3) as 1 | 2 | 3;
    ag.maxRiskLevel = cap;
    ag.alwaysApproveModify = modifyApproval;
    const tools = new Set(role.tools.filter((t) => (getTool(t)?.riskLevel ?? 9) <= cap));
    ag.integrations = [];
    for (const use of role.uses ?? []) {
      if (!caps.has(use)) continue;
      for (const it of INTEGRATION_TOOLS[use]) if (cap >= it.minRisk && (getTool(it.tool)?.riskLevel ?? 9) <= cap) tools.add(it.tool);
      const provider = accepted.find((i) => i.capabilities.includes(use));
      if (provider && !ag.integrations.includes(provider.key)) ag.integrations.push(provider.key);
    }
    ag.tools = [...tools];
    ag.skills = role.skills.filter((s) => (SKILL_TOOLS.get(s) ?? []).every((t) => tools.has(t)));
    const lead = leadOf.get(ag.departmentKey);
    ag.supervisorKey = lead && lead !== ag.key ? lead : "orchestrator";
    ag.delegatesTo = lead === ag.key ? bp.agents.filter((x) => x.departmentKey === ag.departmentKey && x.key !== ag.key).map((x) => x.key) : [];
    ag.collaboratesWith = [];
    ag.boundaries = bp.approvals
      .filter((p) => p.enabled && (p.enforcement === "instruction" || p.enforcement === "no_tool") && (p.appliesTo === "all" || p.appliesTo?.includes(ag.departmentKey)))
      .map((p) => (p.ruleText ? { en: `Customer rule: ${p.ruleText}`, ar: `قاعدة العميل: ${p.ruleText}` } : p.effect));
    const lang = bp.company.language;
    ag.boundaries.push(lang === "ar" ? bi("Write in Arabic unless asked otherwise.", "اكتب بالعربية ما لم يُطلب غير ذلك.") : lang === "en" ? bi("Write in English unless asked otherwise.", "اكتب بالإنجليزية ما لم يُطلب غير ذلك.") : bi("Write in the language of the request; deliver Arabic and English when asked.", "اكتب بلغة الطلب؛ وسلّم بالعربية والإنجليزية عند الطلب."));
    if (bp.dataPolicy.categories.some((c) => c.level === "restricted")) ag.boundaries.push(bi("Never store national IDs or health information in memory.", "لا تحفظ الهويات الوطنية أو المعلومات الصحية في الذاكرة أبدًا."));
    const lead2 = ag.supervisorKey === "orchestrator" ? bi("Reports to راشد (Chief Orchestrator).", "يتبع راشد (المنسّق الرئيسي).") : { en: `Reports to ${bp.agents.find((x) => x.key === ag.supervisorKey)?.nameEn}.`, ar: `يتبع ${bp.agents.find((x) => x.key === ag.supervisorKey)?.nameAr}.` };
    ag.why = ag.origin === "customer_edit"
      ? { en: `Added by you during review. ${lead2.en}`, ar: `أضفتموه أثناء المراجعة. ${lead2.ar}` }
      : { en: `${role.summary.en} Recommended because of: ${ag.basis.filter((x) => !x.ref.startsWith("structure.")).map((x) => x.label.en).join("; ") || ag.basis.map((x) => x.label.en).join("; ")}. ${lead2.en}`,
          ar: `${role.summary.ar} أوصينا به بسبب: ${ag.basis.filter((x) => !x.ref.startsWith("structure.")).map((x) => x.label.ar).join("؛ ") || ag.basis.map((x) => x.label.ar).join("؛ ")}. ${lead2.ar}` };
  }
  for (const i of bp.integrations) i.usedBy = bp.agents.filter((x) => x.integrations.includes(i.key)).map((x) => x.key);

  // Workflows: proposed when every role is present (first matching agent per role).
  const keep = new Map(bp.workflows.map((w) => [w.key, w]));
  bp.workflows = [];
  for (const wf of WORKFLOWS) {
    const members = wf.roles.map((r) => bp.agents.find((x) => x.roleKey === r));
    if (members.some((m) => !m)) continue;
    const prev = keep.get(wf.key);
    const b = prev?.basis ?? (a ? dedupe(wf.triggers.flatMap((t) => triggerBasis(a, t))) : []);
    if (!b.length && !prev) continue;
    const prompt = { en: wf.prompt.en.replaceAll("{company}", bp.company.name), ar: wf.prompt.ar.replaceAll("{company}", bp.company.name) };
    bp.workflows.push({ key: wf.key, name: wf.name, description: wf.description, agents: members.map((m) => m!.key), approvals: wf.approvals, prompt,
      why: { en: `Matches: ${b.map((x) => x.label.en).join("; ")}`, ar: `يطابق: ${b.map((x) => x.label.ar).join("؛ ")}` }, basis: b });
  }
  for (const w of bp.workflows) for (const k of w.agents) {
    const ag = bp.agents.find((x) => x.key === k)!;
    for (const other of w.agents) if (other !== k && !ag.collaboratesWith.includes(other) && !ag.delegatesTo.includes(other) && ag.supervisorKey !== other) ag.collaboratesWith.push(other);
  }

  // Outcomes: tied to stated priorities and challenges; never numeric promises.
  bp.outcomes = [];
  const PRIORITY_FUNCTIONS: Record<string, FunctionKey[]> = { productivity: ["operations", "delivery"], revenue: ["sales", "proposals", "marketing"], customer_experience: ["customer_support", "delivery"], workload: ["operations", "finance", "hr"], reporting: ["research", "finance"], delivery_speed: ["delivery", "operations"] };
  const prios = a?.priorities.ranked ?? [];
  prios.forEach((p, i) => {
    const who = bp.agents.filter((x) => PRIORITY_FUNCTIONS[p]?.includes(x.function) || ROLE_BY_KEY.get(x.roleKey)?.triggers.includes(`priority:${p}` as never));
    const l = lbl(PRIORITIES, p);
    bp.outcomes.push(who.length
      ? { text: { en: `Priority #${i + 1} — ${l.en}: supported by ${who.map((x) => x.nameEn).join(", ")}.`, ar: `الأولوية #${i + 1} — ${l.ar}: يدعمها ${who.map((x) => x.nameAr).join("، ")}.` }, basis: [basis("priority", p)], covered: true }
      : { text: { en: `Priority #${i + 1} — ${l.en}: no agent covers this yet. Add one during review.`, ar: `الأولوية #${i + 1} — ${l.ar}: لا يغطيها أي وكيل بعد. أضيفوا وكيلًا أثناء المراجعة.` }, basis: [basis("priority", p)], covered: false });
  });
  for (const c of a?.business.challenges ?? []) {
    const who = bp.agents.filter((x) => ROLE_BY_KEY.get(x.roleKey)?.triggers.includes(`challenge:${c}` as never));
    if (!who.length) continue;
    const l = lbl(CHALLENGES, c);
    bp.outcomes.push({ text: { en: `“${l.en}” — taken on by ${who.map((x) => x.nameEn).join(", ")}.`, ar: `«${l.ar}» — يتولاه ${who.map((x) => x.nameAr).join("، ")}.` }, basis: [basis("challenge", c)], covered: true });
  }
  for (const w of bp.workflows) bp.outcomes.push({ text: { en: `${w.name.en} ready to run from day one.`, ar: `${w.name.ar} جاهز للتشغيل من اليوم الأول.` }, basis: w.basis, covered: true });

  bp.settings = { autoApproveLevel3: !modifyApproval, autoApproveAgentMemories: false };
  return bp;
}

export function blueprintHash(bp: WorkforceBlueprint): string {
  return createHash("sha256").update(canonicalJson(bp)).digest("hex");
}

// ───────────────────────── Customer edits (§5.5) ─────────────────────────

export class BlueprintEditError extends Error {}

/** Applies one customer edit. The result is re-finalised so permissions can never exceed the role. */
export function applyEdit(input: WorkforceBlueprint, edit: BlueprintEdit, a: Answers): WorkforceBlueprint {
  const bp: WorkforceBlueprint = structuredClone(input);
  const agent = (key: string) => {
    const x = bp.agents.find((y) => y.key === key);
    if (!x) throw new BlueprintEditError(`Unknown agent "${key}"`);
    return x;
  };
  switch (edit.op) {
    case "remove_agent": {
      agent(edit.agent);
      bp.agents = bp.agents.filter((x) => x.key !== edit.agent);
      bp.departments = bp.departments.filter((d) => bp.agents.some((x) => x.departmentKey === d.key));
      break;
    }
    case "add_agent": {
      const role = ROLE_BY_KEY.get(edit.role);
      if (!role) throw new BlueprintEditError(`Unknown role "${edit.role}"`);
      const fn = (edit.function ?? role.functions[0]) as FunctionKey;
      if (!role.functions.includes(fn)) throw new BlueprintEditError(`${role.title.en} cannot work in that department`);
      const n = bp.agents.filter((x) => x.roleKey === role.key).length;
      const key = n ? `${role.key}_${n + 1}` : role.key;
      const ag = roleAgent(role, key, fn, [], "customer_edit");
      if (n) { ag.nameEn = `${role.persona.nameEn} ${n + 1}`; ag.nameAr = `${role.persona.nameAr} ${n + 1}`; ag.reuse = null; }
      if (bp.agents.some((x) => x.reuse && x.reuse === ag.reuse)) ag.reuse = null;
      bp.agents.push(ag);
      if (!bp.departments.some((d) => d.key === ag.departmentKey)) {
        const d = FUNCTION_DEPARTMENTS[fn];
        bp.departments.push({ key: d.key, function: fn, name: d.name, color: d.color, objective: d.objective, isNew: false,
          why: bi("Added by you during review.", "أضفتموه أثناء المراجعة."), basis: [], origin: "customer_edit" });
      }
      break;
    }
    case "update_agent": {
      const ag = agent(edit.agent);
      if (edit.nameEn !== undefined) ag.nameEn = edit.nameEn;
      if (edit.nameAr !== undefined) ag.nameAr = edit.nameAr;
      if (edit.duties !== undefined) ag.customDuties = edit.duties.trim() || null;
      if (edit.riskCap !== undefined) ag.riskCap = edit.riskCap;
      if (ag.origin !== "customer_edit") ag.edited = true;
      break;
    }
    case "remove_department": {
      if (!bp.departments.some((d) => d.key === edit.department)) throw new BlueprintEditError("Unknown department");
      bp.departments = bp.departments.filter((d) => d.key !== edit.department);
      bp.agents = bp.agents.filter((x) => x.departmentKey !== edit.department);
      break;
    }
    case "rename_department": {
      const d = bp.departments.find((x) => x.key === edit.department);
      if (!d) throw new BlueprintEditError("Unknown department");
      d.name = { en: edit.name, ar: edit.nameAr };
      break;
    }
    case "set_integration": {
      const i = bp.integrations.find((x) => x.key === edit.integration);
      if (!i) throw new BlueprintEditError("Unknown integration");
      if (i.status !== "available" && edit.decision === "accepted") throw new BlueprintEditError("This system has no connector yet");
      i.decision = edit.decision;
      break;
    }
    case "set_approval": {
      const p = bp.approvals.find((x) => x.key === edit.approval);
      if (!p) throw new BlueprintEditError("Unknown approval point");
      if (p.locked) throw new BlueprintEditError("This approval is a platform rule and cannot be turned off");
      p.enabled = edit.enabled;
      break;
    }
  }
  bp.edits += 1;
  return finalizeBlueprint(bp, a);
}

export type { WorkforceBlueprint, OperatingProfile, BlueprintWorkflow };
