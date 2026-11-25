"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, Database, HeartPulse, ListChecks, RefreshCw, Server, ServerCrash, Settings2, XCircle } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, ErrorState, Skeleton, Table, Td, Th, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { useFormat } from "./format";

interface Health {
  database: { ok: boolean; latencyMs: number; version: string; vector: string | null; migrations: number; size: string };
  ai: { mode: "mock" | "openai"; checked: boolean; error?: string; models: Array<{ role: string; model: string | null; available: boolean | null }> };
  queue: { running: number; planned: number; waitingApproval: number; paused: number; stalled: number };
  recentServerErrors: Array<{ route: string; status: number; n: number }>;
  configuration: Record<string, boolean>;
  runtime: { node: string; region: string | null; env: string | null };
}

/** Required for a working deployment vs. optional (feature-specific). Values are never shown — only presence. */
const REQUIRED = new Set(["OPENAI_API_KEY", "OPENAI_MODEL", "DATABASE_URL", "NEXUS_ENCRYPTION_KEY"]);
const RECOMMENDED = new Set(["CRON_SECRET", "OPENAI_FALLBACK_MODEL"]);

export function SystemHealth() {
  const { t } = useApp();
  const { data, error, loading, reload, setData } = useApi<Health>("/api/admin/health");
  const [rechecking, setRechecking] = useState(false);
  const [recheckError, setRecheckError] = useState<string | null>(null);

  const ready = Boolean(data);
  // Support deep links (e.g. from Settings → AI models) once the section has rendered.
  useEffect(() => {
    if (ready && window.location.hash === "#health") document.getElementById("health")?.scrollIntoView({ block: "start" });
  }, [ready]);

  const recheck = async () => {
    setRechecking(true); setRecheckError(null);
    try { setData(await api<Health>("/api/admin/health?refresh=1")); } catch (e) { setRecheckError((e as Error).message); } finally { setRechecking(false); }
  };

  return (
    <section id="health" aria-labelledby="health-title" className="mt-10 scroll-mt-20">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-success-soft text-success"><HeartPulse className="size-5" aria-hidden /></span>
          <div>
            <h2 id="health-title" className="text-lg font-semibold tracking-tight text-fg">{t("analytics.health.title")}</h2>
            <p className="mt-0.5 text-[13px] text-fg-3">{t("analytics.health.desc")}</p>
          </div>
        </div>
        <Button variant="outline" icon={<RefreshCw className={cx("size-4", loading && "animate-spin")} />} onClick={reload} disabled={loading}>{t("action.refresh")}</Button>
      </div>

      {error && !data ? <ErrorState error={error} onRetry={reload} /> : !data ? (
        <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <DatabaseCard db={data.database} />
          <AiCard ai={data.ai} onRecheck={recheck} rechecking={rechecking} recheckError={recheckError} />
          <QueueCard q={data.queue} />
          <ErrorsCard rows={data.recentServerErrors} />
          <ConfigCard cfg={data.configuration} />
          <RuntimeCard rt={data.runtime} />
        </div>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="text-[13px] text-fg-3">{label}</dt>
      <dd className="min-w-0 text-end text-[13px] font-medium text-fg">{children}</dd>
    </div>
  );
}

function DatabaseCard({ db }: { db: Health["database"] }) {
  const { t } = useApp();
  const f = useFormat();
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><Database className="size-4 text-fg-3" aria-hidden />{t("analytics.health.db")}</span>}
        actions={<Badge tone={db.ok ? "success" : "danger"} dot>{db.ok ? t("analytics.health.ok") : t("status.error")}</Badge>} />
      <dl className="px-5 pb-4">
        <Row label={t("analytics.health.latency")}><span className={cx("tabular-nums", db.latencyMs > 500 && "text-warning")}>{f.ms(db.latencyMs)}</span></Row>
        <Row label={t("analytics.health.pgVersion")}><span dir="ltr">PostgreSQL {db.version}</span></Row>
        <Row label="pgvector">{db.vector ? <Badge tone="success">v{db.vector}</Badge> : <Badge tone="danger">{t("analytics.health.notInstalled")}</Badge>}</Row>
        <Row label={t("analytics.health.migrations")}><span className="tabular-nums">{f.num(db.migrations)}</span></Row>
        <Row label={t("analytics.health.size")}><span dir="ltr">{db.size}</span></Row>
      </dl>
    </Card>
  );
}

