"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Eye, EyeOff, History, Lock, RotateCcw, ShieldAlert } from "lucide-react";
import {
  Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, LoadingBlock, RiskBadge, Select, Switch, Textarea, cx,
} from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { useFormat } from "@/components/analytics/format";
import { TOOL_CATEGORIES, type AgentConfig, type AgentDetailResponse, type AgentVersion, type Tier, type ToolInfo } from "./types";

interface EffectiveModels { primary: string | null; fallback: string | null; fast: string | null; advanced: string | null; embedding: string }

/** Counts lines added/removed between two texts (multiset line diff — a quick, honest hint, not a full diff). */
function lineDiff(a: string, b: string): { added: number; removed: number } {
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (const l of s.split("\n").map((x) => x.trimEnd()).filter(Boolean)) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const ma = count(a), mb = count(b);
  let added = 0, removed = 0;
  for (const [l, n] of mb) added += Math.max(0, n - (ma.get(l) ?? 0));
  for (const [l, n] of ma) removed += Math.max(0, n - (mb.get(l) ?? 0));
  return { added, removed };
}

interface CatalogTool {
  name: string; description: string; category: string; riskLevel: number; integration: string | null;
  enabled?: boolean; integrationConnected: boolean | null;
}

const PROMPT_MIN = 20;
const PROMPT_MAX = 20_000;
const MAX_TOOLS = 40;

