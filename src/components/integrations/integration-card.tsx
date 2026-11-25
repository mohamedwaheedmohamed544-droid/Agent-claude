"use client";

import {
  Calendar, Check, CircleAlert, Copy, Database, Globe, HardDrive, KeyRound, Mail, PlugZap, RefreshCw, Sparkles, Unplug, Users, Webhook,
} from "lucide-react";
import { useApp } from "@/components/providers";
import { Badge, Button, RiskBadge, cx, useCopy } from "@/components/ui";
import type { IntegrationInfo, IntegrationStatus, TestResult, ToolRef } from "./types";

export type CardKey =
  | "gmail" | "outlook" | "google_calendar" | "outlook_calendar" | "google_drive"
  | "anthropic" | "web_search" | "neon" | "webhook" | "crm";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const ICONS: Record<CardKey, React.ComponentType<{ className?: string }>> = {
  gmail: Mail, outlook: Mail, google_calendar: Calendar, outlook_calendar: Calendar, google_drive: HardDrive,
  anthropic: Sparkles, web_search: Globe, neon: Database, webhook: Webhook, crm: Users,
};

const ICON_TONE: Record<CardKey, string> = {
  gmail: "bg-accent-soft text-accent-text", outlook: "bg-accent-soft text-accent-text",
  google_calendar: "bg-info-soft text-info", outlook_calendar: "bg-info-soft text-info",
  google_drive: "bg-success-soft text-success",
  anthropic: "bg-accent-soft text-accent-text", web_search: "bg-info-soft text-info", neon: "bg-success-soft text-success",
  webhook: "bg-warning-soft text-warning", crm: "bg-surface-2 text-fg-2",
};

const STATUS_TONE: Record<IntegrationStatus, Tone> = {
  connected: "success", available: "success", disconnected: "neutral", pending: "info", error: "danger", not_configured: "warning",
};

/** Which granted scopes are relevant to a service card (scopes are shared across one provider connection). */
const SCOPE_FILTER: Partial<Record<CardKey, (s: string) => boolean>> = {
  gmail: (s) => /gmail|userinfo\.email|^email$|^openid$/i.test(s),
  google_calendar: (s) => /calendar/i.test(s),
  google_drive: (s) => /drive/i.test(s),
  outlook: (s) => /^mail\.|^user\.read$|offline_access|^openid$|^profile$|^email$/i.test(s),
  outlook_calendar: (s) => /^calendars\./i.test(s),
};

