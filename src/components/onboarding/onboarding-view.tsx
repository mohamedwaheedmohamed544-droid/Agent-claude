"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Bot, CheckCircle2, Play, Plug, RefreshCcw, Sparkles } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { useT } from "@/components/providers";
import { Alert, Badge, Button, Card, CardHeader, ErrorState, Field, LoadingBlock, PageHeader, Textarea } from "@/components/ui";
import { CHALLENGES, FUNCTION_STATUSES, FUNCTIONS, INDUSTRIES, OBJECTIVES, PRIORITIES, SIZES, labelOf, type PartialAnswers } from "@/lib/onboarding/schema";
import type { BlueprintRecord, OnboardingState } from "@/lib/onboarding/types";
import { OnboardingWizard } from "./wizard";
import { BlueprintReview, type Impact } from "./blueprint-review";
import { useBi } from "./controls";

type State = OnboardingState & { impact: Impact | null };

function AnswersSummary({ state, onEdit, onGenerated }: { state: State; onEdit: () => void; onGenerated: () => void }) {
  const { t, locale } = useT();
  const a = state.answers as PartialAnswers;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revising = Boolean(state.blueprint);
  const generate = async () => {
    setBusy(true); setError(null);
    try { await api("/api/onboarding/proposal", { body: { revisionNote: note || null } }); onGenerated(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const fns = Object.entries(a.structure?.functions ?? {});
  return (
    <Card>
      <CardHeader title={t("onb.review.answersTitle")} actions={state.canManage && <Button variant="ghost" onClick={onEdit}>{t("onb.review.editAnswers")}</Button>} />
      <dl className="grid gap-x-6 gap-y-3 px-5 pb-5 text-[13px] sm:grid-cols-2">
        <div><dt className="text-fg-3">{t("onb.q.companyName")}</dt><dd className="font-medium text-fg" dir="auto">{a.identity?.companyName}</dd></div>
        <div><dt className="text-fg-3">{t("onb.q.industry")}</dt><dd className="text-fg">{labelOf(INDUSTRIES, a.identity?.industry ?? "", locale)} · {labelOf(SIZES, a.identity?.size ?? "", locale)}</dd></div>
        <div><dt className="text-fg-3">{t("onb.q.objectives")}</dt><dd className="text-fg">{(a.business?.objectives ?? []).map((k) => labelOf(OBJECTIVES, k, locale)).join("، ")}</dd></div>
        <div><dt className="text-fg-3">{t("onb.q.challenges")}</dt><dd className="text-fg">{(a.business?.challenges ?? []).map((k) => labelOf(CHALLENGES, k, locale)).join("، ") || "—"}</dd></div>
        <div className="sm:col-span-2"><dt className="text-fg-3">{t("onb.q.functions")}</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">{fns.map(([k, f]) => <Badge key={k} tone={f.status === "internal" ? "success" : f.status === "missing" ? "warning" : "neutral"}>{labelOf(FUNCTIONS, k, locale)} · {labelOf(FUNCTION_STATUSES, f.status ?? "", locale)}</Badge>)}</dd></div>
        <div className="sm:col-span-2"><dt className="text-fg-3">{t("onb.q.priorities")}</dt><dd className="text-fg">{(a.priorities?.ranked ?? []).map((k, i) => `${i + 1}. ${labelOf(PRIORITIES, k, locale)}`).join("  ")}</dd></div>
      </dl>
      {state.canManage && (
        <div className="space-y-3 border-t border-border px-5 py-4">
          {revising && <Field label={t("onb.review.revisionNote")}><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" /></Field>}
          {error && <Alert tone="danger">{error}</Alert>}
          <Button size="lg" onClick={generate} loading={busy} icon={<Sparkles className="size-4" />}>{revising ? t("onb.review.regenerate") : t("onb.review.generate")}</Button>
        </div>
      )}
    </Card>
  );
}

function Done({ record, onRestart, canManage }: { record: BlueprintRecord; onRestart: () => void; canManage: boolean }) {
  const { t, locale } = useT();
  const bi = useBi();
  const r = record.report!;
  const bp = record.blueprint;
  return (
    <div className="space-y-5">
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-success-soft text-success"><CheckCircle2 className="size-6" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-semibold text-fg">{t("onb.done.title")}</h2>
            <p className="mt-1 text-[13.5px] text-fg-2">{t("onb.done.subtitle", { n: r.agents.length, d: bp.departments.length, v: record.version })}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/office"><Button icon={<Building2 className="size-4" />}>{t("onb.done.office")}</Button></Link>
              <Link href="/agents"><Button variant="outline" icon={<Bot className="size-4" />}>{t("onb.done.agents")}</Button></Link>
              {canManage && <Button variant="ghost" onClick={onRestart} icon={<RefreshCcw className="size-4" />}>{t("onb.done.restart")}</Button>}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("onb.bp.agents")} />
          <ul className="divide-y divide-border px-5 pb-3 text-[13px]">
            {r.agents.map((a) => {
              const ag = bp.agents.find((x) => x.key === a.key);
              return (
                <li key={a.slug} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/agents/${a.slug}`} className="font-medium text-fg hover:text-accent"><span dir="rtl">{a.name}</span>{ag && <span className="font-normal text-fg-3"> · {bi(ag.title)}</span>}</Link>
                  <Badge tone={a.action === "created" ? "info" : "neutral"}>{a.action === "created" ? t("onb.bp.creates") : t("onb.bp.reuses")}</Badge>
                </li>
              );
            })}
          </ul>
          {r.deactivated.length > 0 && <p className="border-t border-border px-5 py-3 text-[12.5px] text-fg-3">{t("onb.bp.willDeactivate")}: {r.deactivated.map((d) => d.name).join("، ")}</p>}
        </Card>

        <div className="space-y-5">
          {r.integrationsToConnect.length > 0 && (
            <Card className="p-5">
              <p className="flex items-center gap-2 text-[15px] font-semibold text-fg"><Plug className="size-4 text-accent" />{t("onb.done.connect")}</p>
              <p className="mt-1 text-[13px] text-fg-2">{t("onb.done.connectBody")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {r.integrationsToConnect.map((i) => <Link key={i.key} href="/integrations"><Button size="sm" variant="outline" icon={<ArrowRight className="size-3.5 rtl:rotate-180" />}>{bi(i.name)}</Button></Link>)}
              </div>
            </Card>
          )}
          {bp.workflows.length > 0 && (
            <Card>
              <CardHeader title={t("onb.bp.workflows")} />
              <ul className="space-y-2 px-5 pb-5">
                {bp.workflows.map((w) => (
                  <li key={w.key} className="flex items-center justify-between gap-3 text-[13px]">
                    <div className="min-w-0"><p className="font-medium text-fg">{bi(w.name)}</p><p className="truncate text-fg-3" dir="auto">{bi(w.description)}</p></div>
                    <Link href={`/chat?q=${encodeURIComponent(w.prompt[locale])}`}><Button size="sm" variant="secondary" icon={<Play className="size-3.5" />}>{t("onb.bp.run")}</Button></Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {r.validation.length > 0 && (
            <Card className="p-5">
              <p className="text-[14px] font-medium text-fg">{t("onb.done.validation")}</p>
              <ul className="mt-2 space-y-1 text-[12.5px] text-fg-3">{r.validation.map((v) => <li key={v.slug}><span className="font-mono">{v.slug}</span>: {v.warnings.join("; ")}</li>)}</ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export function OnboardingView() {
  const { t } = useT();
  const { data, error, loading, reload, setData } = useApi<State>("/api/onboarding");
  const [mode, setMode] = useState<"auto" | "wizard" | "summary">("auto");
  const [notice, setNotice] = useState<string | null>(null);

  if (loading && !data) return <LoadingBlock rows={5} />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const s = data!;
  const bp = s.blueprint;
  const pending = bp && ["proposed", "failed"].includes(bp.status);

  let view: "wizard" | "summary" | "review" | "done";
  if (mode === "wizard") view = "wizard";
  else if (mode === "summary") view = "summary";
  else if (pending) view = "review";
  else if (bp?.status === "applied") view = "done";
  else view = s.complete ? "summary" : "wizard";
  if (view === "wizard" && !s.canManage) view = s.complete ? "summary" : "review";

  const header = (
    <PageHeader icon={<Sparkles className="size-5" />} title={t("onb.title")} description={t("onb.subtitle")}
      actions={view === "wizard" && s.canManage && s.status !== "active" ? (
        <Button variant="ghost" onClick={async () => { await api("/api/onboarding/skip", { body: {} }); window.location.href = "/"; }}>{t("onb.skip")}</Button>
      ) : undefined} />
  );

  return (
    <div>
      {header}
      {!s.canManage && <div className="mb-4"><Alert tone="info">{t("onb.viewerNote")}</Alert></div>}
      {notice && <div className="mb-4"><Alert tone="warning">{notice}</Alert></div>}
      {view === "wizard" && <OnboardingWizard state={s} onSaved={(n) => setData({ ...s, ...n })} onFinished={() => { setMode("summary"); void reload(); }} />}
      {view === "summary" && <AnswersSummary state={s} onEdit={() => setMode("wizard")} onGenerated={() => { setMode("auto"); setNotice(null); void reload(); }} />}
      {view === "review" && bp && (
        <BlueprintReview record={bp} profile={s.profile} impact={s.impact} canManage={s.canManage}
          onChanged={(r, n) => { setNotice(n ?? null); if (r) setData({ ...s, blueprint: r }); void reload(); }}
          onApproved={(r) => { setNotice(null); setData({ ...s, blueprint: r, status: "active" }); setMode("auto"); void reload(); }}
          onEditAnswers={() => setMode("wizard")} />
      )}
      {view === "review" && !bp && <Card className="p-6 text-[13px] text-fg-3">{t("onb.bp.nothing")}</Card>}
      {view === "done" && bp && <Done record={bp} canManage={s.canManage} onRestart={() => setMode("summary")} />}
    </div>
  );
}

/** Dashboard entry point: shown until the workforce has been generated (or setup was skipped). */
export function OnboardingCard() {
  const { t } = useT();
  const { data } = useApi<State>("/api/onboarding");
  if (!data || !data.canManage || ["active", "skipped"].includes(data.status)) return null;
  const label = data.status === "proposed" ? t("onb.dash.review") : data.status === "in_progress" ? t("onb.dash.continue") : t("onb.dash.start");
  return (
    <Card className="mb-6 flex flex-col gap-4 border-accent/30 bg-accent-soft/40 p-5 sm:flex-row sm:items-center sm:justify-between" data-testid="onboarding-card">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-white"><Sparkles className="size-5" /></div>
        <div><p className="text-[15px] font-semibold text-fg">{t("onb.dash.title")}</p><p className="mt-0.5 text-[13px] text-fg-2">{t("onb.dash.body")}</p></div>
      </div>
      <Link href="/onboarding"><Button icon={<ArrowRight className="size-4 rtl:rotate-180" />}>{label}</Button></Link>
    </Card>
  );
}
