"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Plug, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Page } from "@/components/page";
import { Alert, Badge, Button, Dialog, ErrorState, LoadingBlock, PageHeader, cx } from "@/components/ui";
import { useApp } from "@/components/providers";
import { api, ApiError } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { IntegrationCard, type CardKey } from "@/components/integrations/integration-card";
import type { IntegrationInfo, TestResult } from "@/components/integrations/types";

type Group = "communication" | "calendar" | "storage" | "ai" | "automation";
type OAuthProvider = "google" | "microsoft";

const LAYOUT: Array<{ group: Group; cards: Array<{ key: CardKey; provider?: string; service?: string }> }> = [
  { group: "communication", cards: [{ key: "gmail", provider: "google", service: "gmail" }, { key: "outlook", provider: "microsoft", service: "outlook" }] },
  { group: "calendar", cards: [{ key: "google_calendar", provider: "google", service: "google_calendar" }, { key: "outlook_calendar", provider: "microsoft", service: "outlook_calendar" }] },
  { group: "storage", cards: [{ key: "google_drive", provider: "google", service: "google_drive" }] },
  { group: "ai", cards: [{ key: "anthropic", provider: "anthropic" }, { key: "web_search", provider: "web_search" }, { key: "neon", provider: "neon" }] },
  { group: "automation", cards: [{ key: "webhook", provider: "webhook" }, { key: "crm" }] },
];

const PROVIDER_NAME: Record<OAuthProvider, string> = { google: "Google Workspace", microsoft: "Microsoft 365" };
const SERVICES_OF: Record<OAuthProvider, CardKey[]> = { google: ["gmail", "google_calendar", "google_drive"], microsoft: ["outlook", "outlook_calendar"] };

type Notice = { tone: "success" | "danger"; title: string; body?: string };