function Availability({ v }: { v: boolean | null }) {
  const { t } = useApp();
  if (v === true) return <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-4" aria-hidden />{t("analytics.health.available")}</span>;
  if (v === false) return <span className="inline-flex items-center gap-1 text-danger"><XCircle className="size-4" aria-hidden />{t("analytics.health.unavailable")}</span>;
  return <span className="inline-flex items-center gap-1 text-fg-3"><CircleDashed className="size-4" aria-hidden />{t("analytics.health.notChecked")}</span>;
}

function AiCard({ ai, onRecheck, rechecking, recheckError }: { ai: Health["ai"]; onRecheck: () => void; rechecking: boolean; recheckError: string | null }) {
  const { t } = useApp();
  const anyUnavailable = ai.models.some((m) => m.available === false);
  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Server className="size-4 text-fg-3" aria-hidden />{t("analytics.health.ai")}</span>}
        description={ai.checked ? t("analytics.health.aiChecked") : t("analytics.health.aiNotChecked")}
        actions={<Button size="sm" variant="outline" loading={rechecking} icon={<RefreshCw className="size-3.5" />} onClick={onRecheck}>{t("analytics.health.recheck")}</Button>}
      />
      <div className="space-y-3 px-5 pb-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-fg-3">{t("analytics.health.mode")}</span>
          {ai.mode === "mock" ? <Badge tone="warning">{t("analytics.health.mock")}</Badge> : <Badge tone="success">{t("analytics.health.live")}</Badge>}
        </div>
        {ai.mode === "mock" && <Alert tone="warning">{t("analytics.health.mockDesc")}</Alert>}
        {ai.error && <Alert tone="danger" title={t("analytics.health.aiError")}><span dir="ltr">{ai.error}</span></Alert>}
        {recheckError && <Alert tone="danger">{recheckError}</Alert>}
        {anyUnavailable && <Alert tone="danger">{t("analytics.health.unavailableHint")}</Alert>}
      </div>
      <Table>
        <thead><tr><Th>{t("analytics.health.role")}</Th><Th>{t("analytics.col.model")}</Th><Th>{t("analytics.health.status")}</Th></tr></thead>
        <tbody>
          {ai.models.map((m) => (
            <tr key={m.role}>
              <Td className="text-fg">{t(`analytics.health.role.${m.role}`)}</Td>
              <Td className="font-mono text-[12.5px]">{m.model ? <span dir="ltr">{m.model}</span> : <span className="text-fg-3">{t("analytics.health.notSet")}</span>}</Td>
              <Td className="whitespace-nowrap text-[13px]"><Availability v={m.available} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="px-5 py-3 text-[12px] text-fg-3">{t("analytics.health.envNote")}</p>
    </Card>
  );
}

function QueueCard({ q }: { q: Health["queue"] }) {
  const { t } = useApp();
  const f = useFormat();
  const items: Array<[string, number]> = [
    ["running", q.running], ["planned", q.planned], ["waiting_approval", q.waitingApproval], ["paused", q.paused],
  ];
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><ListChecks className="size-4 text-fg-3" aria-hidden />{t("analytics.health.queue")}</span>}
        description={t("analytics.health.queueDesc")}
        actions={q.stalled > 0 ? <Badge tone="danger" dot>{t("analytics.health.stalledN", { n: q.stalled })}</Badge> : <Badge tone="success" dot>{t("analytics.health.healthy")}</Badge>} />
      <dl className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-5">
        {items.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-surface-2 p-3">
            <dt className="truncate text-[12px] text-fg-3">{t(`status.${k}`)}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-fg">{f.num(v)}</dd>
          </div>
        ))}
        <div className={cx("rounded-xl p-3", q.stalled > 0 ? "bg-danger-soft" : "bg-surface-2")}>
          <dt className={cx("truncate text-[12px]", q.stalled > 0 ? "text-danger" : "text-fg-3")}>{t("analytics.health.stalled")}</dt>
          <dd className={cx("mt-1 text-xl font-semibold tabular-nums", q.stalled > 0 ? "text-danger" : "text-fg")}>{f.num(q.stalled)}</dd>
        </div>
      </dl>
      {q.stalled > 0 && <p className="px-5 pb-4 text-[12.5px] text-fg-3">{t("analytics.health.stalledHint")}</p>}
    </Card>
  );
}

