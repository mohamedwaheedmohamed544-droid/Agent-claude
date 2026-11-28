import { describe, it, expect } from "vitest";
import { AnswersSchema, cleanStep, relevantFunctions, relevantTasks, asksTeamSize, type Answers } from "@/lib/onboarding/schema";
import { applyEdit, blueprintHash, buildOperatingProfile, generateBlueprint, BlueprintEditError } from "@/lib/onboarding/engine";
import { getTool } from "@/lib/tools/registry";

export function consultingAnswers(overrides: Partial<Answers> = {}): Answers {
  return AnswersSchema.parse({
    identity: { companyName: "Masar Advisory", country: "SA", locations: ["Riyadh"], industry: "consulting", subIndustry: "Strategy", website: "", size: "10-24", businessType: "b2g", language: "both" },
    business: { offerings: ["Strategy consulting", "Feasibility studies"], targetCustomers: "Government entities and large companies", revenueChannels: ["tenders", "referrals"], objectives: ["grow_revenue", "better_reporting"], challenges: ["slow_proposals", "manual_reporting"], otherChallenges: "" },
    structure: { functions: {
      sales: { status: "internal", teamSize: 2, notes: "" }, marketing: { status: "not_needed", teamSize: null, notes: "" }, delivery: { status: "internal", teamSize: 8, notes: "" },
      operations: { status: "internal", teamSize: 1, notes: "" }, finance: { status: "outsourced", teamSize: null, notes: "" }, hr: { status: "not_needed", teamSize: null, notes: "" },
      research: { status: "missing", teamSize: null, notes: "" }, proposals: { status: "internal", teamSize: 2, notes: "" },
    } },
    work: { repetitiveTasks: ["proposal_writing", "tender_review", "weekly_reporting", "meeting_notes"], timeConsumingTasks: ["proposal_writing"], researchNeeds: ["tenders", "competitors"], reportingNeeds: ["kpi"], followUps: [],
      approvalAreas: ["external_emails", "pricing", "client_documents"], humanOnly: ["final_pricing"], otherHumanOnly: "", sensitiveData: ["contracts"] },
    systems: { email: { tools: ["microsoft_365"], other: "", none: false }, calendar: { tools: ["microsoft_365"], other: "", none: false }, storage: { tools: ["onedrive"], other: "", none: false }, crm: { tools: [], other: "", none: true }, project_management: { tools: ["asana"], other: "", none: false } },
    priorities: { ranked: ["revenue", "reporting"] },
    ...overrides,
  });
}

describe("onboarding questionnaire (conditional questions)", () => {
  it("asks recruitment, support and proposals only of companies they apply to", () => {
    expect(relevantFunctions({ identity: { industry: "recruitment", businessType: "b2b" } })).toContain("recruitment");
    expect(relevantFunctions({ identity: { industry: "consulting", businessType: "b2b" } })).not.toContain("recruitment");
    expect(relevantFunctions({ identity: { industry: "agency", businessType: "b2b" } })).not.toContain("customer_support");
    expect(relevantFunctions({ identity: { industry: "agency", businessType: "b2c" } })).toContain("customer_support");
    expect(relevantFunctions({ identity: { industry: "agency", businessType: "b2b" } })).not.toContain("proposals");
    expect(relevantFunctions({ identity: { industry: "agency", businessType: "b2g" } })).toContain("proposals");
  });

  it("only asks team size of companies with 10+ employees and drops hidden answers", () => {
    expect(asksTeamSize({ identity: { size: "1-9" } })).toBe(false);
    const ctx = { identity: { industry: "agency" as const, businessType: "b2b" as const, size: "1-9" as const } };
    const fns = Object.fromEntries(relevantFunctions(ctx).map((k) => [k, { status: "internal", teamSize: 4, notes: "" }]));
    const cleaned = cleanStep("structure", { functions: { ...fns, recruitment: { status: "internal", teamSize: 3, notes: "" } } }, ctx) as Answers["structure"];
    expect(cleaned.functions.recruitment).toBeUndefined();
    expect(Object.values(cleaned.functions).every((f) => f.teamSize === null)).toBe(true);
  });

  it("requires an answer for every function the company was asked about", () => {
    expect(() => cleanStep("structure", { functions: { sales: { status: "internal", teamSize: null, notes: "" } } }, { identity: { industry: "agency", businessType: "b2b", size: "1-9" } })).toThrow();
  });

  it("filters tasks to the company's active functions", () => {
    const ctx = { identity: { industry: "agency" as const, businessType: "b2b" as const }, structure: { functions: { finance: { status: "not_needed" as const, teamSize: null, notes: "" }, hr: { status: "not_needed" as const, teamSize: null, notes: "" } } } };
    expect(relevantTasks(ctx)).not.toContain("invoice_followup");
    expect(relevantTasks(ctx)).not.toContain("candidate_screening");
  });
});