export default function IntegrationsPage() {
  const { t, can } = useApp();
  const router = useRouter();
  const isAdmin = can("admin");
  const { data, error, loading, reload } = useApi<{ integrations: IntegrationInfo[] }>("/api/integrations");
  const [busy, setBusy] = useState<Partial<Record<OAuthProvider, "connect" | "test" | "disconnect">>>({});
  const [tests, setTests] = useState<Partial<Record<OAuthProvider, TestResult>>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<OAuthProvider | null>(null);

  // Result of the OAuth redirect: ?connected=<provider> or ?error=<code>. Shown once, then removed from the URL.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const connected = sp.get("connected");
    const err = sp.get("error");
    if (!connected && !err) return;
    if (connected === "google" || connected === "microsoft") {
      setNotice({ tone: "success", title: t("integrations.notice.connected", { name: PROVIDER_NAME[connected] }) });
    } else if (err) {
      const code = /^[a-z_]{1,40}$/.test(err) ? err : "provider_error";
      const known = t(`integrations.error.${code}`);
      setNotice({ tone: "danger", title: t("integrations.notice.error"), body: known.startsWith("integrations.") ? t("integrations.error.provider_error") : known });
    }
    router.replace("/integrations", { scroll: false });
  }, [router, t]);

  const byProvider = useMemo(() => new Map((data?.integrations ?? []).map((i) => [i.provider, i])), [data]);

  const connect = useCallback(async (provider: OAuthProvider) => {
    setBusy((b) => ({ ...b, [provider]: "connect" }));
    try {
      const { authorizeUrl } = await api<{ authorizeUrl: string }>(`/api/integrations/${provider}/connect`, { method: "POST", body: {} });
      window.location.assign(authorizeUrl);
    } catch (e) {
      setNotice({ tone: "danger", title: t("integrations.notice.error"), body: e instanceof ApiError ? e.message : String(e) });
      setBusy((b) => ({ ...b, [provider]: undefined }));
    }
  }, [t]);

  const test = useCallback(async (provider: OAuthProvider) => {
    setBusy((b) => ({ ...b, [provider]: "test" }));
    try {
      const r = await api<TestResult>(`/api/integrations/${provider}/test`, { method: "POST", body: {} });
      setTests((x) => ({ ...x, [provider]: r }));
      if (!r.ok) await reload();
    } catch (e) {
      setTests((x) => ({ ...x, [provider]: { ok: false, latencyMs: 0, account: null, error: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setBusy((b) => ({ ...b, [provider]: undefined }));
    }
  }, [reload]);

  const disconnect = useCallback(async (provider: OAuthProvider) => {
    setBusy((b) => ({ ...b, [provider]: "disconnect" }));
    try {
      await api(`/api/integrations/${provider}/disconnect`, { method: "POST", body: {} });
      setTests((x) => ({ ...x, [provider]: undefined }));
      await reload();
    } catch (e) {
      setNotice({ tone: "danger", title: t("integrations.notice.error"), body: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy((b) => ({ ...b, [provider]: undefined }));
      setConfirm(null);
    }
  }, [reload, t]);

  const list = data?.integrations ?? [];
  const connectedCount = list.filter((i) => i.status === "connected").length;
  const attention = list.filter((i) => i.status === "error").length;
  const setupable = list.filter((i) => i.kind === "oauth" && i.status === "disconnected").length;
  const encryptionMissing = list.some((i) => i.kind === "oauth" && i.configured && i.details?.encryptionReady === false);

  return (
    <Page wide>
      <PageHeader
        icon={<Plug className="size-5" />}
        title={t("integrations.title")}
        description={t("integrations.subtitle")}
        actions={data && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="success" dot>{t("integrations.summary.connected", { n: connectedCount })}</Badge>
            {attention > 0 && <Badge tone="danger" dot>{t("integrations.summary.attention", { n: attention })}</Badge>}
            {setupable > 0 && <Badge tone="neutral">{t("integrations.summary.available", { n: setupable })}</Badge>}
          </div>
        )}
      />

      {notice && (
        <div role="status" className={cx("mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
          notice.tone === "success" ? "border-transparent bg-success-soft text-success" : "border-transparent bg-danger-soft text-danger")}>
          {notice.tone === "success" ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="font-medium">{notice.title}</p>
            {notice.body && <p className="mt-0.5 opacity-90">{notice.body}</p>}
          </div>
          <button type="button" onClick={() => setNotice(null)} className="rounded-md p-0.5 opacity-80 hover:opacity-100" aria-label={t("integrations.action.dismiss")}>
            <X className="size-4" />
          </button>
        </div>
      )}

      {encryptionMissing && isAdmin && <div className="mb-5"><Alert tone="warning">{t("integrations.encryptionMissing")}</Alert></div>}

      {error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <LoadingBlock rows={4} />
      ) : (
        <div className="space-y-9">
          {LAYOUT.map(({ group, cards }) => (
            <section key={group} aria-labelledby={`grp-${group}`}>
              <div className="mb-3 flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <h2 id={`grp-${group}`} className="text-[15px] font-semibold tracking-tight text-fg">{t(`integrations.group.${group}`)}</h2>
                <p className="text-[13px] text-fg-3">{t(`integrations.group.${group}.desc`)}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {cards.map(({ key, provider, service }) => {
                  const entry = provider ? byProvider.get(provider) : undefined;
                  const svc = service ? entry?.services?.find((s) => s.key === service) : undefined;
                  const oauth = provider === "google" || provider === "microsoft" ? (provider as OAuthProvider) : null;
                  return (
                    <IntegrationCard
                      key={key}
                      cardKey={key}
                      entry={entry}
                      tools={svc?.tools}
                      capabilities={svc?.capabilities}
                      isAdmin={isAdmin}
                      busy={oauth ? busy[oauth] ?? null : null}
                      testResult={oauth ? tests[oauth] ?? null : null}
                      onConnect={oauth ? () => connect(oauth) : undefined}
                      onTest={oauth ? () => test(oauth) : undefined}
                      onDisconnect={oauth ? () => setConfirm(oauth) : undefined}
                    />
                  );
                })}
              </div>
            </section>
          ))}

          <p className="flex items-start gap-2 text-[12.5px] text-fg-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            <span>{t("integrations.shared.google")} {t("integrations.shared.microsoft")}</span>
          </p>
        </div>
      )}

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        size="sm"
        title={confirm ? t("integrations.disconnect.title", { name: PROVIDER_NAME[confirm] }) : ""}
        footer={confirm && (
          <>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy[confirm] === "disconnect"}>{t("action.cancel")}</Button>
            <Button variant="danger" onClick={() => disconnect(confirm)} loading={busy[confirm] === "disconnect"}>{t("integrations.action.disconnect")}</Button>
          </>
        )}
      >
        {confirm && (
          <div className="space-y-2 text-[13.5px] text-fg-2">
            <p>{t("integrations.disconnect.body", { services: SERVICES_OF[confirm].map((k) => t(`integrations.service.${k}`)).join(" · ") })}</p>
            <p className="text-fg-3">{t(`integrations.disconnect.${confirm}`)}</p>
          </div>
        )}
      </Dialog>
    </Page>
  );
}
