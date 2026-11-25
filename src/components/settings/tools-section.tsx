"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, Wrench } from "lucide-react";
import { AgentAvatar, Badge, Card, CardHeader, EmptyState, ErrorState, Input, LoadingBlock, RiskBadge, Select, StatusBadge, Switch, Table, Td, Th } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { tOr, useFormat } from "@/components/analytics/format";
import { TOOL_CATEGORIES, type ToolInfo } from "@/components/agents/types";
import { FeedbackMessage, useFeedback, type SettingsResponse } from "./shared";

export function ToolsSection({ data, onSaved }: { data: SettingsResponse; onSaved: () => Promise<void> }) {
  const { t, can } = useApp();
  const f = useFormat();
  const admin = can("admin");
  const tools = useApi<{ tools: ToolInfo[] }>("/api/tools");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [fb, setFb] = useFeedback();
  const disabled = data.settings.disabledTools;

  const rows = useMemo(() => (tools.data?.tools ?? [])
    .filter((x) => (!cat || x.category === cat) && (!q.trim() || `${x.name} ${x.description}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => a.riskLevel - b.riskLevel || a.name.localeCompare(b.name)), [tools.data, q, cat]);

  const toggle = async (tool: ToolInfo, enable: boolean) => {
    setBusy(tool.name);
    const next = enable ? disabled.filter((n) => n !== tool.name) : [...new Set([...disabled, tool.name])];
    try {
      await api("/api/settings", { method: "PATCH", body: { disabledTools: next } });
      await Promise.all([onSaved(), tools.reload()]);
      setFb({ tone: "success", text: enable ? t("settings.tools.enabledMsg", { tool: tool.name }) : t("settings.tools.disabledMsg", { tool: tool.name }) });
    } catch (err) {
      setFb({ tone: "danger", text: (err as Error).message });
    } finally { setBusy(null); }
  };

  const approval = (x: ToolInfo) => x.riskLevel >= 4 ? <Badge tone="danger">{t("agents.approval.always")}</Badge>
    : x.requiresApproval ? <Badge tone="warning">{t("agents.approval.required")}</Badge>
      : x.riskLevel === 3 ? <Badge tone="warning">{t("agents.approval.autoL3")}</Badge>
        : <Badge tone="success">{t("agents.approval.none")}</Badge>;

  return (
    <Card>
      <CardHeader title={t("settings.tools.title")} description={admin ? t("settings.tools.desc") : t("settings.adminOnlyEdit")} />
      <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("settings.tools.search")} aria-label={t("settings.tools.search")} className="ps-9" />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t("settings.tools.category")} className="sm:w-48">
          <option value="">{t("settings.tools.allCategories")}</option>
          {TOOL_CATEGORIES.map((c) => <option key={c} value={c}>{t(`agents.category.${c}`)}</option>)}
        </Select>
      </div>
      <FeedbackMessage fb={fb} onDismiss={() => setFb(null)} className="px-5 pb-3" />
      {tools.error && !tools.data ? <div className="p-5"><ErrorState error={tools.error} onRetry={tools.reload} /></div>
        : !tools.data ? <div className="p-5"><LoadingBlock rows={5} /></div>
          : rows.length === 0 ? <EmptyState icon={<Wrench className="size-5" />} title={t("settings.tools.none")} /> : (
            <Table>
              <thead><tr>
                <Th>{t("agents.tools.name")}</Th><Th>{t("agents.tools.risk")}</Th><Th>{t("agents.tools.approval")}</Th>
                <Th>{t("settings.tools.agents")}</Th><Th>{t("agents.tools.integration")}</Th><Th className="text-end">{t("agents.tools.calls")}</Th><Th>{t("settings.tools.enabled")}</Th>
              </tr></thead>
              <tbody>
                {rows.map((x) => {
                  const wsDisabled = disabled.includes(x.name);
                  const platformDisabled = !x.enabled && !wsDisabled;
                  return (
                    <tr key={x.name}>
                      <Td className="min-w-[240px]">
                        <p className="font-mono text-[13px] font-medium text-fg">{x.name}</p>
                        <p className="mt-0.5 line-clamp-2 text-[12.5px] text-fg-3">{x.description}</p>
                        <p className="mt-1 text-[11.5px] text-fg-3">{t(`agents.category.${x.category}`)}</p>
                      </Td>
                      <Td><RiskBadge level={x.riskLevel} /></Td>
                      <Td>{approval(x)}</Td>
                      <Td>
                        {x.agents.length === 0 ? <span className="text-fg-3">—</span> : (
                          <ul className="flex flex-wrap gap-1" aria-label={t("settings.tools.agents")}>
                            {x.agents.map((a) => (
                              <li key={a}>
                                <Link href={`/agents/${a}`} title={tOr(t, `agent.${a}`, a)} aria-label={tOr(t, `agent.${a}`, a)}>
                                  <AgentAvatar slug={a} size="sm" />
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Td>
                      <Td>
                        {x.integration ? (
                          <span className="inline-flex flex-col gap-1">
                            <span className="font-mono text-[12px]">{x.integration.replace("|", " / ")}</span>
                            <StatusBadge status={x.integrationConnected ? "connected" : "disconnected"} />
                          </span>
                        ) : <span className="text-fg-3">—</span>}
                      </Td>
                      <Td className="whitespace-nowrap text-end tabular-nums">
                        {f.num(x.calls)}
                        {x.failed > 0 && <span className="ms-1 text-[12px] text-danger">({t("settings.tools.failedN", { n: f.num(x.failed) })})</span>}
                      </Td>
                      <Td>
                        {platformDisabled ? <Badge tone="neutral">{t("settings.tools.platformDisabled")}</Badge> : (
                          <Switch checked={!wsDisabled} disabled={!admin || busy === x.name} onChange={(v) => void toggle(x, v)}
                            label={t("settings.tools.toggle", { tool: x.name })} />
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
      <p className="px-5 py-3 text-[12px] text-fg-3">{t("settings.tools.note")}</p>
    </Card>
  );
}
