"use client";

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, FileText, Loader2, Paperclip, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { formatBytes } from "@/lib/client/hooks";
import { useApp } from "@/components/providers";
import { cx } from "@/components/ui";
import type { UploadedFile } from "./types";

interface Attachment {
  localId: string;
  name: string;
  size: number;
  state: "uploading" | "uploaded" | "error";
  file?: UploadedFile;
  error?: string;
}

const MAX_ATTACHMENTS = 10;
const ACCEPT = ".pdf,.docx,.txt,.md,.csv,.xlsx,.json,.html,.htm";

export interface ComposerHandle { focus: () => void }

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  /** Returns true when the message was accepted, so the composer can clear its attachments. */
  onSend: (text: string, attachments: Array<{ id: string; filename: string }>) => Promise<boolean>;
  sending?: boolean;
  disabled?: boolean;
  conversationId?: string | null;
  attachments?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

/** Auto-growing message box. Enter sends, Shift+Enter inserts a newline; files upload as soon as they are attached. */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { value, onChange, onSend, sending, disabled, conversationId, attachments: allowAttachments = true, placeholder, autoFocus, className }, ref,
) {
  const { t } = useApp();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Attachment[]>([]);
  useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus() }), []);

  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  const uploading = items.some((i) => i.state === "uploading");
  const ready = items.filter((i) => i.state === "uploaded" && i.file && i.file.status !== "failed");
  const canSend = value.trim().length > 0 && !sending && !disabled && !uploading;

  async function submit() {
    if (!canSend) return;
    const ok = await onSend(value.trim(), ready.map((i) => ({ id: i.file!.id, filename: i.file!.filename })));
    if (ok) setItems([]);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_ATTACHMENTS - items.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    const added: Attachment[] = list.map((f, i) => ({ localId: `${Date.now()}-${i}-${f.name}`, name: f.name, size: f.size, state: "uploading" }));
    setItems((cur) => [...cur, ...added]);
    await Promise.all(list.map(async (f, i) => {
      const localId = added[i].localId;
      try {
        const fd = new FormData();
        fd.append("file", f);
        if (conversationId) fd.append("conversationId", conversationId);
        const r = await api<{ file: UploadedFile; duplicate?: boolean }>("/api/files", { method: "POST", body: fd });
        setItems((cur) => cur.map((x) => x.localId === localId
          ? { ...x, state: r.file.status === "failed" ? "error" : "uploaded", file: r.file, error: r.file.error ?? undefined } : x));
      } catch (e) {
        setItems((cur) => cur.map((x) => (x.localId === localId ? { ...x, state: "error", error: (e as Error).message } : x)));
      }
    }));
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className={cx("rounded-2xl border border-border bg-surface shadow-pop transition-colors focus-within:border-accent/60 focus-within:ring-3 focus-within:ring-[var(--ring)]", className)}>
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-3 pt-3" aria-label={t("chat.attachments")}>
          {items.map((i) => (
            <li key={i.localId}
              className={cx("flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px]",
                i.state === "error" ? "border-danger/40 bg-danger-soft text-danger" : "border-border bg-surface-2 text-fg-2")}
              title={i.error ?? i.name}>
              {i.state === "uploading" ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <FileText className="size-3.5 shrink-0" />}
              <span className="max-w-[180px] truncate" dir="auto">{i.name}</span>
              <span className="shrink-0 text-fg-3">
                {i.state === "uploading" ? t("chat.uploading") : i.state === "error" ? t("chat.uploadFailed")
                  : i.file?.status && i.file.status !== "ready" ? t(`status.${i.file.status}`) : formatBytes(i.size)}
              </span>
              <button type="button" onClick={() => setItems((cur) => cur.filter((x) => x.localId !== i.localId))}
                className="rounded p-0.5 hover:bg-surface-3" aria-label={t("chat.removeAttachment", { name: i.name })}>
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-1.5 p-2">
        {allowAttachments && (
          <>
            <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => void upload(e.target.files)} tabIndex={-1} aria-hidden />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={disabled || items.length >= MAX_ATTACHMENTS}
              className="grid size-9 shrink-0 place-items-center rounded-xl text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
              aria-label={t("chat.attach")} title={t("chat.attach")}>
              <Paperclip className="size-[18px]" />
            </button>
          </>
        )}
        <label className="sr-only" htmlFor="nexus-composer">{t("chat.messageLabel")}</label>
        <textarea
          id="nexus-composer"
          ref={taRef}
          rows={1}
          dir="auto"
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={20_000}
          style={{ outline: "none" }}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder ?? t("chat.placeholder")}
          className="max-h-60 min-h-9 flex-1 resize-none bg-transparent px-1.5 py-2 text-[14.5px] leading-relaxed text-fg placeholder:text-fg-3 focus:outline-none disabled:opacity-60"
        />
        <button type="button" onClick={() => void submit()} disabled={!canSend}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white shadow-card transition-colors hover:bg-accent-hover disabled:bg-surface-3 disabled:text-fg-3 disabled:shadow-none"
          aria-label={t("chat.send")} title={t("chat.send")}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
      </div>
    </div>
  );
});
