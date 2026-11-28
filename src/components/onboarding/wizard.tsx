"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { useT } from "@/components/providers";
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea, cx } from "@/components/ui";
import {
  APPROVAL_AREAS, BUSINESS_TYPES, CHALLENGES, COUNTRIES, FOLLOWUPS, FUNCTION_STATUSES, FUNCTIONS, HUMAN_ONLY, INDUSTRIES, LANGUAGES, OBJECTIVES,
  PRIORITIES, REPORTING_NEEDS, REVENUE_CHANNELS, SENSITIVE_DATA, SIZES, STEPS, STEP_LABELS, SYSTEM_CATEGORIES, TASKS,
  asksTeamSize, relevantFunctions, relevantResearchNeeds, relevantSystemCategories, relevantTasks,
  type FunctionAnswer, type PartialAnswers, type StepKey, type SystemCategory,
} from "@/lib/onboarding/schema";
import type { OnboardingState } from "@/lib/onboarding/types";
import { Chips, Question, RadioCards, Segmented, TagInput, useBi } from "./controls";

type Draft = { [K in StepKey]: Record<string, unknown> };

const EMPTY: Draft = {
  identity: { companyName: "", country: "SA", locations: [], industry: undefined, subIndustry: "", website: "", size: undefined, businessType: undefined, language: undefined },
  business: { offerings: [], targetCustomers: "", revenueChannels: [], objectives: [], challenges: [], otherChallenges: "" },
  structure: { functions: {} },
  work: { repetitiveTasks: [], timeConsumingTasks: [], researchNeeds: [], reportingNeeds: [], followUps: [], approvalAreas: [], humanOnly: [], otherHumanOnly: "", sensitiveData: [] },
  systems: {},
  priorities: { ranked: [] },
};

