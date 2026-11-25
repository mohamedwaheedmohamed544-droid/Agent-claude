"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { timeAgo } from "@/lib/client/hooks";
import { useApp } from "@/components/providers";
import { Button, Dialog, ErrorState, Input, Skeleton, Switch, cx } from "@/components/ui";
import type { Conversation } from "./types";

export function ConversationList({ conversations, loading, error, reload, currentId, showArchived, onToggleArchived, onNew, onRemoved }: {
  conversations: Conversation[] | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
  currentId: string | null;
  showArchived: boolean;
  onToggleArchived: (v: boolean) => void;
  onNew: () => void;
  onRemoved: (id: string) => void;
}) {
  const { t } = useApp();
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menu]);

  async function patch(id: string, body: { title?: string; archived?: boolean }) {
    setActionError(null);
    try {
      await api(`/api/conversations/${id}`, { method: "PATCH", body });
      reload();
      if (body.archived === true) onRemoved(id);
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  async function saveRename(id: string) {
    const title = renameValue.trim();
    setRenaming(null);
    if (title) await patch(id, { title });
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/conversations/${deleting.id}`, { method: "DELETE" });
      onRemoved(deleting.id);
      setDeleting(null);
      reload();
    } catch (e) {
      setActionError((e as Error).message);
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button className="w-full justify-center" icon={<Plus className="size-4" />} onClick={onNew}>{t("chat.newChat")}</Button>
      </div>
      <p className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
        {showArchived ? t("chat.archivedChats") : t("chat.recentChats")}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {actionError && <p className="mx-2 mb-2 rounded-lg bg-danger-soft px-2.5 py-1.5 text-[12px] text-danger" role="alert">{actionError}</p>}
        {error && !conversations ? <div className="p-2"><ErrorState error={error} onRetry={reload} /></div> : loading && !conversations ? (
          <div className="space-y-1.5 p-1">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
        ) : !conversations?.length ? (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <MessageSquare className="mb-2 size-5 text-fg-3" />
            <p className="text-[13px] text-fg-3">{showArchived ? t("chat.noArchived") : t("chat.noConversations")}</p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((c) => {
              const active = c.id === currentId;
              return (
                <li key={c.id} className="group relative">
                  {renaming === c.id ? (
                    <form className="p-1" onSubmit={(e) => { e.preventDefault(); void saveRename(c.id); }}>
                      <Input autoFocus value={renameValue} maxLength={200} dir="auto" aria-label={t("chat.renameLabel")}
                        onChange={(e) => setRenameValue(e.target.value)} onBlur={() => void saveRename(c.id)}
                        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setRenaming(null); } }} />
                    </form>
                  ) : (
                    <>
                      <Link href={`/chat/${c.id}`} aria-current={active ? "page" : undefined}
                        className={cx("block rounded-lg py-2 ps-3 pe-9 transition-colors",
                          active ? "bg-surface text-fg shadow-card ring-1 ring-border" : "text-fg-2 hover:bg-surface-2 hover:text-fg")}>
                        <span className="block truncate text-[13.5px] font-medium" dir="auto">{c.title || t("chat.untitled")}</span>
                        <span className="block text-[11.5px] text-fg-3">{timeAgo(c.updatedAt, t)}</span>
                      </Link>
                      <button type="button" onClick={() => setMenu(menu === c.id ? null : c.id)}
                        aria-haspopup="menu" aria-expanded={menu === c.id} aria-label={t("chat.conversationActions")}
                        className={cx("absolute end-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-fg-3 hover:bg-surface-3 hover:text-fg focus:opacity-100",
                          menu === c.id || active ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100")}>
                        <MoreHorizontal className="size-4" />
                      </button>
                      {menu === c.id && (
                        <div ref={menuRef} role="menu" className="absolute end-1.5 top-full z-20 mt-1 w-44 rounded-xl border border-border bg-surface p-1 shadow-pop">
                          <MenuItem icon={<Pencil className="size-3.5" />} onClick={() => { setMenu(null); setRenameValue(c.title); setRenaming(c.id); }}>{t("chat.rename")}</MenuItem>
                          <MenuItem icon={c.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
                            onClick={() => { setMenu(null); void patch(c.id, { archived: !c.archived }); }}>
                            {c.archived ? t("chat.unarchive") : t("chat.archive")}
                          </MenuItem>
                          <MenuItem danger icon={<Trash2 className="size-3.5" />} onClick={() => { setMenu(null); setDeleting(c); }}>{t("action.delete")}</MenuItem>
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <span className="text-[12.5px] text-fg-2">{t("chat.showArchived")}</span>
        <Switch checked={showArchived} onChange={onToggleArchived} label={t("chat.showArchived")} />
      </div>

      <Dialog open={!!deleting} onClose={() => setDeleting(null)} size="sm" title={t("chat.deleteTitle")}
        description={t("chat.deleteBody")}
        footer={<>
          <Button variant="outline" onClick={() => setDeleting(null)}>{t("action.cancel")}</Button>
          <Button variant="danger" loading={busy} onClick={() => void confirmDelete()}>{t("action.delete")}</Button>
        </>}>
        <p className="text-sm font-medium text-fg" dir="auto">{deleting?.title || t("chat.untitled")}</p>
      </Dialog>
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick}
      className={cx("flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[13px]", danger ? "text-danger hover:bg-danger-soft" : "text-fg-2 hover:bg-surface-2 hover:text-fg")}>
      {icon}{children}
    </button>
  );
}