export function AgentConfigPanel({ data, tools, editable, onSaved }: {
  data: AgentDetailResponse; tools?: ToolInfo[]; editable: boolean; onSaved: () => Promise<void>;
}) {
  const { t } = useApp();
  const { agent } = data;
  const settings = useApi<{ effectiveModels: EffectiveModels; settings: { autoApproveLevel3: boolean } }>("/api/settings");

  const [prompt, setPrompt] = useState(agent.systemPrompt);
  const [allowed, setAllowed] = useState<string[]>(agent.allowedTools);
  const [tier, setTier] = useState<Tier>(agent.tier);
  const [override, setOverride] = useState(agent.modelOverride ?? "");
  const [active, setActive] = useState(agent.active);
  const [showBuiltIn, setShowBuiltIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Re-sync the form when a new version arrives from the server.
  useEffect(() => {
    setPrompt(agent.systemPrompt); setAllowed(agent.allowedTools); setTier(agent.tier);
    setOverride(agent.modelOverride ?? ""); setActive(agent.active);
  }, [agent.version, agent.systemPrompt, agent.allowedTools, agent.tier, agent.modelOverride, agent.active]);

  const catalog = useMemo(() => {
    // Prefer the live registry (has enabled/approval state); fall back to the agent endpoint's list.
    const base: CatalogTool[] = tools ?? data.availableTools.map((x) => ({ ...x, enabled: undefined, integrationConnected: null }));
    const groups = new Map<string, CatalogTool[]>();
    for (const tool of base) groups.set(tool.category, [...(groups.get(tool.category) ?? []), tool]);
    const order = [...TOOL_CATEGORIES, ...[...groups.keys()].filter((k) => !(TOOL_CATEGORIES as readonly string[]).includes(k))];
    return order.filter((c) => groups.has(c)).map((c) => ({ category: c, tools: groups.get(c)!.sort((a, b) => a.riskLevel - b.riskLevel || a.name.localeCompare(b.name)) }));
  }, [tools, data.availableTools]);
  const riskOf = useMemo(() => new Map(catalog.flatMap((g) => g.tools.map((x) => [x.name, x.riskLevel] as const))), [catalog]);

  const sameTools = [...allowed].sort().join(",") === [...agent.allowedTools].sort().join(",");
  const dirty = {
    systemPrompt: prompt !== agent.systemPrompt,
    allowedTools: !sameTools,
    tier: tier !== agent.tier,
    modelOverride: (override.trim() || null) !== (agent.modelOverride ?? null),
    active: active !== agent.active,
  };
  const isDirty = Object.values(dirty).some(Boolean);
  const newlyGranted = allowed.filter((n) => !agent.allowedTools.includes(n) && (riskOf.get(n) ?? 0) >= 3);
  const promptLen = prompt.trim().length;
  const promptError = promptLen < PROMPT_MIN ? t("agents.config.promptTooShort", { n: PROMPT_MIN }) : prompt.length > PROMPT_MAX ? t("agents.config.promptTooLong", { n: PROMPT_MAX }) : null;
  const diff = agent.builtInPrompt ? lineDiff(agent.builtInPrompt, prompt) : null;
  const effective = settings.data?.effectiveModels;
  const tierModel = effective ? (tier === "fast" ? effective.fast : tier === "advanced" ? effective.advanced : effective.primary) : null;

  const toggleTool = (name: string, on: boolean) => setAllowed((cur) => (on ? [...new Set([...cur, name])] : cur.filter((x) => x !== name)));

  const save = async () => {
    setSaving(true); setMsg(null);
    const body: Record<string, unknown> = {};
    if (dirty.systemPrompt) body.systemPrompt = prompt;
    if (dirty.allowedTools) body.allowedTools = allowed;
    if (dirty.tier) body.tier = tier;
    if (dirty.modelOverride) body.modelOverride = override.trim() || null;
    if (dirty.active) body.active = active;
    try {
      const r = await api<{ agent: AgentConfig }>(`/api/agents/${agent.slug}`, { method: "PATCH", body });
      setMsg({ tone: "success", text: t("agents.config.savedVersion", { v: r.agent.version }) });
      await onSaved();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally { setSaving(false); }
  };

  const reset = async () => {
    setResetting(true);
    try {
      await api(`/api/agents/${agent.slug}`, { method: "DELETE" });
      setResetOpen(false);
      setMsg({ tone: "success", text: t("agents.config.resetDone") });
      await onSaved();
    } catch (e) {
      setResetOpen(false);
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally { setResetting(false); }
  };

  const discard = () => {
    setPrompt(agent.systemPrompt); setAllowed(agent.allowedTools); setTier(agent.tier); setOverride(agent.modelOverride ?? ""); setActive(agent.active); setMsg(null);
  };

  return (
    <div className="space-y-6">
      {!editable && <Alert tone="info" title={t("agents.config.readOnly")}>{t("agents.config.readOnlyDesc")}</Alert>}
      {msg && <div role="status" aria-live="polite"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <Card>
        <CardHeader title={t("agents.config.general")} description={t("agents.config.generalDesc")} />
        <div className="grid gap-5 px-5 pb-5 md:grid-cols-2">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-3 md:col-span-2">
            <div>
              <p className="text-sm font-medium text-fg">{t("agents.config.active")}</p>
              <p className="mt-0.5 text-[12.5px] text-fg-3">{t("agents.config.activeDesc")}</p>
            </div>
            <Switch checked={active} onChange={setActive} disabled={!editable} label={t("agents.config.active")} />
          </div>
          <Field label={t("agents.config.tier")} hint={tierModel ? t("agents.config.tierResolves", { model: tierModel }) : t("agents.config.tierHint")}>
            <Select value={tier} onChange={(e) => setTier(e.target.value as Tier)} disabled={!editable}>
              {(["fast", "standard", "advanced"] as const).map((x) => <option key={x} value={x}>{t(`agents.tier.${x}`)} — {t(`agents.tier.${x}.desc`)}</option>)}
            </Select>
          </Field>
          <Field label={t("agents.config.modelOverride")} hint={t("agents.config.modelOverrideHint")}>
            <Input value={override} onChange={(e) => setOverride(e.target.value)} disabled={!editable} maxLength={100}
              placeholder={t("agents.config.modelOverridePlaceholder")} className="font-mono" dir="ltr" spellCheck={false} autoComplete="off" />
          </Field>
          {override.trim() && (
            <div className="md:col-span-2">
              <Alert tone="warning" title={t("agents.config.overrideWarnTitle")}>{t("agents.config.overrideWarn")}</Alert>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t("agents.config.prompt")}
          description={t("agents.config.promptDesc")}
          actions={agent.builtInPrompt ? (
            <Button size="sm" variant="ghost" icon={showBuiltIn ? <EyeOff className="size-4" /> : <Eye className="size-4" />} onClick={() => setShowBuiltIn((v) => !v)} aria-expanded={showBuiltIn}>
              <span className="hidden sm:inline">{showBuiltIn ? t("agents.config.hideBuiltIn") : t("agents.config.viewBuiltIn")}</span>
            </Button>
          ) : undefined}
        />
        <div className="space-y-3 px-5 pb-5">
          {showBuiltIn && agent.builtInPrompt && (
            <div className="rounded-xl border border-border bg-surface-2">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span className="text-[12.5px] font-medium text-fg-2">{t("agents.config.builtInPrompt")}</span>
                {editable && prompt !== agent.builtInPrompt && (
                  <Button size="sm" variant="outline" onClick={() => setPrompt(agent.builtInPrompt!)}>{t("agents.config.useBuiltIn")}</Button>
                )}
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[12.5px] leading-relaxed text-fg-2" dir="auto">{agent.builtInPrompt}</pre>
            </div>
          )}
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} readOnly={!editable} rows={14} dir="auto" spellCheck={false}
            aria-label={t("agents.config.prompt")} aria-invalid={Boolean(promptError)} className="font-mono text-[13px]" />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <div className="flex flex-wrap items-center gap-2">
              {diff && (diff.added || diff.removed) ? (
                <Badge tone="accent">{t("agents.config.diff", { a: diff.added, r: diff.removed })}</Badge>
              ) : agent.builtInPrompt ? <Badge tone="success"><Check className="size-3" />{t("agents.config.matchesBuiltIn")}</Badge> : null}
              {dirty.systemPrompt && <Badge tone="warning">{t("agents.config.unsaved")}</Badge>}
              {promptError && <span className="text-danger">{promptError}</span>}
            </div>
            <span className={cx("tabular-nums", prompt.length > PROMPT_MAX ? "text-danger" : "text-fg-3")}>{prompt.length.toLocaleString()} / {PROMPT_MAX.toLocaleString()}</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("agents.config.tools")} description={t("agents.config.toolsDesc", { n: allowed.length, max: MAX_TOOLS })} />
        <div className="space-y-5 px-5 pb-5">
          {newlyGranted.length > 0 && (
            <Alert tone="warning" title={t("agents.config.grantWarnTitle")}>
              {t("agents.config.grantWarn", { tools: newlyGranted.join(", ") })}
              {newlyGranted.some((n) => riskOf.get(n) === 4) && <> {t("agents.config.grantWarnL4")}</>}
              {settings.data?.settings.autoApproveLevel3 && newlyGranted.some((n) => riskOf.get(n) === 3) && <> {t("agents.config.grantWarnL3Auto")}</>}
            </Alert>
          )}
          {allowed.length > MAX_TOOLS && <Alert tone="danger">{t("agents.config.tooManyTools", { max: MAX_TOOLS })}</Alert>}
          {catalog.map((g) => (
            <fieldset key={g.category}>
              <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-fg-3">{t(`agents.category.${g.category}`)}</legend>
              <ul className="grid gap-2 md:grid-cols-2">
                {g.tools.map((tool) => {
                  const checked = allowed.includes(tool.name);
                  const id = `tool-${tool.name}`;
                  return (
                    <li key={tool.name}>
                      <label htmlFor={id} className={cx("flex h-full items-start gap-3 rounded-xl border p-3 transition-colors",
                        checked ? "border-accent/50 bg-accent-soft/40" : "border-border", editable ? "cursor-pointer hover:border-border-strong" : "cursor-default")}>
                        <input id={id} type="checkbox" checked={checked} disabled={!editable} onChange={(e) => toggleTool(tool.name, e.target.checked)}
                          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[13px] font-medium text-fg">{tool.name}</span>
                            <RiskBadge level={tool.riskLevel} />
                            {tool.enabled === false && <Badge tone="danger">{t("agents.tools.disabled")}</Badge>}
                            {tool.integration && <Badge tone={tool.integrationConnected ? "success" : "neutral"}>{tool.integration.replace("|", " / ")}</Badge>}
                          </span>
                          <span className="mt-1 line-clamp-2 block text-[12.5px] text-fg-3">{tool.description}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
        </div>
      </Card>

      {editable && (
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-2xl sm:border sm:bg-surface sm:shadow-pop">
          <p className="text-[12.5px] text-fg-3">{isDirty ? t("agents.config.saveHint") : t("agents.config.noChanges")}</p>
          <div className="flex flex-wrap gap-2">
            {agent.workspaceScoped && (
              <Button variant="outline" icon={<RotateCcw className="size-4" />} onClick={() => setResetOpen(true)}>{t("agents.config.reset")}</Button>
            )}
            {isDirty && <Button variant="ghost" onClick={discard}>{t("agents.config.discard")}</Button>}
            <Button onClick={save} loading={saving} disabled={!isDirty || Boolean(promptError) || allowed.length > MAX_TOOLS}>{t("agents.config.saveVersion")}</Button>
          </div>
        </div>
      )}

      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} title={t("agents.config.resetTitle")} description={t("agents.config.resetDesc")} size="sm"
        footer={<>
          <Button variant="ghost" onClick={() => setResetOpen(false)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={resetting} onClick={reset}>{t("agents.config.resetConfirm")}</Button>
        </>}>
        <p className="text-sm text-fg-2">{t("agents.config.resetBody")}</p>
      </Dialog>
    </div>
  );
}

export function VersionHistory({ agent, versions, editable, onRestored }: {
  agent: AgentConfig; versions: AgentVersion[]; editable: boolean; onRestored: () => Promise<void>;
}) {
  const { t } = useApp();
  const f = useFormat();
  const [open, setOpen] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<AgentVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const restore = async () => {
    if (!restoring) return;
    setBusy(true);
    try {
      const r = await api<{ agent: AgentConfig }>(`/api/agents/${agent.slug}`, {
        method: "PATCH", body: { systemPrompt: restoring.system_prompt, allowedTools: restoring.allowed_tools, tier: restoring.model_tier },
      });
      setMsg({ tone: "success", text: t("agents.versions.restored", { from: restoring.version, v: r.agent.version }) });
      setRestoring(null);
      await onRestored();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
      setRestoring(null);
    } finally { setBusy(false); }
  };

  if (!versions) return <LoadingBlock />;
  return (
    <div className="space-y-4">
      {msg && <div role="status" aria-live="polite"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <Card>
        <CardHeader title={t("agents.versions.title")}
          description={agent.workspaceScoped ? t("agents.versions.descCustom") : t("agents.versions.descBuiltIn")} />
        {versions.length === 0 ? <EmptyState icon={<History className="size-5" />} title={t("agents.versions.none")} /> : (
          <ol className="divide-y divide-border border-t border-border">
            {versions.map((v) => {
              const current = v.version === agent.version;
              const expanded = open === v.id;
              return (
                <li key={v.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="font-mono text-sm font-semibold text-fg">v{v.version}</span>
                    {current && <Badge tone="success">{t("agents.versions.current")}</Badge>}
                    <Badge>{t(`agents.tier.${v.model_tier}`)}</Badge>
                    <span className="text-[12.5px] text-fg-3">{t("agents.versions.tools", { n: v.allowed_tools.length })}</span>
                    <span className="text-[12.5px] text-fg-3">{f.date(v.created_at)}</span>
                    <div className="ms-auto flex gap-2">
                      <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : v.id)}
                        icon={<ChevronDown className={cx("size-4 transition-transform", expanded && "rotate-180")} />}>
                        {expanded ? t("agents.versions.hide") : t("agents.versions.view")}
                      </Button>
                      {editable && !current && (
                        <Button size="sm" variant="outline" icon={<RotateCcw className="size-3.5" />} onClick={() => setRestoring(v)}>{t("agents.versions.restore")}</Button>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {v.allowed_tools.map((n) => <span key={n} className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-fg-2">{n}</span>)}
                      </div>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-surface-2 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-fg-2" dir="auto">{v.system_prompt}</pre>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
      {!editable && <p className="flex items-center gap-1.5 text-[12.5px] text-fg-3"><Lock className="size-3.5" aria-hidden />{t("agents.config.readOnlyDesc")}</p>}
      <Dialog open={Boolean(restoring)} onClose={() => setRestoring(null)} size="sm" title={t("agents.versions.restoreTitle", { v: restoring?.version ?? "" })}
        footer={<>
          <Button variant="ghost" onClick={() => setRestoring(null)}>{t("action.cancel")}</Button>
          <Button loading={busy} onClick={restore} icon={<ShieldAlert className="size-4" />}>{t("agents.versions.restoreConfirm")}</Button>
        </>}>
        <p className="text-sm text-fg-2">{t("agents.versions.restoreBody")}</p>
      </Dialog>
    </div>
  );
}