export function OnboardingWizard({ state, onSaved, onFinished }: { state: OnboardingState; onSaved: (s: OnboardingState) => void; onFinished: () => void }) {
  const { t } = useT();
  const bi = useBi();
  const saved = state.answers as PartialAnswers;
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(STEPS.map((s) => [s, { ...EMPTY[s], ...((saved[s] as Record<string, unknown>) ?? {}) }])) as Draft);
  const initial = Math.max(0, STEPS.indexOf((state.currentStep as StepKey) ?? "identity"));
  const [index, setIndex] = useState(state.complete ? 0 : initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fields: string[] } | null>(null);
  const step = STEPS[index];

  const ctx = draft as unknown as PartialAnswers;
  const set = (s: StepKey, patch: Record<string, unknown>) => setDraft((d) => ({ ...d, [s]: { ...d[s], ...patch } }));
  const v = <T = never,>(s: StepKey, k: string): T => draft[s][k] as T;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let data: unknown = draft[step];
      if (step === "structure") {
        const fns = draft.structure.functions as Record<string, FunctionAnswer>;
        data = { functions: Object.fromEntries(relevantFunctions(ctx).map((k) => [k, fns[k] ?? { status: undefined }])) };
      }
      const next = await api<OnboardingState>("/api/onboarding", { method: "PUT", body: { step, data } });
      onSaved(next);
      if (index === STEPS.length - 1) onFinished();
      else { setIndex(index + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }
    } catch (e) {
      const details = e instanceof ApiError && Array.isArray(e.details) ? (e.details as Array<{ path: string; message: string }>) : [];
      setError({ message: details.length ? details.map((d) => `${d.path}: ${d.message}`).join(" · ") : (e as Error).message, fields: details.map((d) => d.path) });
    } finally {
      setBusy(false);
    }
  };

  const tasks = useMemo(() => relevantTasks(ctx), [ctx]);
  const taskOptions = TASKS.filter((x) => tasks.includes(x.key));
  const repetitive = v<string[]>("work", "repetitiveTasks");

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Steps" className="hidden lg:block">
        <ol className="space-y-1">
          {STEPS.map((s, i) => {
            const done = saved[s] !== undefined;
            return (
              <li key={s}>
                <button type="button" onClick={() => setIndex(i)} disabled={i > 0 && saved[STEPS[i - 1]] === undefined && i > index}
                  aria-current={i === index ? "step" : undefined}
                  className={cx("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-[13px] transition-colors disabled:opacity-40",
                    i === index ? "bg-accent-soft text-accent font-medium" : "text-fg-2 hover:bg-surface-2")}>
                  <span className={cx("grid size-5 place-items-center rounded-full text-[11px]", done ? "bg-success text-white" : i === index ? "bg-accent text-white" : "bg-surface-3 text-fg-3")}>
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  {bi(STEP_LABELS[s])}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <Card className="p-5 sm:p-6">
        <div className="mb-5">
          <p className="text-[12px] font-medium uppercase tracking-wide text-fg-3">{t("onb.step", { n: index + 1, total: STEPS.length })}</p>
          <h2 className="mt-1 text-[19px] font-semibold text-fg">{bi(STEP_LABELS[step])}</h2>
        </div>

        <div className="space-y-6">
          {step === "identity" && (<>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("onb.q.companyName")}><Input value={v<string>("identity", "companyName")} onChange={(e) => set("identity", { companyName: e.target.value })} dir="auto" /></Field>
              <Field label={t("onb.q.country")}>
                <Select aria-label={t("onb.q.country")} value={v<string>("identity", "country")} onChange={(e) => set("identity", { country: e.target.value })}>
                  {COUNTRIES.map((c) => <option key={c.key} value={c.key}>{bi(c.label)}</option>)}
                </Select>
              </Field>
            </div>
            <Question label={t("onb.q.locations")}><TagInput label={t("onb.q.locations")} value={v<string[]>("identity", "locations")} onChange={(x) => set("identity", { locations: x })} placeholder={t("onb.addItem")} /></Question>
            <Question label={t("onb.q.industry")} required><RadioCards name={t("onb.q.industry")} options={INDUSTRIES} value={v("identity", "industry")} onChange={(x) => set("identity", { industry: x })} /></Question>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`${t("onb.q.subIndustry")} · ${t("onb.optional")}`}><Input value={v<string>("identity", "subIndustry")} onChange={(e) => set("identity", { subIndustry: e.target.value })} dir="auto" /></Field>
              <Field label={`${t("onb.q.website")} · ${t("onb.optional")}`} hint={t("onb.q.websiteHint")}><Input value={v<string>("identity", "website")} onChange={(e) => set("identity", { website: e.target.value })} placeholder="https://" dir="ltr" /></Field>
            </div>
            <Question label={t("onb.q.size")} required><RadioCards name={t("onb.q.size")} options={SIZES} value={v("identity", "size")} onChange={(x) => set("identity", { size: x })} columns={4} /></Question>
            <Question label={t("onb.q.businessType")} required><RadioCards name={t("onb.q.businessType")} options={BUSINESS_TYPES} value={v("identity", "businessType")} onChange={(x) => set("identity", { businessType: x })} columns={4} /></Question>
            <Question label={t("onb.q.language")} required><RadioCards name={t("onb.q.language")} options={LANGUAGES} value={v("identity", "language")} onChange={(x) => set("identity", { language: x })} /></Question>
          </>)}

          {step === "business" && (<>
            <Question label={t("onb.q.offerings")} required><TagInput label={t("onb.q.offerings")} value={v<string[]>("business", "offerings")} onChange={(x) => set("business", { offerings: x })} placeholder={t("onb.addItem")} /></Question>
            <Field label={t("onb.q.targetCustomers")}><Textarea rows={2} value={v<string>("business", "targetCustomers")} onChange={(e) => set("business", { targetCustomers: e.target.value })} dir="auto" /></Field>
            <Question label={t("onb.q.revenueChannels")} hint={t("onb.chooseAny")}><Chips options={REVENUE_CHANNELS} value={v("business", "revenueChannels")} onChange={(x) => set("business", { revenueChannels: x })} /></Question>
            <Question label={t("onb.q.objectives")} required><Chips options={OBJECTIVES} value={v("business", "objectives")} onChange={(x) => set("business", { objectives: x })} /></Question>
            <Question label={t("onb.q.challenges")} hint={t("onb.chooseAny")}><Chips options={CHALLENGES} value={v("business", "challenges")} onChange={(x) => set("business", { challenges: x })} /></Question>
            <Field label={`${t("onb.q.otherChallenges")} · ${t("onb.optional")}`}><Textarea rows={2} value={v<string>("business", "otherChallenges")} onChange={(e) => set("business", { otherChallenges: e.target.value })} dir="auto" /></Field>
          </>)}

          {step === "structure" && (
            <Question label={t("onb.q.functions")} hint={t("onb.q.functionsHint")} required>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {relevantFunctions(ctx).map((k) => {
                  const fns = draft.structure.functions as Record<string, FunctionAnswer>;
                  const f = fns[k] ?? { status: undefined as unknown as FunctionAnswer["status"], teamSize: null, notes: "" };
                  const setF = (patch: Partial<FunctionAnswer>) => set("structure", { functions: { ...fns, [k]: { ...f, teamSize: f.teamSize ?? null, notes: f.notes ?? "", ...patch } } });
                  const label = bi(FUNCTIONS.find((x) => x.key === k)!.label);
                  const invalid = error?.fields.some((p) => p.includes(k));
                  return (
                    <li key={k} className={cx("space-y-2 p-3", invalid && "bg-danger-soft")} data-function={k}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[13.5px] font-medium text-fg">{label}</span>
                        <Segmented label={label} options={FUNCTION_STATUSES} value={f.status} onChange={(x) => setF({ status: x })} />
                      </div>
                      {f.status === "internal" && (
                        <div className="flex flex-wrap gap-2">
                          {asksTeamSize(ctx) && <Input type="number" min={0} aria-label={`${label} — ${t("onb.q.teamSize")}`} placeholder={t("onb.q.teamSize")} className="w-28" value={f.teamSize ?? ""} onChange={(e) => setF({ teamSize: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} />}
                          <Input aria-label={`${label} — ${t("onb.q.responsibilities")}`} placeholder={t("onb.q.responsibilities")} className="min-w-[12rem] flex-1" value={f.notes} onChange={(e) => setF({ notes: e.target.value })} dir="auto" />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Question>
          )}

          {step === "work" && (<>
            <Question label={t("onb.q.repetitive")} hint={t("onb.chooseAny")}><Chips options={taskOptions} value={v("work", "repetitiveTasks")} onChange={(x) => set("work", { repetitiveTasks: x, timeConsumingTasks: v<string[]>("work", "timeConsumingTasks").filter((y) => x.includes(y as never)) })} /></Question>
            {repetitive.length > 0 && <Question label={t("onb.q.timeConsuming")}><Chips options={taskOptions.filter((x) => repetitive.includes(x.key))} value={v("work", "timeConsumingTasks")} onChange={(x) => set("work", { timeConsumingTasks: x })} /></Question>}
            <Question label={t("onb.q.research")} hint={t("onb.chooseAny")}><Chips options={relevantResearchNeeds(ctx)} value={v("work", "researchNeeds")} onChange={(x) => set("work", { researchNeeds: x })} /></Question>
            <Question label={t("onb.q.reporting")} hint={t("onb.chooseAny")}><Chips options={REPORTING_NEEDS} value={v("work", "reportingNeeds")} onChange={(x) => set("work", { reportingNeeds: x })} /></Question>
            <Question label={t("onb.q.followUps")} hint={t("onb.chooseAny")}><Chips options={FOLLOWUPS} value={v("work", "followUps")} onChange={(x) => set("work", { followUps: x })} /></Question>
            <Question label={t("onb.q.approvals")} hint={t("onb.chooseAny")}><Chips options={APPROVAL_AREAS} value={v("work", "approvalAreas")} onChange={(x) => set("work", { approvalAreas: x })} /></Question>
            <Question label={t("onb.q.humanOnly")} hint={t("onb.chooseAny")}><Chips options={HUMAN_ONLY} value={v("work", "humanOnly")} onChange={(x) => set("work", { humanOnly: x })} /></Question>
            <Field label={`${t("onb.q.otherHumanOnly")} · ${t("onb.optional")}`} hint={t("onb.q.otherHumanOnlyHint")}><Textarea rows={2} value={v<string>("work", "otherHumanOnly")} onChange={(e) => set("work", { otherHumanOnly: e.target.value })} dir="auto" /></Field>
            <Question label={t("onb.q.sensitive")} hint={t("onb.chooseAny")}><Chips options={SENSITIVE_DATA} value={v("work", "sensitiveData")} onChange={(x) => set("work", { sensitiveData: x })} /></Question>
          </>)}

          {step === "systems" && (
            <Question label={t("onb.q.systems")} hint={t("onb.q.systemsHint")}>
              <div className="space-y-4">
                {relevantSystemCategories(ctx).map((c: SystemCategory) => {
                  const cat = SYSTEM_CATEGORIES[c];
                  const cur = (draft.systems[c] as { tools: string[]; other: string; none: boolean } | undefined) ?? { tools: [], other: "", none: false };
                  const put = (patch: Partial<typeof cur>) => set("systems", { [c]: { ...cur, ...patch } });
                  return (
                    <div key={c} className="rounded-xl border border-border p-3" data-system={c}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[13.5px] font-medium text-fg">{bi(cat.label)}</span>
                        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-3">
                          <input type="checkbox" checked={cur.none} onChange={(e) => put({ none: e.target.checked, tools: e.target.checked ? [] : cur.tools })} /> {t("onb.q.systemNone")}
                        </label>
                      </div>
                      {!cur.none && (<>
                        <Chips options={cat.options} value={cur.tools} onChange={(x) => put({ tools: x })}
                          badge={(k) => (cat.options.find((o) => o.key === k) as { native?: string } | undefined)?.native ? <Badge tone="success">{t("onb.q.connector")}</Badge> : null} />
                        <Input className="mt-2" aria-label={`${bi(cat.label)} — ${t("onb.q.systemOther")}`} placeholder={t("onb.q.systemOther")} value={cur.other} onChange={(e) => put({ other: e.target.value })} dir="auto" />
                      </>)}
                    </div>
                  );
                })}
              </div>
            </Question>
          )}

          {step === "priorities" && (
            <Question label={t("onb.q.priorities")} required>
              <Chips options={PRIORITIES} value={v("priorities", "ranked")} onChange={(x) => set("priorities", { ranked: x })} max={3} ordered />
            </Question>
          )}
        </div>

        {error && <div className="mt-5"><Alert tone="danger">{error.message}</Alert></div>}

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
          <Button variant="ghost" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0} icon={<ArrowLeft className="size-4 rtl:rotate-180" />}>{t("onb.back")}</Button>
          <Button onClick={save} loading={busy} icon={index === STEPS.length - 1 ? <Check className="size-4" /> : <ArrowRight className="size-4 rtl:rotate-180" />}>
            {index === STEPS.length - 1 ? t("onb.finish") : t("onb.next")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