function ErrorsCard({ rows }: { rows: Health["recentServerErrors"] }) {
  const { t } = useApp();
  const f = useFormat();
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><ServerCrash className="size-4 text-fg-3" aria-hidden />{t("analytics.health.errors")}</span>}
        description={t("analytics.health.errorsDesc")} />
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 px-5 pb-5 text-[13px] text-success"><CheckCircle2 className="size-4" aria-hidden />{t("analytics.health.noErrors")}</p>
      ) : (
        <Table>
          <thead><tr><Th>{t("analytics.health.route")}</Th><Th>{t("analytics.health.status")}</Th><Th className="text-end">{t("analytics.health.count")}</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.route}-${r.status}`}>
                <Td className="font-mono text-[12.5px] text-fg"><span dir="ltr" className="break-all">{r.route}</span></Td>
                <Td><Badge tone="danger" className="font-mono">{r.status}</Badge></Td>
                <Td className="text-end tabular-nums">{f.num(r.n)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function ConfigCard({ cfg }: { cfg: Health["configuration"] }) {
  const { t } = useApp();
  const entries = Object.entries(cfg);
  const missingRequired = entries.filter(([k, v]) => !v && REQUIRED.has(k)).map(([k]) => k);
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><Settings2 className="size-4 text-fg-3" aria-hidden />{t("analytics.health.config")}</span>}
        description={t("analytics.health.configDesc")} />
      {missingRequired.length > 0 && <div className="px-5 pb-3"><Alert tone="danger">{t("analytics.health.missingRequired", { keys: missingRequired.join(", ") })}</Alert></div>}
      <ul className="grid gap-x-6 px-5 pb-4 sm:grid-cols-2">
        {entries.map(([k, set]) => {
          const req = REQUIRED.has(k) ? "required" : RECOMMENDED.has(k) ? "recommended" : "optional";
          return (
            <li key={k} className="flex items-center justify-between gap-2 border-b border-border py-2 last:border-0 sm:[&:nth-last-child(2)]:border-0">
              <span className="min-w-0">
                <code className="block truncate font-mono text-[12.5px] text-fg" dir="ltr">{k}</code>
                <span className="text-[11.5px] text-fg-3">{t(`analytics.health.${req}`)}</span>
              </span>
              {set ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-success"><CheckCircle2 className="size-4" aria-hidden />{t("analytics.health.set")}</span>
              ) : (
                <span className={cx("inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium", req === "required" ? "text-danger" : "text-fg-3")}>
                  <XCircle className="size-4" aria-hidden />{t("analytics.health.notSetShort")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="px-5 pb-4 text-[12px] text-fg-3">{t("analytics.health.valuesHidden")}</p>
    </Card>
  );
}

function RuntimeCard({ rt }: { rt: Health["runtime"] }) {
  const { t } = useApp();
  return (
    <Card>
      <CardHeader title={<span className="inline-flex items-center gap-2"><Server className="size-4 text-fg-3" aria-hidden />{t("analytics.health.runtime")}</span>} />
      <dl className="px-5 pb-4">
        <Row label="Node.js"><span dir="ltr" className="font-mono text-[12.5px]">{rt.node}</span></Row>
        <Row label={t("analytics.health.env")}><span dir="ltr" className="font-mono text-[12.5px]">{rt.env ?? "—"}</span></Row>
        <Row label={t("analytics.health.region")}><span dir="ltr" className="font-mono text-[12.5px]">{rt.region ?? "—"}</span></Row>
      </dl>
    </Card>
  );
}
