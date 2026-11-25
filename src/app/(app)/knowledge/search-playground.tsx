"use client";

import { useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { api } from "@/lib/client/api";
import { useApp } from "@/components/providers";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Input, Select, cx } from "@/components/ui";
import { FileTypeIcon } from "@/components/files/file-icon";
import { FilePreviewDialog, chunkLocation } from "@/components/files/file-preview";
import type { ChunkPreview, KnowledgeBase } from "@/components/files/types";

interface Hit {
  fileId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  score: number;
  metadata: ChunkPreview["metadata"];
}

function queryTerms(q: string): string[] {
  const terms = q.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  return [...new Set(terms)].sort((a, b) => b.length - a.length).slice(0, 20);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns a window of the passage around the first matching term so the relevant part is visible. */
function snippet(content: string, terms: string[], max = 520): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const lower = text.toLowerCase();
  const first = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(first - Math.floor(max / 3), text.length - max));
  return `${start > 0 ? "… " : ""}${text.slice(start, start + max).trim()}${start + max < text.length ? " …" : ""}`;
}

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "giu");
  const set = new Set(terms.map((t) => t.toLowerCase()));
  return (
    <>
      {text.split(re).map((part, i) => set.has(part.toLowerCase())
        ? <mark key={i} className="rounded-sm bg-accent-soft px-0.5 font-medium text-accent-text">{part}</mark>
        : <span key={i}>{part}</span>)}
    </>
  );
}

export function SearchPlayground({ bases, defaultBaseId }: { bases: KnowledgeBase[]; defaultBaseId?: string | null }) {
  const { t } = useApp();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<string>(defaultBaseId ?? "");
  const [scopeTouched, setScopeTouched] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [lastQuery, setLastQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Follow the selected base until the user picks a scope explicitly.
  const effectiveScope = scopeTouched ? scope : (defaultBaseId ?? "");
  const terms = useMemo(() => queryTerms(lastQuery), [lastQuery]);

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ hits: Hit[] }>("/api/knowledge/search", {
        method: "POST",
        body: { query: q, knowledgeBaseId: effectiveScope || null, limit: 10 },
      });
      setHits(r.hits);
      setLastQuery(q);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader title={t("knowledge.search.title")} description={t("knowledge.search.subtitle")} />
      <form onSubmit={run} className="space-y-2 px-5 pb-4">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
          <Input
            value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" maxLength={1000}
            placeholder={t("knowledge.search.placeholder")} aria-label={t("knowledge.search.placeholder")} className="h-10 ps-9"
          />
        </div>
        <div className="flex gap-2">
          <Select value={effectiveScope} onChange={(e) => { setScope(e.target.value); setScopeTouched(true); }} aria-label={t("knowledge.search.scope")} className="min-w-0 flex-1">
            <option value="">{t("knowledge.search.allBases")}</option>
            {bases.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Button type="submit" loading={busy} disabled={!query.trim()} icon={<Sparkles className="size-4" />}>{t("action.search")}</Button>
        </div>
      </form>

      <div className="border-t border-border px-5 py-4">
        {error ? <Alert tone="danger">{error}</Alert>
          : hits === null ? (
            <div className="py-6 text-center">
              <p className="text-[13px] text-fg-3">{t("knowledge.search.intro")}</p>
            </div>
          ) : hits.length === 0 ? (
            <EmptyState icon={<Search className="size-5" />} title={t("knowledge.search.noResults")} description={t("knowledge.search.noResultsBody")} />
          ) : (
            <ol className="space-y-3">
              <li className="text-[12px] text-fg-3">{t("knowledge.search.resultsFor", { n: hits.length, q: lastQuery })}</li>
              {hits.map((h, i) => {
                const pct = Math.round(Math.max(0, Math.min(1, h.score)) * 100);
                return (
                  <li key={`${h.fileId}-${h.chunkIndex}`} className="rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 font-mono text-[11.5px] font-semibold text-fg-2">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <button onClick={() => setPreviewId(h.fileId)} className="flex min-w-0 items-center gap-1.5 text-start text-[13px] font-medium text-fg hover:text-accent-text">
                            <FileTypeIcon filename={h.filename} size="sm" />
                            <span className="truncate" dir="auto">{h.filename}</span>
                          </button>
                          {chunkLocation(h.metadata, t).map((l) => <Badge key={l} tone="info">{l}</Badge>)}
                          <span className="text-[11.5px] text-fg-3">{t("knowledge.search.passage", { n: h.chunkIndex + 1 })}</span>
                        </div>
                        {h.metadata.heading && <p className="mt-1 truncate text-[12px] font-medium text-fg-3" dir="auto">{h.metadata.heading}</p>}
                        <p dir="auto" className="mt-1.5 text-start text-[13px] leading-relaxed text-fg-2">
                          <Highlighted text={snippet(h.content, terms)} terms={terms} />
                        </p>
                      </div>
                      <div className="w-14 shrink-0 text-end" title={t("knowledge.search.scoreHint")}>
                        <p className="text-[13px] font-semibold tabular-nums text-fg">{h.score.toFixed(2)}</p>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
                          <div className={cx("h-full rounded-full", pct >= 60 ? "bg-success" : pct >= 35 ? "bg-accent" : "bg-fg-3")} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
      </div>
      <FilePreviewDialog fileId={previewId} onClose={() => setPreviewId(null)} />
    </Card>
  );
}
