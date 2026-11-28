"use client";

import { useState } from "react";
import { Building2, CheckCircle2, ChevronDown, HelpCircle, Lock, Plug, Plus, ShieldCheck, Sparkles, Trash2, Workflow, X } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { useT } from "@/components/providers";
import { Alert, Badge, Button, Card, CardHeader, Dialog, Field, Input, Select, Switch, Textarea, cx } from "@/components/ui";
import { ROLES } from "@/lib/onboarding/catalog";
import { FUNCTIONS } from "@/lib/onboarding/schema";
import type { BlueprintAgent, BlueprintEdit, BlueprintRecord, Basis, OperatingProfile } from "@/lib/onboarding/types";
import { OriginBadge, useBi } from "./controls";

export interface Impact {
  reconfigure: Array<{ key: string; slug: string; name: string }>;
  create: Array<{ key: string; name: string }>;
  deactivate: Array<{ slug: string; name: string }>;
  newDepartments: string[];
}

function BasisList({ basis }: { basis: Basis[] }) {
  const { t } = useT();
  const bi = useBi();
  if (!basis.length) return null;
  return (
    <div className="mt-2">
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-fg-3">{t("onb.bp.basis")}</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {basis.map((b) => <li key={b.ref} className="rounded-md bg-surface-2 px-2 py-0.5 text-[12px] text-fg-2" dir="auto">{bi(b.label)}</li>)}
      </ul>
    </div>
  );
}

function AgentCard({ ag, bp, canEdit, edit }: { ag: BlueprintAgent; bp: BlueprintRecord; canEdit: boolean; edit: (e: BlueprintEdit) => Promise<boolean> }) {
  const { t, locale } = useT();
  const bi = useBi();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [duties, setDuties] = useState(ag.customDuties ?? ag.duties.map((d) => d[locale]).join("\n"));
  const sup = ag.supervisorKey === "orchestrator" ? (locale === "ar" ? "راشد" : "Rashed (راشد)") : bp.blueprint.agents.find((x) => x.key === ag.supervisorKey)?.[locale === "ar" ? "nameAr" : "nameEn"];
  return (
    <li className="rounded-xl border border-border bg-surface p-4" data-agent={ag.key}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-fg"><span dir="rtl">{ag.nameAr}</span> <span className="text-fg-3 font-normal">· {ag.nameEn}</span></p>
          <p className="text-[13px] text-fg-2">{bi(ag.title)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <OriginBadge origin={ag.origin} />
          <Badge tone={ag.reuse ? "neutral" : "info"}>{ag.reuse ? t("onb.bp.reuses") : t("onb.bp.creates")}</Badge>
        </div>
      </div>
      <p className="mt-2 text-[13px] text-fg-2" dir="auto"><span className="font-medium text-fg">{t("onb.bp.why")}: </span>{bi(ag.why)}</p>
      <BasisList basis={ag.basis.filter((b) => !b.ref.startsWith("structure."))} />

      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent">
        <ChevronDown className={cx("size-3.5 transition-transform", open && "rotate-180")} /> {t("onb.bp.duties")} · {t("onb.bp.tools")} · {t("onb.bp.boundaries")}
      </button>
      {open && (
        <div className="mt-3 grid gap-3 text-[12.5px] sm:grid-cols-2">
          <div>
            <p className="font-medium text-fg">{t("onb.bp.duties")}</p>
            {editing ? (
              <div className="mt-1 space-y-2">
                <Textarea aria-label={t("onb.bp.editDuties")} rows={4} value={duties} onChange={(e) => setDuties(e.target.value)} dir="auto" />
                <p className="text-fg-3">{t("onb.bp.dutiesHint")}</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={async () => { if (await edit({ op: "update_agent", agent: ag.key, duties })) setEditing(false); }}>{t("onb.bp.save")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t("onb.bp.cancel")}</Button>
                </div>
              </div>
            ) : (
              <ul className="mt-1 list-disc space-y-0.5 ps-4 text-fg-2" dir="auto">
                {(ag.customDuties ? ag.customDuties.split("\n").filter(Boolean) : ag.duties.map((d) => bi(d))).map((d) => <li key={d}>{d}</li>)}
              </ul>
            )}
            <p className="mt-2 font-medium text-fg">{t("onb.bp.reportsTo")}: <span className="font-normal text-fg-2">{sup}</span></p>
          </div>
          <div className="space-y-2">
            <div>
              <p className="font-medium text-fg">{t("onb.bp.risk")}</p>
              {canEdit ? (
                <Select aria-label={`${ag.nameEn} — ${t("onb.bp.risk")}`} className="mt-1 h-8 text-[12.5px]" value={ag.maxRiskLevel}
                  onChange={(e) => edit({ op: "update_agent", agent: ag.key, riskCap: Number(e.target.value) as 1 | 2 | 3 })}>
                  {[1, 2, 3].filter((l) => l <= Math.min(ag.roleRisk, 3)).map((l) => <option key={l} value={l}>L{l} · {t(`onb.bp.levels.${l}`)}</option>)}
                </Select>
              ) : <p className="text-fg-2">L{ag.maxRiskLevel} · {t(`onb.bp.levels.${ag.maxRiskLevel}`)}</p>}
            </div>
            <p><span className="font-medium text-fg">{t("onb.bp.tools")}: </span><span className="font-mono text-[11.5px] text-fg-2">{ag.tools.join(", ")}</span></p>
            {ag.skills.length > 0 && <p><span className="font-medium text-fg">{t("onb.bp.skills")}: </span><span className="text-fg-2">{ag.skills.join(", ")}</span></p>}
            <div>
              <p className="font-medium text-fg">{t("onb.bp.boundaries")}</p>
              <ul className="mt-1 list-disc space-y-0.5 ps-4 text-fg-2" dir="auto">{ag.boundaries.map((b) => <li key={b.en}>{bi(b)}</li>)}</ul>
            </div>
          </div>
        </div>
      )}
      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          <Button size="sm" variant="outline" onClick={() => { setOpen(true); setEditing(true); }}>{t("onb.bp.editDuties")}</Button>
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => edit({ op: "remove_agent", agent: ag.key })} aria-label={`${t("onb.bp.remove")} ${ag.nameEn}`}>{t("onb.bp.remove")}</Button>
        </div>
      )}
    </li>
  );
}