export function shortScope(s: string): string {
  return s.replace(/^https:\/\/www\.googleapis\.com\/auth\//, "");
}

export function StatusPill({ status }: { status: IntegrationStatus }) {
  const { t } = useApp();
  return (
    <Badge tone={STATUS_TONE[status]}>
      <span className="size-1.5 rounded-full bg-current" />
      {t(`integrations.status.${status}`)}
    </Badge>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">{children}</p>;
}

function ToolList({ tools }: { tools: ToolRef[] }) {
  const { t } = useApp();
  if (!tools.length) return null;
  return (
    <div>
      <SectionLabel>{t("integrations.agentTools")}</SectionLabel>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {tools.map((tool) => (
          <li key={tool.name} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-fg">{t(`integrations.tool.${tool.name}`)}</p>
              <p className="truncate font-mono text-[11.5px] text-fg-3" dir="ltr">{tool.name}</p>
            </div>
            <RiskBadge level={tool.riskLevel} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Capabilities({ caps }: { caps: string[] }) {
  const { t } = useApp();
  if (!caps.length) return null;
  return (
    <div>
      <SectionLabel>{t("integrations.capabilities")}</SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {caps.map((c) => <Badge key={c} tone="neutral">{t(`integrations.cap.${c}`)}</Badge>)}
      </div>
    </div>
  );
}

function CopyField({ value }: { value: string }) {
  const { t } = useApp();
  const [copied, copy] = useCopy();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-2" dir="ltr" title={value}>{value}</code>
      <button type="button" onClick={() => copy(value)} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-fg-3 hover:bg-surface-3 hover:text-fg"
        aria-label={t("integrations.action.copy")}>
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        {copied ? t("integrations.action.copied") : t("integrations.action.copy")}
      </button>
    </div>
  );
}

function SetupPanel({ entry }: { entry: IntegrationInfo }) {
  const { t } = useApp();
  const setup = entry.setup;
  if (!setup) return null;
  const steps = entry.provider === "google" || entry.provider === "microsoft"
    ? [1, 2, 3].map((n) => t(`integrations.setup.${entry.provider}.${n}`))
    : [];
  const requested = (entry.details?.requestedScopes as string[] | undefined) ?? [];
  return (
    <details className="group rounded-xl border border-warning/30 bg-warning-soft/60 open:bg-warning-soft">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] font-medium text-warning">
        <KeyRound className="size-4 shrink-0" />
        <span className="flex-1">{t("integrations.setup.title")}</span>
        <span className="text-[11.5px] font-normal opacity-80 group-open:hidden">{setup.missingEnv.length ? `${setup.missingEnv.length} ${t("integrations.setup.missing").toLowerCase()}` : ""}</span>
      </summary>
      <div className="space-y-3 border-t border-warning/20 px-3 pb-3 pt-2.5 text-[12.5px] text-fg-2">
        <p>{t("integrations.setup.body")}</p>
        {steps.length > 0 && (
          <ol className="list-decimal space-y-1 ps-4">
            {steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
        )}
        <div className="flex flex-wrap gap-1.5" dir="ltr">
          {setup.envVars.map((v) => (
            <code key={v} className={cx("rounded-md border px-1.5 py-0.5 font-mono text-[11.5px]",
              setup.missingEnv.includes(v) ? "border-danger/30 bg-danger-soft text-danger" : "border-border bg-surface text-fg-2")}>
              {v}{setup.missingEnv.includes(v) ? ` · ${t("integrations.setup.missing")}` : ""}
            </code>
          ))}
          {setup.optionalEnv.map((v) => (
            <code key={v} className="rounded-md border border-dashed border-border bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-fg-3">
              {v} · {t("integrations.setup.optional")}
            </code>
          ))}
        </div>
        {setup.redirectUri && (
          <div>
            <SectionLabel>{t("integrations.setup.redirect")}</SectionLabel>
            <CopyField value={setup.redirectUri} />
          </div>
        )}
        {requested.length > 0 && (
          <div>
            <SectionLabel>{t("integrations.requestedScopes")}</SectionLabel>
            <div className="flex flex-wrap gap-1" dir="ltr">
              {requested.map((s) => <code key={s} className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-fg-3">{shortScope(s)}</code>)}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function BuiltinDetails({ entry }: { entry: IntegrationInfo }) {
  const { t } = useApp();
  const d = entry.details ?? {};
  if (entry.provider === "anthropic") {
    const models = (d.models as Array<{ role: string; model: string | null; available: boolean | null }> | undefined) ?? [];
    return (
      <div className="space-y-2">
        {typeof d.mode === "string" && (
          <p className="text-[12.5px] text-fg-3">{t("integrations.ai.mode")}: <span className="text-fg-2">{t(`integrations.ai.mode.${d.mode}`)}</span></p>
        )}
        {models.length > 0 && (
          <div>
            <SectionLabel>{t("integrations.ai.models")}</SectionLabel>
            <ul className="space-y-1">
              {models.filter((m) => m.model).map((m) => (
                <li key={m.role} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="min-w-0 truncate"><span className="text-fg-3">{m.role}</span> <code className="font-mono text-fg-2" dir="ltr">{m.model}</code></span>
                  <Badge tone={m.available === true ? "success" : m.available === false ? "danger" : "neutral"}>
                    {t(m.available === true ? "integrations.ai.available" : m.available === false ? "integrations.ai.unavailable" : "integrations.ai.unknown")}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (entry.provider === "neon") {
    return (
      <dl className="grid grid-cols-3 gap-2 text-[12.5px]">
        <div className="rounded-lg bg-surface-2 px-2.5 py-1.5"><dt className="text-fg-3">{t("integrations.db.migrations")}</dt><dd className="font-medium text-fg tabular-nums">{String(d.migrationsApplied ?? "—")}</dd></div>
        <div className="rounded-lg bg-surface-2 px-2.5 py-1.5"><dt className="text-fg-3">{t("integrations.db.pgvector")}</dt><dd className="font-medium text-fg">{t(d.pgvector ? "integrations.db.enabled" : "integrations.db.disabled")}</dd></div>
        <div className="rounded-lg bg-surface-2 px-2.5 py-1.5"><dt className="text-fg-3">{t("integrations.db.latency")}</dt><dd className="font-medium text-fg tabular-nums">{String(d.latencyMs ?? "—")} ms</dd></div>
      </dl>
    );
  }
  return null;
}

export interface CardProps {
  cardKey: CardKey;
  entry?: IntegrationInfo;
  /** OAuth service cards: tools/capabilities of this service only. */
  tools?: ToolRef[];
  capabilities?: string[];
  isAdmin: boolean;
  busy?: "connect" | "test" | "disconnect" | null;
  testResult?: TestResult | null;
  onConnect?: () => void;
  onTest?: () => void;
  onDisconnect?: () => void;
}

export function IntegrationCard({ cardKey, entry, tools, capabilities, isAdmin, busy, testResult, onConnect, onTest, onDisconnect }: CardProps) {
  const { t, locale } = useApp();
  const Icon = ICONS[cardKey];
  const isOAuth = entry?.kind === "oauth";
  const status: IntegrationStatus | null = cardKey === "crm" ? null : entry?.status ?? null;
  const scopes = isOAuth ? (entry?.scopes ?? []).filter(SCOPE_FILTER[cardKey] ?? (() => true)) : [];
  const encryptionReady = entry?.details?.encryptionReady !== false;
  const canConnect = isOAuth && entry!.configured && encryptionReady;
  const connected = status === "connected";

  return (
    <article className="flex h-full flex-col rounded-2xl border border-border bg-surface shadow-card">
      <header className="flex items-start gap-3 px-5 pt-4">
        <span className={cx("grid size-10 shrink-0 place-items-center rounded-xl", ICON_TONE[cardKey])}><Icon className="size-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-fg">{t(`integrations.service.${cardKey}`)}</h3>
          <p className="truncate text-[12.5px] text-fg-3">
            {isOAuth ? t(`integrations.via.${entry!.provider}`) : cardKey === "crm" ? t("integrations.crm.badge") : t("integrations.alwaysOn")}
          </p>
        </div>
        {status ? <StatusPill status={status} /> : <Badge tone="info">{t("integrations.crm.badge")}</Badge>}
      </header>

      <div className="flex-1 space-y-4 px-5 pb-4 pt-3">
        <p className="text-[13px] leading-relaxed text-fg-2">{t(`integrations.service.${cardKey}.desc`)}</p>

        {isOAuth && (entry!.accountLabel || entry!.connectedAt) && (
          <dl className="grid gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] sm:grid-cols-2">
            {entry!.accountLabel && (
              <div className="min-w-0">
                <dt className="text-fg-3">{t("integrations.account")}</dt>
                <dd className="truncate font-medium text-fg" dir="ltr" title={entry!.accountLabel}>{entry!.accountLabel}</dd>
              </div>
            )}
            {entry!.connectedAt && (
              <div>
                <dt className="text-fg-3">{t("integrations.connectedSince")}</dt>
                <dd className="font-medium text-fg">{new Date(entry!.connectedAt).toLocaleDateString(locale === "ar" ? "ar" : "en", { dateStyle: "medium" })}</dd>
              </div>
            )}
          </dl>
        )}

        {entry?.lastError && status !== "connected" && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0 break-words"><span className="font-medium">{t("integrations.lastError")}: </span>{entry.lastError}</p>
          </div>
        )}

        {cardKey === "crm" && <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-fg-2">{t("integrations.crm.howto")}</p>}

        <Capabilities caps={capabilities ?? entry?.capabilities ?? []} />
        <ToolList tools={tools ?? entry?.tools ?? []} />
        {entry && <BuiltinDetails entry={entry} />}

        {scopes.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none text-[12.5px] font-medium text-fg-3 hover:text-fg">
              {t("integrations.scopes")} ({scopes.length})
            </summary>
            <div className="mt-2 flex flex-wrap gap-1" dir="ltr">
              {scopes.map((s) => <code key={s} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-3">{shortScope(s)}</code>)}
            </div>
          </details>
        )}

        {isOAuth && !entry!.configured && <SetupPanel entry={entry!} />}
        {entry && !isOAuth && entry.status === "not_configured" && <SetupPanel entry={entry} />}

        {testResult && (
          <p className={cx("flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px]", testResult.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")} role="status">
            {testResult.ok ? <Check className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
            <span className="min-w-0 break-words">
              {testResult.ok
                ? testResult.account
                  ? t("integrations.test.okAccount", { account: testResult.account, ms: testResult.latencyMs })
                  : t("integrations.test.ok", { ms: testResult.latencyMs })
                : `${t("integrations.test.failed")}: ${testResult.error ?? ""}`}
            </span>
          </p>
        )}
      </div>

      {isOAuth && entry!.configured && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          {isAdmin ? (
            <>
              {!connected && (
                <Button size="sm" onClick={onConnect} loading={busy === "connect"} disabled={!canConnect || Boolean(busy)} icon={status === "error" ? <RefreshCw className="size-3.5" /> : <PlugZap className="size-3.5" />}>
                  {status === "error" ? t("integrations.action.reconnect") : t("integrations.action.connect")}
                </Button>
              )}
              {connected && (
                <Button size="sm" variant="outline" onClick={onTest} loading={busy === "test"} disabled={Boolean(busy)} icon={<RefreshCw className="size-3.5" />}>
                  {t("integrations.action.test")}
                </Button>
              )}
              {(connected || status === "error") && (
                <Button size="sm" variant="ghost" className="ms-auto text-danger hover:bg-danger-soft hover:text-danger" onClick={onDisconnect} loading={busy === "disconnect"} disabled={Boolean(busy)} icon={<Unplug className="size-3.5" />}>
                  {t("integrations.action.disconnect")}
                </Button>
              )}
            </>
          ) : (
            <p className="text-[12px] text-fg-3">{t("integrations.adminOnly")}</p>
          )}
        </footer>
      )}
    </article>
  );
}
