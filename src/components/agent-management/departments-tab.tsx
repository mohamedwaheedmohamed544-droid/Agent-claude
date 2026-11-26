"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Building2, ChevronDown, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, LoadingBlock, Select, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { FeedbackMessage, useFeedback } from "@/components/settings/shared";
import { AgentFace, SectionTitle } from "./shared";
import { localDept, localName, type AgentListItem, type AgentListResponse, type DepartmentRecord, type OfficeSettingsResponse } from "./types";

interface DeptForm { name: string; nameAr: string; color: string; managerSlug: string; meetingRoomKey: string }
const EMPTY: DeptForm = { name: "", nameAr: "", color: "#0d9488", managerSlug: "", meetingRoomKey: "" };

/** Departments: create, rename, recolour, manager & meeting room, delete when empty, move agents. */
export function DepartmentsTab() {
  const { t, locale, can } = useApp();
  const admin = can("admin");
  const depts = useApi<{ departments: DepartmentRecord[] }>("/api/departments");
  const agents = useApi<AgentListResponse>("/api/agents?lifecycle=all");
  const office = useApi<OfficeSettingsResponse>("/api/office/settings");
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ edit: DepartmentRecord | null; v: DeptForm } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fb, setFb] = useFeedback();

  const list = useMemo(() => [...(depts.data?.departments ?? [])].sort((a, b) => a.sort - b.sort), [depts.data]);
  const allAgents = useMemo(() => (agents.data?.agents ?? []).filter((a) => a.lifecycle !== "archived"), [agents.data]);
  const rooms = office.data?.layout.meetingRooms ?? [];
  const byDept = useMemo(() => {
    const m = new Map<string, AgentListItem[]>();
    for (const a of allAgents) { const k = a.office?.departmentKey ?? ""; m.set(k, [...(m.get(k) ?? []), a]); }
    return m;
  }, [allAgents]);

  const save = async () => {
    if (!form) return;
    const v = form.v;
    if (!v.name.trim() || !v.nameAr.trim()) { setFormError(t("agents.departments.nameRequired")); return; }
    setBusy("form"); setFormError(null);
    const body = { name: v.name.trim(), nameAr: v.nameAr.trim(), color: v.color, managerSlug: v.managerSlug || null, meetingRoomKey: v.meetingRoomKey || null };
    try {
      if (form.edit) await api(`/api/departments/${encodeURIComponent(form.edit.key)}`, { method: "PATCH", body });
      else await api("/api/departments", { body });
      setFb({ tone: "success", text: t(form.edit ? "agents.departments.updated" : "agents.departments.created", { name: locale === "ar" ? body.nameAr : body.name }) });
      setForm(null);
      await depts.reload();
    } catch (err) { setFormError((err as Error).message); } finally { setBusy(null); }
  };

  const remove = async (d: DepartmentRecord) => {
    if (!window.confirm(t("agents.departments.deleteConfirm", { name: localDept(d, locale) }))) return;
    setBusy(d.key);
    try {
      await api(`/api/departments/${encodeURIComponent(d.key)}`, { method: "DELETE" });
      setFb({ tone: "success", text: t("agents.departments.deleted", { name: localDept(d, locale) }) });
      await depts.reload();
    } catch (err) { setFb({ tone: "danger", text: (err as Error).message }); } finally { setBusy(null); }
  };

  const move = async (a: AgentListItem, departmentKey: string) => {
    if (!departmentKey || departmentKey === a.office.departmentKey) return;
    setBusy(`move:${a.slug}`);
    try {
      await api(`/api/agents/${encodeURIComponent(a.slug)}`, { method: "PATCH", body: { config: { office: { ...a.office, departmentKey } }, changeNote: `Moved to department ${departmentKey}` } });
      const target = list.find((d) => d.key === departmentKey);
      setFb({ tone: "success", text: t("agents.departments.moved", { name: localName(a, locale), dept: localDept(target, locale) }) });
      await Promise.all([agents.reload(), depts.reload()]);
    } catch (err) { setFb({ tone: "danger", text: (err as Error).message }); } finally { setBusy(null); }
  };

  const setV = (patch: Partial<DeptForm>) => setForm((f) => (f ? { ...f, v: { ...f.v, ...patch } } : f));

  return (
    <Card className="p-5">
      <SectionTitle title={t("agents.departments.title")} description={t("agents.departments.subtitle")}
        actions={admin ? <Button icon={<Plus className="size-4" />} onClick={() => { setFormError(null); setForm({ edit: null, v: EMPTY }); }}>{t("agents.departments.create")}</Button> : undefined} />
      <FeedbackMessage fb={fb} onDismiss={() => setFb(null)} className="mb-3" />
      {depts.error ? <ErrorState error={depts.error} onRetry={depts.reload} />
        : depts.loading && !depts.data ? <LoadingBlock rows={4} />
          : list.length === 0 ? <EmptyState icon={<Building2 className="size-5" />} title={t("agents.departments.empty")} />
            : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {list.map((d) => {
                  const members = byDept.get(d.key) ?? [];
                  const manager = allAgents.find((a) => a.slug === d.managerSlug);
                  const room = rooms.find((r) => r.key === d.meetingRoomKey);
                  const expanded = open === d.key;
                  const exec = d.kind === "executive";
                  return (
                    <li key={d.key}>
                      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <span className="size-3 shrink-0 rounded-full" style={{ background: d.color }} aria-hidden />
                        <button type="button" onClick={() => setOpen(expanded ? null : d.key)} aria-expanded={expanded}
                          className="flex min-w-0 flex-1 items-center gap-2 text-start">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-fg"><span dir="rtl" lang="ar">{d.nameAr}</span> <span className="text-fg-3">·</span> <span dir="ltr">{d.name}</span></p>
                            <p className="truncate text-[12.5px] text-fg-3">
                              {t("agents.departments.agentCount", { n: d.agentCount })}
                              {manager && <> · {t("agents.departments.managerIs", { name: localName(manager, locale) })}</>}
                              {room && <> · {locale === "ar" ? room.nameAr : room.name}</>}
                            </p>
                          </div>
                          <ChevronDown className={cx("ms-auto size-4 shrink-0 text-fg-3 transition-transform", expanded && "rotate-180")} aria-hidden />
                        </button>
                        {exec && <Badge tone="accent"><Shield className="size-3" />{t("agents.departments.executive")}</Badge>}
                        {admin && (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" aria-label={t("agents.departments.editNamed", { name: localDept(d, locale) })}
                              onClick={() => { setFormError(null); setForm({ edit: d, v: { name: d.name, nameAr: d.nameAr, color: d.color, managerSlug: d.managerSlug ?? "", meetingRoomKey: d.meetingRoomKey ?? "" } }); }}>
                              <Pencil className="size-4" />
                            </Button>
                            <Button size="icon" variant="ghost" aria-label={t("agents.departments.deleteNamed", { name: localDept(d, locale) })}
                              disabled={exec || d.agentCount > 0} loading={busy === d.key}
                              title={exec ? t("agents.departments.execProtected") : d.agentCount > 0 ? t("agents.departments.notEmpty") : undefined}
                              onClick={() => void remove(d)}>
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                      {expanded && (
                        <div className="border-t border-border bg-surface-2/40 px-4 py-3">
                          {members.length === 0 ? <p className="text-[13px] text-fg-3">{t("agents.departments.noAgents")}</p> : (
                            <ul className="space-y-2">
                              {members.map((a) => (
                                <li key={a.slug} className="flex flex-wrap items-center gap-3">
                                  <AgentFace color={a.color} appearance={a.office?.appearance} name={a.nameEn} size="sm" />
                                  <Link href={`/agents/${a.slug}`} className="min-w-0 flex-1 truncate text-sm font-medium text-fg hover:underline">{localName(a, locale)}</Link>
                                  {admin && !a.isOrchestrator && (
                                    <Select value="" disabled={busy === `move:${a.slug}`} onChange={(e) => void move(a, e.target.value)}
                                      aria-label={t("agents.departments.moveNamed", { name: localName(a, locale) })} className="w-full sm:w-56">
                                      <option value="">{t("agents.departments.moveTo")}</option>
                                      {list.filter((x) => x.key !== d.key).map((x) => <option key={x.key} value={x.key}>{localDept(x, locale)}</option>)}
                                    </Select>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

      <Dialog open={!!form} onClose={() => setForm(null)} title={form?.edit ? t("agents.departments.editTitle") : t("agents.departments.createTitle")}
        footer={<>
          <Button variant="ghost" onClick={() => setForm(null)}>{t("action.cancel")}</Button>
          <Button loading={busy === "form"} onClick={() => void save()}>{t("action.save")}</Button>
        </>}>
        {form && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("agents.departments.nameAr")}><Input dir="rtl" value={form.v.nameAr} onChange={(e) => setV({ nameAr: e.target.value })} /></Field>
              <Field label={t("agents.departments.nameEn")}><Input dir="ltr" value={form.v.name} onChange={(e) => setV({ name: e.target.value })} /></Field>
            </div>
            <Field label={t("agents.departments.color")}>
              <div className="flex items-center gap-2">
                <input type="color" value={form.v.color} onChange={(e) => setV({ color: e.target.value })} aria-label={t("agents.departments.color")}
                  className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-surface p-1" />
                <Input dir="ltr" value={form.v.color} onChange={(e) => setV({ color: e.target.value })} className="w-32 font-mono" aria-label={t("agents.departments.colorHex")} />
              </div>
            </Field>
            <Field label={t("agents.departments.manager")}>
              <Select value={form.v.managerSlug} onChange={(e) => setV({ managerSlug: e.target.value })}>
                <option value="">{t("agents.departments.noManager")}</option>
                {allAgents.map((a) => <option key={a.slug} value={a.slug}>{localName(a, locale)}</option>)}
              </Select>
            </Field>
            <Field label={t("agents.departments.meetingRoom")} hint={rooms.length ? undefined : t("agents.departments.noRooms")}>
              <Select value={form.v.meetingRoomKey} onChange={(e) => setV({ meetingRoomKey: e.target.value })}>
                <option value="">{t("agents.departments.anyRoom")}</option>
                {rooms.map((r) => <option key={r.key} value={r.key}>{locale === "ar" ? r.nameAr : r.name}</option>)}
              </Select>
            </Field>
            {formError && <Alert tone="danger">{formError}</Alert>}
          </div>
        )}
      </Dialog>
    </Card>
  );
}