function AddAgent({ edit }: { edit: (e: BlueprintEdit) => Promise<boolean> }) {
  const { t } = useT();
  const bi = useBi();
  const [role, setRole] = useState(ROLES[0].key);
  const def = ROLES.find((r) => r.key === role)!;
  const [fn, setFn] = useState<string>(def.functions[0]);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border p-3">
      <Field label={t("onb.bp.addAgentRole")}>
        <Select aria-label={t("onb.bp.addAgentRole")} value={role} onChange={(e) => { setRole(e.target.value); setFn(ROLES.find((r) => r.key === e.target.value)!.functions[0]); }}>
          {ROLES.map((r) => <option key={r.key} value={r.key}>{bi(r.title)}</option>)}
        </Select>
      </Field>
      <Field label={t("onb.bp.addAgentDept")}>
        <Select aria-label={t("onb.bp.addAgentDept")} value={fn} onChange={(e) => setFn(e.target.value)}>
          {def.functions.map((f) => <option key={f} value={f}>{bi(FUNCTIONS.find((x) => x.key === f)!.label)}</option>)}
        </Select>
      </Field>
      <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => edit({ op: "add_agent", role, function: fn })}>{t("onb.bp.addAgent")}</Button>
    </div>
  );
}

export function BlueprintReview({ record, profile, impact, canManage, onChanged, onApproved, onEditAnswers }: {
  record: BlueprintRecord; profile: OperatingProfile | null; impact: Impact | null; canManage: boolean;
  onChanged: (r: BlueprintRecord | null, notice?: string) => void; onApproved: (r: BlueprintRecord) => void; onEditAnswers: () => void;
}) {
  const { t } = useT();
  const bi = useBi();
  const bp = record.blueprint;
  const canEdit = canManage && record.status === "proposed";
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ key: string; name: string; nameAr: string } | null>(null);

  const edit = async (e: BlueprintEdit): Promise<boolean> => {
    setError(null);
    try {
      const r = await api<{ blueprint: BlueprintRecord }>(`/api/onboarding/blueprints/${record.id}`, { method: "PATCH", body: { edit: e, baseHash: record.hash } });
      onChanged(r.blueprint);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "blueprint_changed") onChanged(null, t("onb.bp.changed"));
      else setError((err as Error).message);
      return false;
    }
  };
  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ blueprint: BlueprintRecord }>(`/api/onboarding/blueprints/${record.id}/approve`, { body: { hash: record.hash } });
      setConfirm(false);
      onApproved(r.blueprint);
    } catch (err) {
      setError((err as Error).message);
      setConfirm(false);
      if (err instanceof ApiError && err.code === "blueprint_changed") onChanged(null, t("onb.bp.changed"));
      else onChanged(null);
    } finally { setBusy(false); }
  };
  const reject = async () => {
    setBusy(true);
    try {
      await api(`/api/onboarding/blueprints/${record.id}/reject`, { body: { note } });
      setRejecting(false);
      onChanged(null);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  const approvalOn = bp.approvals.find((a) => a.key === "modify_records")?.enabled ?? true;

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[19px] font-semibold text-fg">{t("onb.bp.title", { n: record.version })}</h2>
            <p className="mt-1 max-w-2xl text-[13px] text-fg-3">{t("onb.bp.subtitle")}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
              <Badge tone="accent">{bp.agents.length} {t("onb.bp.agents")}</Badge>
              <Badge tone="neutral">{bp.departments.length} {t("onb.bp.departments")}</Badge>
              {record.edits.length > 0 && <Badge tone="info">{t("onb.bp.edits", { n: record.edits.length })}</Badge>}
            </div>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={onEditAnswers}>{t("onb.review.editAnswers")}</Button>
              <Button variant="outline" onClick={() => setRejecting(true)}>{t("onb.bp.rejectAll")}</Button>
              <Button onClick={() => setConfirm(true)} disabled={!bp.agents.length} icon={<CheckCircle2 className="size-4" />}>{t("onb.bp.approve")}</Button>
            </div>
          )}
        </div>
        {record.status === "failed" && record.report?.error && (
          <div className="mt-4"><Alert tone="danger" title={t("onb.done.failed")} action={canManage && <Button size="sm" onClick={() => setConfirm(true)}>{t("onb.done.retry")}</Button>}>{record.report.error}</Alert></div>
        )}
        {error && <div className="mt-4"><Alert tone="danger">{error}</Alert></div>}
      </Card>

      {profile && (
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><Sparkles className="size-4 text-accent" />{t("onb.bp.facts")}</span>} />
          <ul className="space-y-2 px-5 pb-5">
            {profile.facts.map((f) => (
              <li key={f.key} className="flex items-start justify-between gap-3 text-[13px]">
                <span className="text-fg-2" dir="auto">{bi(f.statement)}</span><OriginBadge origin={f.origin} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section aria-labelledby="bp-depts" className="space-y-4">
        <h3 id="bp-depts" className="flex items-center gap-2 text-[15px] font-semibold text-fg"><Building2 className="size-4" />{t("onb.bp.departments")} &amp; {t("onb.bp.agents")}</h3>
        {bp.departments.map((d) => (
          <Card key={d.key} className="p-4" data-department={d.key}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                {renaming?.key === d.key ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <Input aria-label="Department name (English)" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
                    <Input aria-label="Department name (Arabic)" dir="rtl" value={renaming.nameAr} onChange={(e) => setRenaming({ ...renaming, nameAr: e.target.value })} />
                    <Button size="sm" onClick={async () => { if (await edit({ op: "rename_department", department: d.key, name: renaming.name, nameAr: renaming.nameAr })) setRenaming(null); }}>{t("onb.bp.save")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}><X className="size-4" /></Button>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-[15px] font-semibold text-fg">
                    <span className="size-2.5 rounded-full" style={{ background: d.color }} />{bi(d.name)}
                    {d.isNew && <Badge tone="warning">{t("onb.bp.newDept")}</Badge>}
                  </p>
                )}
                <p className="mt-1 text-[13px] text-fg-3" dir="auto">{bi(d.objective)} — {bi(d.why)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <OriginBadge origin={d.origin} />
                {canEdit && <Button size="sm" variant="ghost" onClick={() => setRenaming({ key: d.key, name: d.name.en, nameAr: d.name.ar })}>{t("onb.bp.rename")}</Button>}
                {canEdit && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => edit({ op: "remove_department", department: d.key })} aria-label={`${t("onb.bp.removeDept")} ${d.name.en}`} />}
              </div>
            </div>
            <ul className="mt-3 grid gap-3 lg:grid-cols-2">
              {bp.agents.filter((a) => a.departmentKey === d.key).map((a) => <AgentCard key={`${a.key}-${record.hash}`} ag={a} bp={record} canEdit={canEdit} edit={edit} />)}
            </ul>
          </Card>
        ))}
        {canEdit && <AddAgent edit={edit} />}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><ShieldCheck className="size-4 text-accent" />{t("onb.bp.approvals")}</span>} />
          <ul className="space-y-3 px-5 pb-5">
            {bp.approvals.map((p) => (
              <li key={p.key} className="rounded-xl border border-border p-3" data-approval={p.key}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-fg">{p.locked && <Lock className="size-3.5 text-fg-3" />}{bi(p.label)}</p>
                    <p className="mt-0.5 text-[12.5px] text-fg-2" dir="auto">{bi(p.effect)}</p>
                    <p className="mt-1 text-[11.5px] text-fg-3">{p.locked ? t("onb.bp.locked") : t(`onb.bp.enf.${p.enforcement}`)}</p>
                  </div>
                  <Switch checked={p.enabled} disabled={!canEdit || p.locked} onChange={(v) => edit({ op: "set_approval", approval: p.key, enabled: v })} label={bi(p.label)} />
                </div>
                <BasisList basis={p.basis} />
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><Plug className="size-4 text-accent" />{t("onb.bp.integrations")}</span>} />
            <ul className="space-y-3 px-5 pb-5">
              {bp.integrations.length === 0 && <li className="text-[13px] text-fg-3">{t("onb.bp.nothing")}</li>}
              {bp.integrations.map((i) => (
                <li key={i.key} className="rounded-xl border border-border p-3" data-integration={i.key}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13.5px] font-medium text-fg" dir="auto">{bi(i.name)}</p>
                    {i.status === "available" ? <Badge tone="success">{t("onb.bp.available")}</Badge> : <Badge tone="neutral">{t("onb.bp.notSupported")}</Badge>}
                  </div>
                  <p className="mt-1 text-[12.5px] text-fg-2" dir="auto">{bi(i.why)}</p>
                  {i.status === "available" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {canEdit ? (
                        <div className="inline-flex rounded-lg border border-border p-0.5">
                          {(["accepted", "rejected"] as const).map((d) => (
                            <button key={d} type="button" aria-pressed={i.decision === d} onClick={() => i.decision !== d && edit({ op: "set_integration", integration: i.key, decision: d })}
                              className={cx("rounded-md px-2.5 py-1 text-[12px]", i.decision === d ? "bg-accent text-white" : "text-fg-2")}>{d === "accepted" ? t("onb.bp.accept") : t("onb.bp.reject")}</button>
                          ))}
                        </div>
                      ) : <Badge tone={i.decision === "accepted" ? "success" : "neutral"}>{i.decision === "accepted" ? t("onb.bp.accept") : t("onb.bp.reject")}</Badge>}
                      <span className="text-[12px] text-fg-3">{t("onb.bp.connectLater")}</span>
                      {i.usedBy.length > 0 && <span className="text-[12px] text-fg-3">· {t("onb.bp.usedBy")}: {i.usedBy.map((k) => bp.agents.find((a) => a.key === k)?.nameAr).join("، ")}</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title={<span className="inline-flex items-center gap-2"><Workflow className="size-4 text-accent" />{t("onb.bp.workflows")}</span>} />
            <ul className="space-y-2 px-5 pb-5">
              {bp.workflows.length === 0 && <li className="text-[13px] text-fg-3">{t("onb.bp.nothing")}</li>}
              {bp.workflows.map((w) => (
                <li key={w.key} className="text-[13px]" data-workflow={w.key}>
                  <p className="font-medium text-fg">{bi(w.name)} <span className="font-normal text-fg-3">· {w.agents.map((k) => bp.agents.find((a) => a.key === k)?.nameAr).join(" → ")}</span></p>
                  <p className="text-fg-2" dir="auto">{bi(w.description)}</p>
                  {w.approvals.map((a) => <p key={a.en} className="text-[12px] text-fg-3" dir="auto">• {bi(a)}</p>)}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("onb.bp.outcomes")} />
          <ul className="space-y-1.5 px-5 pb-5 text-[13px]">
            {bp.outcomes.map((o) => <li key={o.text.en} className={cx("flex gap-2", o.covered ? "text-fg-2" : "text-warning")} dir="auto">{o.covered ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> : <HelpCircle className="mt-0.5 size-3.5 shrink-0" />}{bi(o.text)}</li>)}
          </ul>
        </Card>
        <Card>
          <CardHeader title={t("onb.bp.questions")} />
          <ul className="space-y-2 px-5 pb-3 text-[13px]">
            {bp.openQuestions.length === 0 && <li className="text-fg-3">{t("onb.bp.nothing")}</li>}
            {bp.openQuestions.map((q) => <li key={q.key} className="flex items-start justify-between gap-3"><span className="text-fg-2" dir="auto">{bi(q.text)}</span><OriginBadge origin={q.origin} /></li>)}
          </ul>
          {bp.dataPolicy.categories.length > 0 && (
            <div className="border-t border-border px-5 py-3 text-[13px]">
              <p className="font-medium text-fg">{t("onb.bp.dataPolicy")}</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">{bp.dataPolicy.categories.map((c) => <li key={c.key}><Badge tone={c.level === "restricted" ? "danger" : "warning"}>{bi(c.label)} · {c.level}</Badge></li>)}</ul>
              <p className="mt-1 text-[12px] text-fg-3">{bi(bp.dataPolicy.note)}</p>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={confirm} onClose={() => setConfirm(false)} title={t("onb.bp.confirmTitle")} description={t("onb.bp.confirmBody")} size="lg"
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>{t("onb.bp.cancel")}</Button><Button onClick={approve} loading={busy}>{t("onb.bp.approve")}</Button></>}>
        {impact && (
          <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
            {([["onb.bp.willCreate", impact.create.map((x) => x.name)], ["onb.bp.willReconfigure", impact.reconfigure.map((x) => x.name)],
              ["onb.bp.willDeactivate", impact.deactivate.map((x) => x.name)], ["onb.bp.willDepartments", impact.newDepartments.map((k) => bi(bp.departments.find((d) => d.key === k)?.name) || k)]] as const).map(([k, list]) => (
              <div key={k} className="rounded-xl border border-border p-3" data-impact={k}>
                <dt className="font-medium text-fg">{t(k)} ({list.length})</dt>
                <dd className="mt-1 text-fg-2" dir="auto">{list.length ? list.join("، ") : t("onb.bp.nothing")}</dd>
              </div>
            ))}
            <p className="text-fg-2 sm:col-span-2">{t("onb.bp.willSettings", { v: approvalOn ? t("onb.yes") : t("onb.no") })}</p>
          </dl>
        )}
      </Dialog>

      <Dialog open={rejecting} onClose={() => setRejecting(false)} title={t("onb.bp.rejectAll")}
        footer={<><Button variant="ghost" onClick={() => setRejecting(false)}>{t("onb.bp.cancel")}</Button><Button variant="danger" onClick={reject} loading={busy}>{t("onb.bp.rejectAll")}</Button></>}>
        <Field label={t("onb.bp.rejectNote")}><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" /></Field>
      </Dialog>
    </div>
  );
}
