import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DirectMessage, User } from "../types";
import { fetchConnectionsList, fetchMessages, markMessagesRead, sendMessage } from "../api/socialClient";

interface Conversation {
  user: User;
  messages: DirectMessage[] | null;
  hasOlder: boolean;
}

const HISTORY_PAGE_SIZE = 100;

function mergeMessages(existing: DirectMessage[], incoming: DirectMessage[]): DirectMessage[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id));
}

export default function MessagesView({ currentUser }: { currentUser: User }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [conversationErrors, setConversationErrors] = useState<Record<string, string>>({});
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const oldScrollHeightRef = useRef<number | null>(null);
  const suppressAutoScrollRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { connected } = await fetchConnectionsList();
      const items = (connected || []).map(({ user }) => ({ user, messages: null, hasOlder: false }));
      setConversations(items);
      setSelectedId((id) => id && items.some((item) => item.user.id === id) ? id : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your conversations.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [currentUser.id]);

  const visible = useMemo(() => conversations.filter(({ user }) =>
    `${user.display_name} ${user.username}`.toLowerCase().includes(search.trim().toLowerCase())), [conversations, search]);
  const selected = conversations.find((item) => item.user.id === selectedId);

  useEffect(() => {
    if (suppressAutoScrollRef.current) {
      suppressAutoScrollRef.current = false;
      return;
    }
    if (shouldAutoScrollRef.current) {
      messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [selectedId, selected?.messages?.length]);

  useLayoutEffect(() => {
    if (oldScrollHeightRef.current === null || !messageListRef.current) return;
    messageListRef.current.scrollTop += messageListRef.current.scrollHeight - oldScrollHeightRef.current;
    oldScrollHeightRef.current = null;
  }, [selected?.messages?.length]);

  const loadEarlierMessages = async () => {
    if (!selected || !selected.messages?.length || loadingOlder) return;
    const firstMessage = selected.messages[0];
    if (!firstMessage) return;
    const previousScrollHeight = messageListRef.current?.scrollHeight ?? null;
    setLoadingOlder(true);
    setHistoryError(null);
    try {
      const earlier = await fetchMessages(currentUser.id, selected.user.id, { beforeId: firstMessage.id });
      if (earlier.length && previousScrollHeight !== null) {
        oldScrollHeightRef.current = previousScrollHeight;
        suppressAutoScrollRef.current = true;
      }
      setConversations((items) => items.map((item) => item.user.id === selected.user.id
        ? { ...item, messages: mergeMessages(earlier, item.messages || []), hasOlder: earlier.length === HISTORY_PAGE_SIZE }
        : item));
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Could not load earlier messages.");
    } finally { setLoadingOlder(false); }
  };

  const openConversation = async (peerId: string) => {
    shouldAutoScrollRef.current = true;
    setHistoryError(null);
    setSelectedId(peerId);
    const conversation = conversations.find((item) => item.user.id === peerId);
    if (!conversation || conversation.messages !== null) return;
    setLoadingIds((ids) => new Set(ids).add(peerId));
    setConversationErrors((errors) => ({ ...errors, [peerId]: "" }));
    try {
      const messages = await fetchMessages(currentUser.id, peerId);
      setConversations((items) => items.map((item) => item.user.id === peerId
        ? { ...item, messages, hasOlder: messages.length === HISTORY_PAGE_SIZE } : item));
      void markMessagesRead(peerId).catch(() => {});
    } catch (err) {
      setConversationErrors((errors) => ({ ...errors, [peerId]: err instanceof Error ? err.message : "Could not load this conversation." }));
    } finally {
      setLoadingIds((ids) => { const next = new Set(ids); next.delete(peerId); return next; });
    }
  };

  const latestMessageId = selected?.messages?.[selected.messages.length - 1]?.id;
  const selectedHistoryLoaded = Boolean(selected && selected.messages !== null);

  useEffect(() => {
    if (!selectedId || !selectedHistoryLoaded) return;
    let disposed = false;
    let inFlight = false;
    let failures = 0;
    let timer: number | undefined;

    const schedule = () => {
      if (disposed || document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => { void poll(); }, Math.min(4000 * (2 ** failures), 30000));
    };
    const poll = async () => {
      if (disposed || document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const incoming = await fetchMessages(currentUser.id, selectedId,
          latestMessageId ? { afterId: latestMessageId } : {});
        if (disposed) return;
        if (incoming.length) {
          setConversations((items) => items.map((item) => item.user.id === selectedId
            ? { ...item, messages: mergeMessages(item.messages || [], incoming) } : item));
          if (incoming.some((message) => message.receiver_id === currentUser.id)) {
            void markMessagesRead(selectedId).catch(() => {});
          }
        }
        failures = 0;
      } catch {
        failures += 1;
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const onVisibilityChange = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (document.visibilityState === "visible") void poll();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedId, selectedHistoryLoaded, latestMessageId, currentUser.id]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const body = draft.trim();
      const message = await sendMessage(currentUser.id, selected.user.id, body);
      setConversations((items) => items.map((item) => item.user.id === selected.user.id
        ? { ...item, messages: mergeMessages(item.messages || [], [message]) } : item));
      setDraft((current) => current === body ? "" : current);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not send your message."); }
    finally { setSending(false); }
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <div className="mb-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-red-500">Community</p>
        <h2 className="font-heading text-2xl font-bold text-red-100">Messages</h2>
        <p className="mt-1 text-sm text-neutral-400">Conversations with your connected friends.</p>
      </div>
      {error && <div role="alert" className="mb-3 rounded-lg border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">{error}</div>}
      <div className="grid h-[min(72vh,720px)] min-h-[480px] grid-cols-1 overflow-hidden rounded-2xl border border-red-900/50 bg-neutral-950 shadow-xl lg:grid-cols-[320px_1fr]">
        <aside className={`${selected ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-b border-red-900/40 lg:border-b-0 lg:border-r`}>
          <div className="border-b border-red-900/30 p-4">
            <label htmlFor="message-search" className="sr-only">Search conversations</label>
            <input id="message-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search friends…"
              className="w-full rounded-lg border border-red-950 bg-black px-3 py-2 text-sm text-red-100 placeholder-neutral-500 outline-none focus:border-red-700" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? <p className="p-5 text-sm text-neutral-400">Loading conversations…</p>
              : visible.length ? visible.map(({ user, messages }) => {
                const last = messages?.[messages.length - 1];
                return <button key={user.id} onClick={() => void openConversation(user.id)} aria-pressed={selectedId === user.id}
                  className={`flex w-full items-center gap-3 border-b border-red-950/70 p-4 text-left transition hover:bg-red-950/30 ${selectedId === user.id ? "bg-red-950/40" : ""}`}>
                  <img src={user.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`} alt="" className="h-11 w-11 shrink-0 rounded-full border border-red-800 object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-red-100">{user.display_name}</span>
                    <span className="block truncate text-xs text-neutral-400">{last ? `${last.sender_id === currentUser.id ? "You: " : ""}${last.body}` : messages === null ? `@${user.username} · Open conversation` : "No messages yet"}</span>
                  </span>
                  {last && <time className="text-[10px] text-neutral-500">{new Date(last.created_at).toLocaleDateString()}</time>}
                </button>;
              }) : <p className="p-5 text-sm text-neutral-400">{search ? "No matching friends." : "No connected friends to message yet."}</p>}
          </div>
        </aside>
        <div className={`${selected ? "flex" : "hidden lg:flex"} min-h-0 flex-col`}>
          {selected ? <>
            <header className="flex shrink-0 items-center gap-3 border-b border-red-900/40 px-4 py-3 sm:px-5">
              <button type="button" onClick={() => setSelectedId(null)} className="rounded-lg p-2 text-red-300 hover:bg-red-950 lg:hidden" aria-label="Back to conversations">←</button>
              <img src={selected.user.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${selected.user.username}`} alt="" className="h-10 w-10 rounded-full border border-red-700 object-cover" />
              <div><h3 className="text-sm font-semibold text-red-100">{selected.user.display_name}</h3><p className="text-xs text-neutral-400">@{selected.user.username}</p></div>
            </header>
            <div ref={messageListRef} onScroll={(event) => {
              const element = event.currentTarget;
              shouldAutoScrollRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
            }} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-black/40 p-4 sm:p-6" aria-live="polite">
              {loadingIds.has(selected.user.id) ? <p className="py-6 text-center text-sm text-neutral-400">Loading messages…</p>
                : conversationErrors[selected.user.id] ? <div className="mx-auto max-w-sm py-8 text-center">
                  <p role="alert" className="text-sm text-red-300">{conversationErrors[selected.user.id]}</p>
                  <button onClick={() => void openConversation(selected.user.id)} className="mt-3 rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-200 hover:bg-red-950">Try again</button>
                </div>
                : (selected.messages || []).length ? <>
                  {selected.hasOlder && <div className="text-center">
                    {historyError && <p role="alert" className="mb-2 text-xs text-red-300">{historyError}</p>}
                    <button onClick={() => void loadEarlierMessages()} disabled={loadingOlder} className="rounded-full border border-red-900/50 px-3 py-1 text-xs text-red-300 hover:bg-red-950 disabled:opacity-50">
                      {loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}
                    </button>
                  </div>}
                  {(selected.messages || []).map((message) => {
                const own = message.sender_id === currentUser.id;
                return <div key={message.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm ${own ? "rounded-br-sm bg-red-800 text-red-50" : "rounded-bl-sm border border-red-950 bg-neutral-900 text-neutral-100"}`}>
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    <time className={`mt-1 block text-right text-[10px] ${own ? "text-red-200/70" : "text-neutral-500"}`}>{new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                  </div>
                </div>;
                  })}
                </> : <div className="flex h-full items-center justify-center text-center text-sm text-neutral-500">No messages yet. Start the conversation.</div>}
            </div>
            <form onSubmit={submit} className="flex shrink-0 gap-2 border-t border-red-900/40 bg-neutral-950 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
              <label htmlFor="message-draft" className="sr-only">Write a message</label>
              <input id="message-draft" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message…"
                className="min-w-0 flex-1 rounded-xl border border-red-950 bg-black px-4 py-3 text-sm text-red-100 placeholder-neutral-500 outline-none focus:border-red-700" />
              <button disabled={sending || !draft.trim()} className="rounded-xl bg-red-800 px-5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">{sending ? "Sending…" : "Send"}</button>
            </form>
          </> : <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-neutral-500">{loading ? "Loading your messages…" : "Choose a conversation to get started."}</div>}
        </div>
      </div>
    </section>
  );
}
