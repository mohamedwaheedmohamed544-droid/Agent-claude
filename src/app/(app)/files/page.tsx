"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FolderOpen, Layers, Search, TriangleAlert, Upload } from "lucide-react";
import { Page } from "@/components/page";
import { useApp } from "@/components/providers";
import { Button, Card, EmptyState, ErrorState, Input, LoadingBlock, PageHeader, Select, Stat } from "@/components/ui";
import { FilesTable } from "@/components/files/files-table";
import { UploadZone } from "@/components/files/upload-zone";
import type { BasesResponse, FilesResponse } from "@/components/files/types";
import { useApi } from "@/lib/client/hooks";

export default function FilesPage() {
  const { t, can } = useApp();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [base, setBase] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const path = useMemo(() => {
    const sp = new URLSearchParams();
    if (debouncedQ) sp.set("q", debouncedQ);
    if (status) sp.set("status", status);
    if (base) sp.set("knowledgeBaseId", base);
    const s = sp.toString();
    return `/api/files${s ? `?${s}` : ""}`;
  }, [debouncedQ, status, base]);

  const { data, error, loading, reload } = useApi<FilesResponse>(path, {
    intervalMs: (d) => (d?.files.some((f) => f.status === "processing" || f.status === "pending") ? 4000 : null),
  });
  const { data: basesData, reload: reloadBases } = useApi<BasesResponse>("/api/knowledge/bases");
  const bases = basesData?.bases ?? [];
  const files = useMemo(() => data?.files ?? [], [data]);
  const filtered = Boolean(debouncedQ || status || base);
  const member = can("member");

  const totals = useMemo(() => ({
    files: files.length,
    ready: files.filter((f) => f.status === "ready").length,
    chunks: files.reduce((n, f) => n + (f.status === "ready" ? f.chunkCount : 0), 0),
    failed: files.filter((f) => f.status === "failed").length,
  }), [files]);

  const refresh = () => { void reload(); void reloadBases(); };

  return (
    <Page wide>
      <PageHeader
        icon={<FolderOpen className="size-5" />}
        title={t("files.title")}
        description={t("files.subtitle")}
        actions={member && (
          <Button icon={<Upload className="size-4" />} onClick={() => setShowUpload((v) => !v)} variant={showUpload ? "secondary" : "primary"}>
            {showUpload ? t("files.upload.hide") : t("files.upload.button")}
          </Button>
        )}
      />

      {member && (showUpload || (!loading && !filtered && files.length === 0)) && (
        <div className="mb-6">
          <UploadZone
            knowledgeBaseId={base && base !== "none" ? base : null}
            maxUploadBytes={data?.limits.maxUploadBytes}
            onUploaded={refresh}
          />
        </div>
      )}

      {!filtered && files.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t("files.stats.files")} value={totals.files} icon={<FolderOpen className="size-4" />} />
          <Stat label={t("files.stats.ready")} value={totals.ready} icon={<CheckCircle2 className="size-4" />} tone="success" />
          <Stat label={t("files.stats.chunks")} value={totals.chunks.toLocaleString()} icon={<Layers className="size-4" />} tone="info" />
          <Stat label={t("files.stats.failed")} value={totals.failed} icon={<TriangleAlert className="size-4" />} tone={totals.failed ? "danger" : "neutral"} />
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("files.searchPlaceholder")} className="ps-9" aria-label={t("files.searchPlaceholder")} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("files.filter.status")} className="sm:w-40">
              <option value="">{t("files.filter.allStatuses")}</option>
              <option value="ready">{t("status.ready")}</option>
              <option value="processing">{t("status.processing")}</option>
              <option value="failed">{t("status.failed")}</option>
            </Select>
            <Select value={base} onChange={(e) => setBase(e.target.value)} aria-label={t("files.filter.base")} className="sm:w-48">
              <option value="">{t("files.filter.allBases")}</option>
              <option value="none">{t("files.noBase")}</option>
              {bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
        </div>

        {loading && !data ? (
          <div className="p-4"><LoadingBlock rows={5} /></div>
        ) : error ? (
          <div className="p-4"><ErrorState error={error} onRetry={reload} /></div>
        ) : files.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Search className="size-5" />}
              title={t("files.empty.filteredTitle")}
              description={t("files.empty.filteredBody")}
              action={<Button variant="outline" size="sm" onClick={() => { setQ(""); setStatus(""); setBase(""); }}>{t("files.empty.clearFilters")}</Button>}
            />
          ) : (
            <EmptyState icon={<FolderOpen className="size-5" />} title={t("files.empty.title")} description={member ? t("files.empty.body") : t("files.empty.viewerBody")} />
          )
        ) : (
          <FilesTable files={files} bases={bases} onChanged={refresh} />
        )}
      </Card>
    </Page>
  );
}
