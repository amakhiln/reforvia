"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, ErrorNotice } from "@/components/AppShell";
import { SendIcon } from "@/components/icons";
import { RichText } from "@/components/RichText";
import { COACH_URL, CoachHttpError, pingCoach, streamCoach } from "@/lib/coach";
import { getSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type Msg = { id: string; role: "user" | "assistant"; content: string; failed?: boolean };

const SUGGESTIONS = [
  "What should I lift next session?",
  "How has my lat pulldown progressed?",
  "Review my last two weeks of training",
  "Am I doing enough weekly volume?",
];

export default function CoachPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [service, setService] = useState<"checking" | "waking" | "ready" | "down">("checking");
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("coach_messages")
      .select("id,role,content")
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) setError(error.message);
    else setMessages((data ?? []) as Msg[]);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    // Fetch on mount; state is only set after the awaited request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Wake the service (Render's free tier sleeps when idle) as soon as the tab opens.
  useEffect(() => {
    if (!COACH_URL) return;
    const ctrl = new AbortController();
    const slow = setTimeout(() => setService((s) => (s === "checking" ? "waking" : s)), 2500);
    void pingCoach(ctrl.signal).then((ok) => {
      clearTimeout(slow);
      if (!ctrl.signal.aborted) setService(ok ? "ready" : "down");
    });
    return () => {
      clearTimeout(slow);
      ctrl.abort();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy || !COACH_URL) return;
      setError(null);
      setDraft("");
      setBusy(true);
      setStatus("Thinking");
      const uid = crypto.randomUUID();
      const aid = crypto.randomUUID();
      setMessages((m) => [...(m ?? []), { id: uid, role: "user", content }, { id: aid, role: "assistant", content: "" }]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let failed: string | null = null;
      try {
        for await (const ev of streamCoach(content, ctrl.signal)) {
          if (ev.type === "tool") setStatus(`${ev.label}…`);
          else if (ev.type === "token") {
            setStatus(null);
            setMessages((m) => m?.map((x) => (x.id === aid ? { ...x, content: x.content + ev.text } : x)) ?? m);
          } else if (ev.type === "error") failed = ev.message;
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof CoachHttpError && e.status === 401) {
          router.replace("/login");
          return;
        }
        failed = e instanceof CoachHttpError ? e.message : "Couldn’t reach the coach. Check your connection and try again.";
      } finally {
        setBusy(false);
        setStatus(null);
      }
      if (failed) {
        const reason = failed;
        setMessages((m) => {
          const reply = m?.find((x) => x.id === aid);
          // keep any partial answer; otherwise drop the empty bubble and show the error beneath
          return reply && reply.content ? m : (m?.filter((x) => x.id !== aid) ?? m);
        });
        setError(reason);
      }
    },
    [busy, router],
  );

  async function clearChat() {
    const { error } = await getSupabase().from("coach_messages").delete().not("id", "is", null);
    setConfirmClear(false);
    if (error) setError(error.message);
    else setMessages([]);
  }

  const empty = messages !== null && messages.length === 0;

  return (
    <AppShell
      title="Coach"
      subtitle="Ask about your training"
      action={
        messages && messages.length > 0 && !busy ? (
          confirmClear ? (
            <span className="flex items-center gap-1 text-sm">
              <button onClick={clearChat} className="tag rounded-lg bg-danger px-2.5 py-1.5 text-white">
                Delete chat
              </button>
              <button onClick={() => setConfirmClear(false)} className="tag rounded-lg px-2 py-1.5 text-muted">
                Cancel
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirmClear(true)} className="tag rounded-lg px-2 py-1.5 text-muted">
              Clear
            </button>
          )
        ) : undefined
      }
    >
      {!COACH_URL && (
        <div className="rounded-2xl border border-line bg-surface p-5 text-sm">
          <p className="font-semibold">The coach isn’t connected yet</p>
          <p className="mt-2 text-muted">
            Deploy the coach service, then set <code className="rounded bg-surface-2 px-1.5 py-0.5">NEXT_PUBLIC_COACH_URL</code> in{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5">.env.local</code> and restart.
          </p>
        </div>
      )}

      {COACH_URL && service === "waking" && (
        <p role="status" className="mb-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs text-muted">
          Waking the coach… the first reply can take up to a minute while the free server starts.
        </p>
      )}
      {COACH_URL && service === "down" && (
        <p role="status" className="mb-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs text-muted">
          The coach server isn’t answering yet. You can still send a message and it will keep trying.
        </p>
      )}

      {messages === null && !error && (
        <div role="status" className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
          <span className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" /> Loading
        </div>
      )}

      {empty && COACH_URL && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-surface p-5">
            <p className="font-semibold uppercase tracking-wide">Your training coach</p>
            <p className="mt-1 text-sm text-muted">
              It reads your plan and logs to answer questions. It can’t change anything, and it isn’t a doctor.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                disabled={busy}
                className="rounded-xl bg-surface px-3.5 py-2.5 text-left text-sm font-medium active:bg-surface-2"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3" aria-live="polite">
        {messages?.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[88%] rounded-2xl px-4 py-3 text-[15px] ${
                m.role === "user" ? "rounded-br-md bg-accent text-accent-ink" : "rounded-bl-md bg-surface"
              }`}
            >
              {m.role === "user" ? (
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
              ) : m.content ? (
                <RichText text={m.content} />
              ) : (
                <span className="flex items-center gap-2 text-sm text-muted">
                  <span className="size-3 animate-pulse rounded-full bg-accent" />
                  {status ?? "Thinking"}
                </span>
              )}
            </div>
          </div>
        ))}
        {busy && status && messages?.[messages.length - 1]?.content && (
          <p className="pl-1 text-xs text-muted">{status}</p>
        )}
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNotice message={error} />
        </div>
      )}
      <div ref={endRef} className="h-24" />

      {COACH_URL && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className="fixed inset-x-0 bottom-[calc(3.9rem+env(safe-area-inset-bottom))] z-10 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur"
        >
          <div className="mx-auto flex max-w-xl items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Ask your coach…"
              aria-label="Message the coach"
              className="max-h-32 min-h-12 flex-1 resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-base"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Send message"
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink disabled:opacity-40"
            >
              <SendIcon />
            </button>
          </div>
        </form>
      )}
    </AppShell>
  );
}
