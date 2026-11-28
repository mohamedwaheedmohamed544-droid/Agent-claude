import { AnswersSchema, type Answers } from "@/lib/onboarding/schema";

/** A Saudi B2G consulting firm used across onboarding tests. */
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
