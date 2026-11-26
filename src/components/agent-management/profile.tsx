"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity, ArrowLeft, Check, CheckCircle2, MapPin, MessageSquare, Pencil, Power, Users, X,
} from "lucide-react";
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, LoadingBlock, RiskBadge, Stat, StatusBadge, Table, Tabs, Td, Th, cx,
} from "@/components/ui";
import { useApp } from "@/components/providers";
import { timeAgo, useApi } from "@/lib/client/hooks";
import { successRate, tOr, useFormat } from "@/components/analytics/format";
import { ApprovalLevels } from "@/components/agents/approval-levels";
import { AVATAR_BY_KEY } from "@/lib/office/avatars";
import { useAgentActions } from "./agent-actions";
import { ActionMenu, AgentFace, ChipRow, LifecycleBadge, PresenceBadge } from "./shared";
import { ValidationList } from "./config-summary";
import { localDept, localName, localRole, localSkill, type AgentDetail, type AgentListResponse } from "./types";

const TABS = ["overview", "instructions", "skills", "tools", "permissions", "memory", "tasks", "conversations", "meetings", "performance", "activity", "office", "versions"] as const;
type Tab = (typeof TABS)[number];

/** Agent profile (/agents/:slug): live header, lifecycle actions and every facet of the agent in tabs. */
export function AgentProfile({ slug }: { slug: string }) {
  const { t, locale, can } = useApp();
  const admin = can("admin");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data, error, loading, reload } = useApi<AgentDetail>(`/api/agents/${encodeURIComponent(slug)}`, { intervalMs: 15_000 });
  const roster = useApi<AgentListResponse>("/api/agents?lifecycle=all");
  const [tab, setTab] = useState<Tab>("overview");
  const created = params.get("created");
  const saved = params.get("saved");
  const [notice, setNotice] = useState<"created" | "draft" | "saved" | "activated" | null>(
    created === "active" || created === "1" ? "created" : created === "draft" ? "draft" : saved === "active" ? "activated" : saved ? "saved" : null,
  );
  const actions = useAgentActions({
    onChanged: (action) => {
      if (action === "delete") router.push("/agents");
      else void reload();
    },
  });

  const dismiss = () => { setNotice(null); router.replace(pathname, { scroll: false }); };

  if (error && !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState error={error} onRetry={reload} />
      </div>
    );
  }
  if (loading && !data) return <LoadingBlock rows={6} />;
  if (!data) return null;

  const a = data.agent;
  const names = new Map((roster.data?.agents ?? []).map((x) => [x.slug, localName(x, locale)]));
  const nameOf = (s: string) => names.get(s) ?? s;
  const preset = AVATAR_BY_KEY.get(a.office.avatarPreset);

  return (
    <div className="space-y-5">
      <BackLink />

      {notice && (
        <Alert tone={notice === "draft" ? "info" : "success"}
          title={t(`agents.profile.notice.${notice}`)}
          action={<button type="button" onClick={dismiss} aria-label={t("action.close")} className="opacity-70 hover:opacity-100"><X className="size-4" /></button>}>
          {notice === "created" || notice === "activated" ? (
            a.office.visible ? <Link href={`/office?agent=${encodeURIComponent(a.slug)}`} className="font-medium underline">{t("agents.profile.notice.openOffice")}</Link> : t("agents.profile.notice.hidden")
          ) : notice === "draft" ? t("agents.profile.notice.draftBody") : null}
        </Alert>
      )}
      {actions.feedback}

      {/* Header */}
      <Card className="overflow-hidden">
        <div className="h-20" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${a.color} 38%, transparent), color-mix(in srgb, ${data.department?.color ?? a.color} 12%, transparent))` }} aria-hidden />
        <div className="-mt-12 flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end">
          <AgentFace color={a.color} appearance={a.office.appearance} name={a.nameEn} size="xl" className={cx("shadow-card", a.lifecycle !== "active" && "grayscale-[60%]")} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold leading-tight text-fg" dir="rtl" lang="ar">{a.nameAr || a.nameEn}</h1>
            <p className="text-sm text-fg-2"><span dir="ltr">{a.nameEn}</span> · <span className="font-mono text-[12.5px] text-fg-3" dir="ltr">{a.slug}</span></p>
            <p className="mt-1 text-[14px] font-medium text-fg-2">{localRole(a, locale)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {a.isOrchestrator && <Badge tone="accent">{t("agents.orchestrator")}</Badge>}
              <LifecycleBadge lifecycle={a.lifecycle} />
              <PresenceBadge presence={data.presence} lifecycle={a.lifecycle} />
              {data.department && <Badge tone="neutral"><span className="size-2 rounded-full" style={{ background: data.department.color }} aria-hidden />{localDept(data.department, locale)}</Badge>}
              <Badge tone="neutral">v{a.version}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {admin && a.lifecycle !== "archived" && (
              <Link href={`/agents/${a.slug}/edit`} className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-card hover:bg-accent-hover">
                <Pencil className="size-4" />{t("agents.actions.edit")}
              </Link>
            )}
            {admin && (a.lifecycle === "inactive" || a.lifecycle === "draft") && (
              <Button variant="outline" icon={<Power className="size-4" />} onClick={() => actions.run("activate", a)}>{t("agents.actions.activate")}</Button>
            )}
            <ActionMenu label={t("agents.actions.menu", { name: localName(a, locale) })} items={actions.items(a, { exclude: ["view", "edit"] })} />
          </div>
        </div>
        {data.presence && a.lifecycle === "active" && (data.presence.activity || data.presence.taskTitle) && (
          <div className="flex items-center gap-2 border-t border-border bg-surface-2/50 px-5 py-2.5 text-[13px] text-fg-2">
            <Activity className="size-4 shrink-0 text-accent" aria-hidden />
            <span className="truncate">{data.presence.activity ?? data.presence.taskTitle}</span>
            {data.presence.taskId && <Link href={`/tasks/${data.presence.taskId}`} className="ms-auto shrink-0 text-accent-text hover:underline">{t("agents.profile.openTask")}</Link>}
          </div>
        )}
      </Card>

      <Tabs<Tab> value={tab} onChange={setTab} className="w-full" items={TABS.map((k) => ({
        value: k, label: t(`agents.profile.tab.${k}`),
        count: k === "skills" ? data.skills.length : k === "tools" ? data.effectiveTools.filter((x) => x.allowed).length : k === "tasks" ? data.tasks.length : k === "versions" ? data.versions.length : undefined,
      }))} />

      <div role="tabpanel" aria-label={t(`agents.profile.tab.${tab}`)}>
        {tab === "overview" && (
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Card className="p-5">
              <Block title={t("agents.profile.description")}>
                <p className="whitespace-pre-line text-sm leading-relaxed text-fg-2">{(locale === "ar" ? a.descriptionAr || a.description : a.description || a.descriptionAr) || "—"}</p>
              </Block>
              <Block title={t("agents.builder.resp.main")}><p className="text-sm leading-relaxed text-fg-2">{a.responsibilities.main || "—"}</p></Block>
              {a.responsibilities.expertise.length > 0 && <Block title={t("agents.builder.resp.expertise")}><ChipRow items={a.responsibilities.expertise} max={20} /></Block>}
              {a.responsibilities.deliverables.length > 0 && <Block title={t("agents.builder.resp.deliverables")}><Bullets items={a.responsibilities.deliverables} /></Block>}
              {a.responsibilities.methodology && <Block title={t("agents.builder.resp.methodology")}><p className="whitespace-pre-line text-sm leading-relaxed text-fg-2">{a.responsibilities.methodology}</p></Block>}
              {a.responsibilities.successCriteria.length > 0 && <Block title={t("agents.builder.resp.success")}><Bullets items={a.responsibilities.successCriteria} /></Block>}
              {a.personality && <Block title={t("agents.builder.personality")}><p className="text-sm leading-relaxed text-fg-2">{a.personality}</p></Block>}
            </Card>
            <div className="space-y-5">
              <Card className="p-5">
                <Block title={t("agents.builder.section.relationships")}>
                  <dl className="space-y-2 text-[13px]">
                    <Row label={t("agents.builder.rel.supervisor")}>{a.relationships.supervisor ? <AgentLink slug={a.relationships.supervisor} name={nameOf(a.relationships.supervisor)} /> : "—"}</Row>
                    <Row label={t("agents.builder.rel.delegatesTo")}>{a.relationships.delegatesTo.length ? a.relationships.delegatesTo.map((s, i) => <span key={s}>{i > 0 && "، "}<AgentLink slug={s} name={nameOf(s)} /></span>) : "—"}</Row>
                    <Row label={t("agents.builder.rel.collaboratesWith")}>{a.relationships.collaboratesWith.length ? a.relationships.collaboratesWith.map((s, i) => <span key={s}>{i > 0 && "، "}<AgentLink slug={s} name={nameOf(s)} /></span>) : "—"}</Row>
                    <Row label={t("agents.builder.rel.canJoinMeetings")}><YesNo v={a.relationships.canJoinMeetings} /></Row>
                    <Row label={t("agents.builder.rel.canInitiate")}><YesNo v={a.relationships.canInitiateCollaboration} /></Row>
                  </dl>
                </Block>
              </Card>
              <Card className="p-5">
                <Block title={t("agents.profile.currentTask")}>
                  {data.presence?.taskId ? (
                    <Link href={`/tasks/${data.presence.taskId}`} className="text-sm text-accent-text hover:underline">{data.presence.taskTitle ?? data.presence.taskId}</Link>
                  ) : <p className="text-sm text-fg-3">{t("agents.profile.noCurrentTask")}</p>}
                </Block>
                <Block title={t("agents.builder.section.ai")}>
                  <dl className="space-y-2 text-[13px]">
                    <Row label={t("agents.builder.ai.modelLabel")}><span className="font-mono" dir="ltr">{a.ai.model ?? t("agents.builder.ai.default")}</span></Row>
                    <Row label={t("agents.builder.ai.tier")}>{t(`agents.tier.${a.ai.tier}`)}</Row>
                  </dl>
                </Block>
              </Card>
              {(data.validation.errors.length > 0 || data.validation.warnings.length > 0) && (
                <Card className="p-5"><Block title={t("agents.builder.preview.validation")}><ValidationList errors={data.validation.errors} warnings={data.validation.warnings} /></Block></Card>
              )}
            </div>
          </div>
        )}

        {tab === "instructions" && (
          <div className="space-y-5">
            <Card>
              <CardHeader title={t("agents.profile.promptPreview")} description={t("agents.profile.promptPreviewDesc", { v: data.runtime.version })}
                actions={data.runtime.cachedAt ? <span className="text-xs text-fg-3">{t("agents.profile.cachedAt", { time: timeAgo(data.runtime.cachedAt, t) })}</span> : undefined} />
              <pre className="mx-5 mb-5 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-surface-2 p-4 font-mono text-[12.5px] leading-relaxed text-fg-2" dir="auto" tabIndex={0}>
                {data.runtime.systemPromptPreview || "—"}
              </pre>
            </Card>
            <Card>
              <CardHeader title={t("agents.builder.resp.instructions")} />
              <p className="whitespace-pre-line px-5 pb-4 text-sm leading-relaxed text-fg-2">{a.responsibilities.instructions || "—"}</p>
              <CardHeader title={t("agents.builder.ai.systemInstructions")} className="border-t border-border" />
              <pre className="mx-5 mb-5 whitespace-pre-wrap rounded-xl bg-surface-2 p-3 font-mono text-[12.5px] text-fg-2">{a.ai.systemInstructions || "—"}</pre>
            </Card>
          </div>
        )}

        {tab === "skills" && (
          <Card className="p-5">
            <Alert tone="info">{t("agents.skills.grantNote")}</Alert>
            {(data.validation.missingTools.length > 0 || data.validation.missingSkills.length > 0) && (
              <div className="mt-3">
                <Alert tone="warning" title={t("agents.builder.skills.missingTitle")}>
                  {data.validation.missingTools.length > 0 && <p>{t("agents.builder.skills.missingTools", { list: data.validation.missingTools.join(", ") })}</p>}
                  {data.validation.missingSkills.length > 0 && <p>{t("agents.builder.skills.missingSkills", { list: data.validation.missingSkills.join(", ") })}</p>}
                </Alert>
              </div>
            )}
            {data.skills.length === 0 ? <EmptyState title={t("agents.builder.skills.none")} /> : (
              <ul className="mt-4 grid gap-3 md:grid-cols-2">
                {data.skills.map((s) => {
                  const mandatory = a.skills.find((x) => x.key === s.key)?.mandatory;
                  const missTools = s.requiredTools.filter((x) => !a.tools.includes(x));
                  const missDeps = s.dependsOn.filter((x) => !a.skills.some((y) => y.key === x));
                  const ok = !missTools.length && !missDeps.length;
                  return (
                    <li key={s.key} className="rounded-xl border border-border p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-fg">{localSkill(s, locale)}</p>
                        {mandatory && <Badge tone="accent">{t("agents.builder.skills.mandatory")}</Badge>}
                        <Badge tone={ok ? "success" : "warning"}>{ok ? t("agents.builder.skills.depsOk") : t("agents.builder.skills.depsMissing")}</Badge>
                      </div>
                      <p className="mt-1 text-[13px] text-fg-2">{s.description}</p>
                      {s.requiredTools.length > 0 && (
                        <p className="mt-2 text-[12px] text-fg-3">{t("agents.skills.requiresTools")}: {s.requiredTools.map((x) => (
                          <span key={x} className={cx("me-1 font-mono", missTools.includes(x) && "text-warning")} dir="ltr">{x}</span>
                        ))}</p>
                      )}
                      {missDeps.length > 0 && <p className="mt-1 text-[12px] text-warning">{t("agents.builder.skills.missingSkills", { list: missDeps.join(", ") })}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}

        {tab === "tools" && (
          <Card>
            <CardHeader title={t("agents.profile.effectiveTools")} description={t("agents.profile.effectiveToolsDesc")} />
            {data.effectiveTools.length === 0 ? <EmptyState title={t("agents.tools.none")} /> : (
              <Table>
                <thead><tr><Th>{t("agents.tools.name")}</Th><Th>{t("agents.tools.risk")}</Th><Th>{t("agents.profile.access")}</Th><Th>{t("agents.tools.approval")}</Th></tr></thead>
                <tbody>
                  {[...data.effectiveTools].sort((x, y) => Number(y.allowed) - Number(x.allowed) || x.riskLevel - y.riskLevel).map((x) => (
                    <tr key={x.name} className={cx(!x.allowed && "opacity-70")}>
                      <Td><p className="font-mono text-[13px] text-fg" dir="ltr">{x.name}</p><p className="mt-0.5 max-w-md text-[12px] text-fg-3">{x.description}</p></Td>
                      <Td><RiskBadge level={x.riskLevel} /></Td>
                      <Td>{x.allowed ? <Badge tone="success"><Check className="size-3" />{t("agents.profile.allowed")}</Badge>
                        : <span className="block max-w-xs"><Badge tone="danger">{t("agents.profile.blocked")}</Badge>{x.reason && <span className="mt-1 block text-[12px] text-fg-3">{x.reason}</span>}</span>}</Td>
                      <Td>{x.allowed ? (x.requiresApproval ? <Badge tone={x.riskLevel >= 4 ? "danger" : "warning"}>{x.riskLevel >= 4 ? t("agents.approval.always") : t("agents.approval.required")}</Badge> : <Badge tone="success">{t("agents.approval.none")}</Badge>) : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}

        {tab === "permissions" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-5">
              <dl className="space-y-3 text-sm">
                <Row label={t("agents.builder.perm.maxRisk")}><RiskBadge level={a.permissions.maxRiskLevel} /></Row>
                <Row label={t("agents.builder.perm.alwaysApprove")}><YesNo v={a.permissions.alwaysApproveModify} /></Row>
                <Row label={t("agents.builder.perm.memoryAccess")}>{t(`agents.builder.perm.memory.${a.permissions.memoryAccess}`)}</Row>
                <Row label={t("agents.builder.perm.restricted")}>
                  {a.permissions.restrictedCategories.length ? a.permissions.restrictedCategories.map((x) => <Badge key={x} tone="danger" className="me-1">{tOr(t, `agents.category.${x}`, x)}</Badge>) : "—"}
                </Row>
              </dl>
              <div className="mt-4"><Alert tone="warning" title={t("agents.builder.perm.l4Title")}>{t("agents.builder.perm.l4Body")}</Alert></div>
            </Card>
            <Card className="p-5"><p className="mb-3 text-[14px] font-semibold text-fg">{t("agents.levels.title")}</p><ApprovalLevels compact /></Card>
          </div>
        )}

        {tab === "memory" && (
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap gap-1.5 text-[12.5px]">
              <Badge tone={a.ai.memory.useWorkspaceMemory ? "success" : "neutral"}>{t("agents.builder.ai.useWorkspaceMemory")}: {a.ai.memory.useWorkspaceMemory ? t("agents.common.on") : t("agents.common.off")}</Badge>
              <Badge tone={a.ai.memory.useAgentMemory ? "success" : "neutral"}>{t("agents.builder.ai.useAgentMemory")}: {a.ai.memory.useAgentMemory ? t("agents.common.on") : t("agents.common.off")}</Badge>
              <Badge tone={a.ai.memory.useKnowledgeBase ? "success" : "neutral"}>{t("agents.builder.ai.useKnowledgeBase")}: {a.ai.memory.useKnowledgeBase ? t("agents.common.on") : t("agents.common.off")}</Badge>
              <Badge tone="neutral">{t("agents.builder.ai.maxContext")}: {a.ai.memory.maxContextTokens}</Badge>
            </div>
            {data.memory.length === 0 ? <EmptyState title={t("agents.profile.noMemory")} /> : (
              <ul className="divide-y divide-border">
                {data.memory.map((m) => (
                  <li key={m.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-fg-3"><Badge tone="neutral">{m.kind}</Badge><Badge tone="neutral">{m.scope}</Badge><span>{timeAgo(m.createdAt, t)}</span></div>
                    <p className="mt-1 whitespace-pre-line text-sm text-fg-2">{m.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {tab === "tasks" && (
          <Card>
            {data.tasks.length === 0 ? <EmptyState title={t("agents.profile.noTasks")} /> : (
              <Table>
                <thead><tr><Th>{t("agents.profile.task")}</Th><Th>{t("agents.profile.step")}</Th><Th>{t("agents.profile.status")}</Th><Th>{t("agents.profile.updated")}</Th></tr></thead>
                <tbody>
                  {data.tasks.map((x, i) => (
                    <tr key={`${x.taskId}-${i}`}>
                      <Td><Link href={`/tasks/${x.taskId}`} className="text-accent-text hover:underline">{x.taskTitle}</Link></Td>
                      <Td>{x.stepTitle}</Td><Td><StatusBadge status={x.status} /></Td><Td className="whitespace-nowrap">{timeAgo(x.updatedAt, t)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}

        {tab === "conversations" && (
          <Card>
            {data.conversations.length === 0 ? <EmptyState icon={<MessageSquare className="size-5" />} title={t("agents.profile.noConversations")} /> : (
              <ul className="divide-y divide-border">
                {data.conversations.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <Link href={`/chat/${x.id}`} className="min-w-0 truncate text-sm text-accent-text hover:underline">{x.title || "—"}</Link>
                    <span className="shrink-0 text-xs text-fg-3">{timeAgo(x.updatedAt, t)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {tab === "meetings" && (
          <Card>
            {data.meetings.length === 0 ? <EmptyState icon={<Users className="size-5" />} title={t("agents.profile.noMeetings")} /> : (
              <ul className="divide-y divide-border">
                {data.meetings.map((m) => (
                  <li key={m.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{m.objective}</p>
                      <StatusBadge status={m.status === "in_progress" ? "running" : m.status} />
                    </div>
                    <p className="mt-1 text-[12.5px] text-fg-3">
                      {t("agents.profile.meetingMeta", { n: m.participants.length, messages: m.messageCount })}
                      {m.startedAt && <> · {timeAgo(m.startedAt, t)}</>}
                      {m.taskId && <> · <Link href={`/tasks/${m.taskId}`} className="text-accent-text hover:underline">{m.taskTitle ?? t("agents.profile.task")}</Link></>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {tab === "performance" && <Performance data={data} />}

        {tab === "activity" && (
          <Card>
            {data.activity.length === 0 ? <EmptyState icon={<Activity className="size-5" />} title={t("agents.profile.noActivity")} /> : (
              <ol className="divide-y divide-border">
                {[...data.activity].reverse().map((e) => (
                  <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-fg-2">{e.summary}</p>
                      <p className="mt-0.5 text-[12px] text-fg-3">
                        {tOr(t, `agents.event.${e.type}`, e.type)} · {timeAgo(e.createdAt, t)}
                        {e.taskId && <> · <Link href={`/tasks/${e.taskId}`} className="text-accent-text hover:underline">{t("agents.profile.task")}</Link></>}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        )}

        {tab === "office" && (
          <Card className="p-5">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Row label={t("agents.builder.office.department")}>{data.department ? localDept(data.department, locale) : a.office.departmentKey || "—"}</Row>
              <Row label={t("agents.profile.workstation")}>{data.workstation ? t("agents.profile.deskN", { n: data.workstation.index + 1 }) : t("agents.profile.noDesk")}</Row>
              <Row label={t("agents.builder.office.animation")}>{t(`agents.builder.office.anim.${a.office.defaultAnimation}`)}</Row>
              <Row label={t("agents.builder.office.meetingRoom")}>{a.office.preferredMeetingRoom ?? t("agents.departments.anyRoom")}</Row>
              <Row label={t("agents.builder.office.visible")}><YesNo v={a.office.visible} /></Row>
              <Row label={t("agents.builder.identity.avatar")}>{preset ? (locale === "ar" ? preset.labelAr : preset.label) : t("agents.builder.avatar.custom")}</Row>
            </dl>
            {a.lifecycle !== "active" && <div className="mt-4"><Alert tone="info">{t("agents.profile.notInOffice")}</Alert></div>}
            {a.lifecycle === "active" && a.office.visible && (
              <Link href={`/office?agent=${encodeURIComponent(a.slug)}`} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3.5 text-sm font-medium text-fg hover:bg-surface-2">
                <MapPin className="size-4" />{t("agents.profile.showInOffice")}
              </Link>
            )}
          </Card>
        )}

        {tab === "versions" && (
          <Card>
            {data.versions.length === 0 ? <EmptyState title={t("agents.profile.noVersions")} /> : (
              <ol className="divide-y divide-border">
                {[...data.versions].sort((x, y) => y.version - x.version).map((v) => (
                  <li key={v.version} className="flex flex-wrap items-start gap-3 px-5 py-3">
                    <Badge tone={v.version === a.version ? "accent" : "neutral"}>v{v.version}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-fg-2">{v.changeNote || <span className="text-fg-3">{t("agents.profile.noChangeNote")}</span>}</p>
                      <p className="mt-0.5 text-[12px] text-fg-3">{v.createdByName ?? "—"} · {timeAgo(v.createdAt, t)}</p>
                    </div>
                    {v.version === a.version && <Badge tone="success"><CheckCircle2 className="size-3" />{t("agents.profile.current")}</Badge>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        )}
      </div>
      {actions.element}
    </div>
  );
}

function Performance({ data }: { data: AgentDetail }) {
  const { t } = useApp();
  const f = useFormat();
  const s = data.stats;
  const rate = s ? successRate(s.completed, s.failed) : null;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("agents.stat.runs")} value={f.num(s?.runs ?? 0)} hint={s ? t("agents.stat.runsHint", { c: s.completed, f: s.failed }) : undefined} />
        <Stat label={t("agents.stat.success")} value={f.pct(rate)} tone="success" />
        <Stat label={t("agents.stat.avgDuration")} value={f.ms(s?.avgMs ?? null)} tone="info" />
        <Stat label={t("agents.stat.lastRun")} value={<span className="text-lg">{s?.lastRun ? timeAgo(s.lastRun, t) : "—"}</span>} tone="neutral" />
      </div>
      <Card>
        <CardHeader title={t("agents.profile.toolUsage")} />
        {data.toolUsage.length === 0 ? <EmptyState title={t("agents.profile.noToolUsage")} /> : (
          <Table>
            <thead><tr><Th>{t("agents.tools.name")}</Th><Th className="text-end">{t("agents.tools.calls")}</Th><Th className="text-end">{t("agents.stat.success")}</Th></tr></thead>
            <tbody>
              {data.toolUsage.map((u) => (
                <tr key={u.tool}><Td><span className="font-mono text-[13px]" dir="ltr">{u.tool}</span></Td><Td className="text-end tabular-nums">{f.num(u.calls)}</Td><Td className="text-end tabular-nums">{f.pct(u.calls ? u.succeeded / u.calls : null)}</Td></tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {data.recentSteps.length > 0 && (
        <Card>
          <CardHeader title={t("agents.profile.recentSteps")} />
          <ul className="divide-y divide-border">
            {data.recentSteps.map((st) => (
              <li key={st.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">{st.title}</p>
                  <Link href={`/tasks/${st.taskId}`} className="truncate text-[12px] text-accent-text hover:underline">{st.taskTitle}</Link>
                </div>
                <StatusBadge status={st.status} />
                <span className="text-xs text-fg-3">{timeAgo(st.completedAt ?? st.startedAt, t)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function BackLink() {
  const { t } = useApp();
  return <Link href="/agents" className="inline-flex items-center gap-1 text-[13px] text-fg-3 hover:text-fg"><ArrowLeft className="size-3.5 rtl:rotate-180" />{t("agents.title")}</Link>;
}
function Block({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return <section className="mb-5 last:mb-0"><h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-3">{title}</h3>{children}</section>;
}
function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-2"><dt className="text-fg-3">{label}</dt><dd className="text-end text-fg-2">{children}</dd></div>;
}
function Bullets({ items }: { items: string[] }) {
  return <ul className="list-disc space-y-1 ps-5 text-sm text-fg-2">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}
function YesNo({ v }: { v: boolean }) {
  const { t } = useApp();
  return v ? <Badge tone="success">{t("agents.common.yes")}</Badge> : <Badge tone="neutral">{t("agents.common.no")}</Badge>;
}
function AgentLink({ slug, name }: { slug: string; name: string }) {
  return <Link href={`/agents/${slug}`} className="text-accent-text hover:underline">{name}</Link>;
}