describe("Company Operating Profile", () => {
  it("separates provided facts from inferences and confirmations", () => {
    const p = buildOperatingProfile(consultingAnswers({ business: { ...consultingAnswers().business, revenueChannels: ["referrals"] } }));
    expect(p.facts.find((f) => f.key === "company")!.origin).toBe("provided");
    const b2g = p.facts.find((f) => f.key === "b2g_tenders")!;
    expect(b2g.origin).toBe("needs_confirmation");
    expect(b2g.basis[0].ref).toBe("identity.businessType:b2g");
    expect(p.facts.find((f) => f.key === "gaps")!.statement.en).toContain("Research & analysis");
    expect(p.facts.find((f) => f.key === "outsourced")!.statement.en).toContain("Finance");
  });
});

describe("Workforce Blueprint", () => {
  const a = consultingAnswers();
  const bp = generateBlueprint(a);
  const keys = bp.agents.map((x) => x.roleKey);

  it("recommends agents only from stated demand, each with an explanation and basis", () => {
    expect(keys).toEqual(expect.arrayContaining(["proposal_specialist", "data_analyst", "executive_assistant", "bd_specialist", "research_analyst"]));
    for (const ag of bp.agents) {
      expect(ag.basis.length).toBeGreaterThan(0);
      expect(ag.why.en.length).toBeGreaterThan(20);
      expect(ag.why.ar.length).toBeGreaterThan(10);
      // Every basis points at an answer the customer actually gave.
      for (const b of ag.basis) expect(b.ref).toMatch(/^(work|business|priorities|structure)\./);
    }
    // No social-media / support / HR agents: the customer never asked for that work.
    expect(keys).not.toContain("content_writer");
    expect(keys).not.toContain("support_specialist");
    expect(keys).not.toContain("hr_coordinator");
  });

  it("never invents departments: not_needed and outsourced functions get none; missing ones are filled", () => {
    const depts = bp.departments.map((d) => d.function);
    expect(depts).not.toContain("marketing");
    expect(depts).not.toContain("finance");
    expect(depts).not.toContain("hr");
    expect(depts).toContain("research");
    expect(bp.departments.find((d) => d.function === "research")!.isNew).toBe(true);
    expect(bp.openQuestions.some((q) => q.key === "outsourced_finance")).toBe(true);
  });

  it("is honest about integrations: only systems with a working connector are 'available'", () => {
    const ms = bp.integrations.find((i) => i.key === "microsoft")!;
    expect(ms.status).toBe("available");
    expect([...ms.capabilities].sort()).toEqual(["calendar", "email"]);
    for (const k of ["onedrive", "asana"]) {
      const i = bp.integrations.find((x) => x.key === k)!;
      expect(i.status).toBe("not_supported_yet");
      expect(i.decision).toBe("rejected");
    }
    expect(bp.integrations.some((i) => i.provider === "google")).toBe(false);
    expect(bp.openQuestions.some((q) => q.key === "no_crm")).toBe(true);
  });

  it("applies least privilege: no external-send tools, risk never above the role, approvals bound to answers", () => {
    for (const ag of bp.agents) {
      expect(ag.maxRiskLevel).toBeLessThanOrEqual(ag.roleRisk);
      for (const t of ag.tools) {
        const tool = getTool(t)!;
        expect(tool, t).toBeTruthy();
        expect(tool.riskLevel).toBeLessThanOrEqual(ag.maxRiskLevel);
        expect(tool.riskLevel).toBeLessThan(4);
      }
      expect(ag.alwaysApproveModify).toBe(true);
    }
    expect(bp.settings.autoApproveLevel3).toBe(false);
    const ext = bp.approvals.find((p) => p.key === "external_send")!;
    expect(ext.locked).toBe(true);
    expect(ext.basis.map((b) => b.ref)).toContain("work.approvalAreas:external_emails");
    const pricing = bp.approvals.find((p) => p.key === "pricing")!;
    expect(pricing.basis.map((b) => b.ref)).toEqual(["work.approvalAreas:pricing", "work.humanOnly:final_pricing"]);
    const proposal = bp.agents.find((x) => x.roleKey === "proposal_specialist")!;
    expect(proposal.boundaries.map((b) => b.en).join(" ")).toContain("never commit to prices");
  });

  it("gives connected-system read tools only to roles that use them", () => {
    const ea = bp.agents.find((x) => x.roleKey === "executive_assistant")!;
    expect(ea.tools).toEqual(expect.arrayContaining(["email_search", "calendar_list_events"]));
    expect(ea.integrations).toEqual(["microsoft"]);
    const da = bp.agents.find((x) => x.roleKey === "data_analyst")!;
    expect(da.tools).not.toContain("email_search");
  });

  it("builds reporting lines without cycles and proposes only workflows backed by answers", () => {
    for (const ag of bp.agents) {
      const lead = ag.supervisorKey;
      if (lead !== "orchestrator") expect(bp.agents.find((x) => x.key === lead)!.supervisorKey).toBe("orchestrator");
    }
    const wf = bp.workflows.map((w) => w.key);
    expect(wf).toEqual(expect.arrayContaining(["tender_response", "weekly_kpi_report", "meeting_actions", "competitor_watch"]));
    expect(wf).not.toContain("content_calendar");
    for (const w of bp.workflows) expect(w.prompt.en).not.toContain("{company}");
  });

  it("ties outcomes to stated priorities and flags uncovered ones", () => {
    expect(bp.outcomes[0].text.en).toMatch(/^Priority #1 — Increase revenue: supported by/);
  });

  it("is deterministic", () => {
    expect(blueprintHash(generateBlueprint(a))).toBe(blueprintHash(bp));
  });

  it("records free-text input without mapping it automatically", () => {
    const x = generateBlueprint(consultingAnswers({ business: { ...a.business, otherChallenges: "Our Arabic proposals need native review" }, work: { ...a.work, otherHumanOnly: "Never contact Ministry X directly" } }));
    expect(x.openQuestions.find((q) => q.key === "free_challenges")!.origin).toBe("needs_confirmation");
    const rule = x.approvals.find((p) => p.key === "customer_rule")!;
    expect(rule.ruleText).toBe("Never contact Ministry X directly");
    for (const ag of x.agents) expect(ag.boundaries.some((b) => b.en.includes("Never contact Ministry X directly"))).toBe(true);
  });
});

describe("customer edits", () => {
  const a = consultingAnswers();
  const bp = generateBlueprint(a);

  it("remove/add agents, rename departments, and change the hash", () => {
    let x = applyEdit(bp, { op: "remove_agent", agent: "bd_specialist" }, a);
    expect(x.agents.some((g) => g.key === "bd_specialist")).toBe(false);
    expect(blueprintHash(x)).not.toBe(blueprintHash(bp));
    x = applyEdit(x, { op: "add_agent", role: "content_writer", function: "sales" }, a);
    const cw = x.agents.find((g) => g.roleKey === "content_writer")!;
    expect(cw.origin).toBe("customer_edit");
    expect(cw.departmentKey).toBe("bizdev");
    x = applyEdit(x, { op: "rename_department", department: "documents", name: "Bids Office", nameAr: "مكتب العطاءات" }, a);
    expect(x.departments.find((d) => d.key === "documents")!.name.en).toBe("Bids Office");
    expect(x.edits).toBe(3);
  });

  it("a duplicate role becomes a new agent instead of reusing the starter agent twice", () => {
    const x = applyEdit(bp, { op: "add_agent", role: "proposal_specialist" }, a);
    const two = x.agents.filter((g) => g.roleKey === "proposal_specialist");
    expect(two).toHaveLength(2);
    expect(two[1].reuse).toBeNull();
    expect(two[1].nameEn).toBe("Bayan 2");
  });

  it("can lower but never raise an agent's risk ceiling", () => {
    const pm = bp.agents.find((g) => g.roleKey === "project_manager");
    if (pm) {
      const x = applyEdit(bp, { op: "update_agent", agent: pm.key, riskCap: 1 }, a);
      const after = x.agents.find((g) => g.key === pm.key)!;
      expect(after.maxRiskLevel).toBe(1);
      expect(after.tools.every((t) => getTool(t)!.riskLevel <= 1)).toBe(true);
    }
    const da = bp.agents.find((g) => g.roleKey === "data_analyst")!;
    const y = applyEdit(bp, { op: "update_agent", agent: da.key, riskCap: 3 }, a);
    expect(y.agents.find((g) => g.key === da.key)!.maxRiskLevel).toBe(2);
  });

  it("rejecting an integration removes its tools; unsupported systems cannot be accepted; platform rules stay on", () => {
    const x = applyEdit(bp, { op: "set_integration", integration: "microsoft", decision: "rejected" }, a);
    for (const ag of x.agents) expect(ag.tools).not.toContain("email_search");
    expect(() => applyEdit(bp, { op: "set_integration", integration: "asana", decision: "accepted" }, a)).toThrow(BlueprintEditError);
    expect(() => applyEdit(bp, { op: "set_approval", approval: "external_send", enabled: false }, a)).toThrow(BlueprintEditError);
  });

  it("relaxing the modify-records approval is explicit and reflected in workspace settings", () => {
    const x = applyEdit(bp, { op: "set_approval", approval: "modify_records", enabled: false }, a);
    expect(x.settings.autoApproveLevel3).toBe(true);
    expect(x.agents.every((g) => !g.alwaysApproveModify)).toBe(true);
  });

  it("removing a department removes its agents", () => {
    const x = applyEdit(bp, { op: "remove_department", department: "documents" }, a);
    expect(x.agents.some((g) => g.departmentKey === "documents")).toBe(false);
    expect(x.workflows.some((w) => w.key === "tender_response")).toBe(false);
  });
});
