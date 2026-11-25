"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, MessageSquareDashed, PanelLeft, Plus, Sparkles, X } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { useApp } from "@/components/providers";
import { Page } from "@/components/page";
import { Alert, Button, EmptyState, Skeleton } from "@/components/ui";
import { ConversationList } from "./conversation-list";
import { Composer, type ComposerHandle } from "./composer";
import { MessageItem, PlanningIndicator } from "./message";
import { SuggestedPrompts } from "./suggested-prompts";
import type { ChatMessage, ChatResponse, Conversation } from "./types";

interface ConversationResponse {
  conversation: Conversation;
  messages: ChatMessage[];
  tasks: Array<{ id: string; status: string }>;
}

/** Number of result/failure messages a task has posted to the conversation. */
function outcomes(list: ChatMessage[], taskId: string): number {
  return list.filter((m) => m.taskId === taskId && (m.metadata?.kind === "task_result" || m.metadata?.kind === "task_failed")).length;
}

function idFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/chat\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * The AI Workspace. Mounted from chat/layout.tsx so state survives the /chat → /chat/[id]
 * navigation that happens when the first message of a new conversation is sent.
 */
export function ChatWorkspace() {
  const { t, can } = useApp();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = idFromPath(pathname);

  const [showArchived, setShowArchived] = useState(false);
  const convs = useApi<{ conversations: Conversation[] }>(`/api/conversations${showArchived ? "?archived=1" : ""}`, { intervalMs: 60_000 });
  const reloadConvs = convs.reload;

  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [convError, setConvError] = useState<Error | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<ApiError | Error | null>(null);
  const [draft, setDraft] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const currentIdRef = useRef<string | null>(id);
  currentIdRef.current = id;
  const createdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const composerRef = useRef<ComposerHandle>(null);

  const loadConv = useCallback(async (cid: string, opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setConvLoading(true);
    try {
      const d = await api<ConversationResponse>(`/api/conversations/${cid}`);
      if (currentIdRef.current !== cid) return d;
      setConv(d.conversation);
      setMessages((cur) => [...d.messages, ...cur.filter((m) => m.pending)]);
      setConvError(null);
      return d;
    } catch (e) {
      if (currentIdRef.current === cid) setConvError(e as Error);
      return null;
    } finally {
      if (currentIdRef.current === cid) setConvLoading(false);
    }
  }, []);

  // Switch conversations.
  useEffect(() => {
    setDrawer(false);
    setSendError(null);
    if (!id) {
      setConv(null);
      setMessages([]);
      setConvError(null);
      setConvLoading(false);
      return;
    }
    stickRef.current = true;
    if (createdRef.current === id) {
      // We just created this conversation from /chat; keep the optimistic state and sync quietly.
      createdRef.current = null;
      void loadConv(id, { silent: true });
      return;
    }
    setConv(null);
    setMessages([]);
    setDraft("");
    void loadConv(id);
  }, [id, loadConv]);

  // Prefill from ?q= (e.g. links from other pages).
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !id) { setDraft(q); composerRef.current?.focus(); }
  }, [searchParams, id]);

  // Keep the view pinned to the newest message unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    stickRef.current = near;
    setAtBottom(near);
  };
  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  async function send(text: string, attachments: Array<{ id: string; filename: string }>): Promise<boolean> {
    const temp: ChatMessage = {
      id: `tmp-${Date.now()}`, role: "user", content: text, agentSlug: null, taskId: null,
      metadata: { attachments }, createdAt: new Date().toISOString(), pending: true,
    };
    stickRef.current = true;
    setMessages((m) => [...m, temp]);
    setSending(true);
    setSendError(null);
    setDraft("");
    const startedIn = id;
    try {
      const r = await api<ChatResponse>("/api/chat", {
        method: "POST",
        body: { message: text, conversationId: startedIn ?? undefined, fileIds: attachments.length ? attachments.map((a) => a.id) : undefined },
      });
      if (currentIdRef.current === startedIn) {
        setMessages((m) => [...m.filter((x) => x.id !== temp.id && x.id !== r.userMessage.id && x.id !== r.reply.id), r.userMessage, r.reply]);
        if (!startedIn) {
          createdRef.current = r.conversationId;
          router.replace(`/chat/${r.conversationId}`);
        }
      }
      void reloadConvs();
      return true;
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setDraft(text);
      setSendError(e as Error);
      // Server errors after the message was stored: re-sync so the stored error message shows.
      if (startedIn && e instanceof ApiError && e.status >= 500 && e.status !== 503) void loadConv(startedIn, { silent: true });
      void reloadConvs();
      return false;
    } finally {
      setSending(false);
    }
  }

  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const retries = useRef<Record<string, number>>({});
  /**
   * A task card reached a terminal state: reload so the result message appears. The result is written
   * right after the status flips, so retry briefly until a new outcome message shows up.
   */
  const onTaskFinished = useCallback(async (taskId: string, observed: boolean, baseline?: number) => {
    const cid = currentIdRef.current;
    if (!cid) return;
    const before = baseline ?? outcomes(messagesRef.current, taskId);
    // Already-finished task on first load whose outcome is already shown: nothing to do.
    if (!observed && before > 0) return;
    stickRef.current = true;
    const d = await loadConv(cid, { silent: true });
    if (d && outcomes(d.messages, taskId) <= before && (retries.current[taskId] ?? 0) < 4) {
      retries.current[taskId] = (retries.current[taskId] ?? 0) + 1;
      setTimeout(() => void onTaskFinished(taskId, true, before), 1500);
    } else {
      retries.current[taskId] = 0;
    }
    void reloadConvs();
  }, [loadConv, reloadConvs]);

  const newChat = () => { setDraft(""); router.push("/chat"); composerRef.current?.focus(); };
  const onRemoved = (cid: string) => { if (cid === id) router.push("/chat"); };

  const list = (
    <ConversationList
      conversations={convs.data?.conversations ?? null} loading={convs.loading} error={convs.error} reload={() => void convs.reload()}
      currentId={id} showArchived={showArchived} onToggleArchived={setShowArchived} onNew={newChat} onRemoved={onRemoved}
    />
  );

  const notFound = convError instanceof ApiError && convError.status === 404;
  const readOnly = !can("member");
  const showEmpty = !id && messages.length === 0;

  return (
    <Page flush className="flex overflow-hidden">
      {/* Conversation list: side pane on md+, drawer on phones */}
      <aside className="hidden w-72 shrink-0 border-e border-border bg-bg md:block" aria-label={t("chat.conversations")}>{list}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={t("chat.conversations")}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 start-0 flex w-[300px] max-w-[85vw] flex-col border-e border-border bg-bg shadow-modal">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[14px] font-semibold text-fg">{t("chat.conversations")}</span>
              <button type="button" onClick={() => setDrawer(false)} className="rounded-lg p-1.5 text-fg-3 hover:bg-surface-2" aria-label={t("action.close")}><X className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1">{list}</div>
          </div>
        </div>
      )}

      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
          <button type="button" onClick={() => setDrawer(true)} className="rounded-lg p-1.5 text-fg-2 hover:bg-surface-2 md:hidden" aria-label={t("chat.openConversations")}>
            <PanelLeft className="size-[18px] rtl:-scale-x-100" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-fg" dir="auto">
            {id ? (conv?.title || (convLoading ? "" : t("chat.untitled"))) : t("chat.newConversation")}
          </h1>
          {id && <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={newChat} className="md:hidden">{t("chat.newChatShort")}</Button>}
        </header>

        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            {notFound ? (
              <EmptyState icon={<MessageSquareDashed className="size-5" />} title={t("chat.notFound")} description={t("chat.notFoundBody")}
                action={<Button onClick={newChat} icon={<Plus className="size-4" />}>{t("chat.newChat")}</Button>} />
            ) : convError && !messages.length ? (
              <Alert tone="danger" title={t("state.error")} action={<Button size="sm" variant="outline" onClick={() => id && void loadConv(id)}>{t("action.retry")}</Button>}>{convError.message}</Alert>
            ) : convLoading && !messages.length ? (
              <div className="space-y-6">
                <Skeleton className="ms-auto h-12 w-2/3 rounded-2xl" />
                <div className="flex gap-3"><Skeleton className="size-8 shrink-0" /><Skeleton className="h-28 flex-1 rounded-2xl" /></div>
                <Skeleton className="ms-auto h-10 w-1/2 rounded-2xl" />
              </div>
            ) : showEmpty ? (
              <div className="flex flex-col items-center pt-4 text-center sm:pt-10">
                <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-text"><Sparkles className="size-6" /></span>
                <h2 className="text-xl font-semibold tracking-tight text-fg">{t("chat.emptyTitle")}</h2>
                <p className="mt-1.5 max-w-md text-[14px] text-fg-3">{t("chat.emptyBody")}</p>
                <SuggestedPrompts className="mt-7 w-full text-start" onPick={(text) => { setDraft(text); composerRef.current?.focus(); }} />
              </div>
            ) : (
              <ol className="space-y-6" aria-live="polite" aria-relevant="additions">
                {messages.map((m) => (
                  <li key={m.id}><MessageItem m={m} onTaskFinished={onTaskFinished} /></li>
                ))}
                {sending && <li><PlanningIndicator /></li>}
              </ol>
            )}
          </div>
        </div>

        {!atBottom && !showEmpty && (
          <button type="button" onClick={scrollToBottom} aria-label={t("chat.scrollToBottom")}
            className="absolute bottom-28 start-1/2 z-10 grid size-9 -translate-x-1/2 rtl:translate-x-1/2 place-items-center rounded-full border border-border bg-surface text-fg-2 shadow-pop hover:text-fg">
            <ArrowDown className="size-4" />
          </button>
        )}

        <div className="shrink-0 border-t border-border bg-bg/80 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-4">
          <div className="mx-auto w-full max-w-3xl space-y-2">
            {sendError && <SendErrorAlert error={sendError} onDismiss={() => setSendError(null)} />}
            {readOnly ? (
              <p className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-center text-[13px] text-fg-3">{t("chat.viewerReadOnly")}</p>
            ) : (
              <Composer ref={composerRef} value={draft} onChange={setDraft} onSend={send} sending={sending} conversationId={id} autoFocus disabled={notFound} />
            )}
            <p className="hidden text-center text-[11px] text-fg-3 sm:block">{t("chat.hint")}</p>
          </div>
        </div>
      </section>
    </Page>
  );
}

export function SendErrorAlert({ error, onDismiss }: { error: Error; onDismiss: () => void }) {
  const { t } = useApp();
  const status = error instanceof ApiError ? error.status : 0;
  const dismiss = (
    <button type="button" onClick={onDismiss} className="rounded p-0.5 opacity-70 hover:opacity-100" aria-label={t("action.close")}><X className="size-4" /></button>
  );
  if (status === 503) return <Alert tone="warning" title={t("chat.aiNotConfigured")} action={dismiss}>{t("chat.aiNotConfiguredBody")}</Alert>;
  if (status === 429) return <Alert tone="warning" title={t("chat.rateLimited")} action={dismiss}>{error.message}</Alert>;
  if (status === 423) return <Alert tone="danger" title={t("chat.emergencyStop")} action={dismiss}>{error.message}</Alert>;
  return <Alert tone="danger" title={t("chat.sendFailed")} action={dismiss}>{error.message}</Alert>;
}

