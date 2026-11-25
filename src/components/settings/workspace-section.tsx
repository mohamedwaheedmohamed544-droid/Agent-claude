"use client";

import { useState } from "react";
import { Crown, UserPlus, Users } from "lucide-react";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, ErrorState, Field, Input, LoadingBlock, Select } from "@/components/ui";
import { useApp, type Role } from "@/components/providers";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { useFormat } from "@/components/analytics/format";
import { FeedbackMessage, useFeedback, type SettingsResponse } from "./shared";

export function WorkspaceSection({ data, onSaved }: { data: SettingsResponse; onSaved: () => Promise<void> }) {
  const { t, can, refreshSession } = useApp();
  const admin = can("admin");
  const [name, setName] = useState(data.workspaceName ?? "");
  const [saving, setSaving] = useState(false);
  const [fb, setFb] = useFeedback();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/settings", { method: "PATCH", body: { workspaceName: name.trim() } });
      await Promise.all([onSaved(), refreshSession()]);
      setFb({ tone: "success", text: t("state.saved") });
    } catch (err) {
      setFb({ tone: "danger", text: (err as Error).message });
    } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader title={t("settings.workspace.title")} description={admin ? t("settings.workspace.desc") : t("settings.adminOnlyEdit")} />
      <form onSubmit={save} className="flex flex-col gap-3 px-5 pb-5 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label={t("settings.workspace.name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required disabled={!admin} />
          </Field>
        </div>
        {admin && <Button type="submit" loading={saving} disabled={!name.trim() || name.trim() === data.workspaceName}>{t("action.save")}</Button>}
      </form>
      <FeedbackMessage fb={fb} onDismiss={() => setFb(null)} className="px-5 pb-4" />
    </Card>
  );
}

interface Member { id: string; name: string; email: string; role: Role; joinedAt: string }
const ASSIGNABLE: Role[] = ["admin", "member", "viewer"];

export function MembersSection() {
  const { t, can, session } = useApp();
  const f = useFormat();
  const admin = can("admin");
  const { data, error, loading, reload } = useApi<{ members: Member[] }>("/api/workspaces/members");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [fb, setFb] = useFeedback();

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      await api("/api/workspaces/members", { method: "POST", body: { email: email.trim(), role } });
      setEmail("");
      await reload();
      setFb({ tone: "success", text: t("settings.members.added") });
    } catch (err) {
      setFb({ tone: "danger", text: (err as Error).message });
    } finally { setAdding(false); }
  };

  const changeRole = async (m: Member, r: Role) => {
    setBusy(m.id);
    try {
      await api("/api/workspaces/members", { method: "PATCH", body: { userId: m.id, role: r } });
      await reload();
      setFb({ tone: "success", text: t("settings.members.roleChanged", { name: m.name }) });
    } catch (err) {
      setFb({ tone: "danger", text: (err as Error).message });
    } finally { setBusy(null); }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(removing.id);
    try {
      await api("/api/workspaces/members", { method: "PATCH", body: { userId: removing.id, remove: true } });
      setRemoving(null);
      await reload();
      setFb({ tone: "success", text: t("settings.members.removed") });
    } catch (err) {
      setRemoving(null);
      setFb({ tone: "danger", text: (err as Error).message });
    } finally { setBusy(null); }
  };

  return (
    <Card>
      <CardHeader title={t("settings.members.title")} description={t("settings.members.desc")} />
      <div className="px-5 pb-2"><RoleLegend /></div>
      {admin && (
        <form onSubmit={add} className="flex flex-col gap-2 border-y border-border bg-surface-2/50 px-5 py-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label={t("settings.members.email")} hint={t("settings.members.emailHint")}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@company.com" dir="ltr" autoComplete="off" />
            </Field>
          </div>
          <div className="sm:w-40">
            <Field label={t("settings.members.role")}>
              <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ASSIGNABLE.map((r) => <option key={r} value={r}>{t(`settings.role.${r}`)}</option>)}
              </Select>
            </Field>
          </div>
          <Button type="submit" loading={adding} icon={<UserPlus className="size-4" />} className="sm:mb-[22px]">{t("settings.members.add")}</Button>
        </form>
      )}
      <FeedbackMessage fb={fb} onDismiss={() => setFb(null)} className="px-5 pt-3" />
      {error && !data ? <div className="p-5"><ErrorState error={error} onRetry={reload} /></div> : loading && !data ? <div className="p-5"><LoadingBlock rows={3} /></div> : !data?.members.length ? (
        <EmptyState icon={<Users className="size-5" />} title={t("settings.members.empty")} />
      ) : (
        <ul className="divide-y divide-border">
          {data.members.map((m) => {
            const self = m.id === session.user.id;
            const editable = admin && !self && m.role !== "owner";
            return (
              <li key={m.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-text">
                    {m.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-fg">
                      {m.name}{self && <Badge>{t("settings.members.you")}</Badge>}
                    </p>
                    <p className="truncate text-[12.5px] text-fg-3" dir="ltr">{m.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <span className="hidden text-[12px] text-fg-3 md:inline">{t("settings.members.joined", { date: f.date(m.joinedAt) })}</span>
                  {editable ? (
                    <>
                      <Select value={m.role} disabled={busy === m.id} onChange={(e) => void changeRole(m, e.target.value as Role)}
                        aria-label={t("settings.members.roleFor", { name: m.name })} className="w-32">
                        {ASSIGNABLE.map((r) => <option key={r} value={r}>{t(`settings.role.${r}`)}</option>)}
                      </Select>
                      <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => setRemoving(m)}>{t("settings.members.remove")}</Button>
                    </>
                  ) : (
                    <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{m.role === "owner" && <Crown className="size-3" aria-hidden />}{t(`settings.role.${m.role}`)}</Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={Boolean(removing)} onClose={() => setRemoving(null)} size="sm" title={t("settings.members.removeTitle")}
        footer={<>
          <Button variant="ghost" onClick={() => setRemoving(null)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={Boolean(removing && busy === removing.id)} onClick={remove}>{t("settings.members.remove")}</Button>
        </>}>
        <p className="text-sm text-fg-2">{t("settings.members.removeBody", { name: removing?.name ?? "", email: removing?.email ?? "" })}</p>
      </Dialog>
    </Card>
  );
}

function RoleLegend() {
  const { t } = useApp();
  return (
    <details className="group rounded-xl border border-border px-3 py-2 text-[13px]">
      <summary className="cursor-pointer select-none font-medium text-fg-2">{t("settings.members.rolesExplained")}</summary>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        {(["owner", "admin", "member", "viewer"] as const).map((r) => (
          <div key={r}>
            <dt className="font-medium text-fg">{t(`settings.role.${r}`)}</dt>
            <dd className="text-fg-3">{t(`settings.role.${r}.desc`)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
