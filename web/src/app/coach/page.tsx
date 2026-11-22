"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell, ErrorNotice, InlineSpinner } from "@/components/AppShell";
import { SendIcon } from "@/components/icons";
import { toast } from "@yusufceng1z/ding-react";
import { CoachCardView } from "@/components/CoachCards";
import { ProposalCard } from "@/components/ProposalCard";
import { SuggestionChips } from "@/components/SuggestionChips";
import { RichText } from "@/components/RichText";
import { COACH_URL, CoachHttpError, decideProposal, pingCoach, streamCoach, type CoachCard, type CoachProposal } from "@/lib/coach";
import { getSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type Step = { id: string; label: string; done: boolean };
// steps and cards belong to the reply being streamed; they are not stored, so they show for this visit only
type Msg = { id: string; role: "user" | "assistant"; content: string; failed?: boolean; steps?: Step[]; cards?: CoachCard[] };

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
  const [copied, setCopied] = useState<string | null>(null);
  const [chips, setChips] = useState<string[]>([]); // next-step suggestions for the latest reply; not stored
  const [proposals, setProposals] = useState<CoachProposal[]>([]); // changes the coach has asked for, waiting for a decision
  const [deciding, setDeciding] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // keep following the reply only while the reader is near the bottom
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

  // Proposals still waiting for an answer survive a refresh because they live in the database.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void getSupabase()
      .from("agent_proposals")
      .select("id,kind,summary,preview,expires_at,status")
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .then(({ data }: { data: CoachProposal[] | null }) => {
        if (data?.length) setProposals((cur) => [...data.filter((p) => !cur.some((c) => c.id === p.id)), ...cur]);
      });
  }, []);

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
    const onScroll = () => {
      stick.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 200;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // "auto" while streaming: a smooth scroll restarted on every token never catches up and looks stuck.
  useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ behavior: busy ? "auto" : "smooth", block: "end" });
  }, [messages, status, busy]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy || !COACH_URL) return;
      setError(null);
      setChips([]);
      setDraft("");
      stick.current = true;
      setBusy(true);
      setStatus("Thinking");
      const uid = crypto.randomUUID();
      const aid = crypto.randomUUID();
      setMessages((m) => [...(m ?? []), { id: uid, role: "user", content }, { id: aid, role: "assistant", content: "" }]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let failed: string | null = null;

      // Text arrives from the network in bursts. Drip it onto the screen a few characters per frame so it reads as
      // typing; a big backlog is paid down faster so the display never lags far behind.
      const q = { text: "", raf: 0 };
      const append = (chunk: string) =>
        setMessages((m) => m?.map((x) => (x.id === aid ? { ...x, content: x.content + chunk } : x)) ?? m);
      const patch = (f: (x: Msg) => Msg) => setMessages((m) => m?.map((x) => (x.id === aid ? f(x) : x)) ?? m);
      const pump = () => {
        if (!q.text) {
          q.raf = 0;
          return;
        }
        const n = Math.max(1, Math.ceil(q.text.length / 8));
        append(q.text.slice(0, n));
        q.text = q.text.slice(n);
        q.raf = q.text ? requestAnimationFrame(pump) : 0;
      };
      const push = (t: string) => {
        q.text += t;
        if (!q.raf) q.raf = requestAnimationFrame(pump);
      };
      const drained = () =>
        new Promise<void>((res) => {
          const check = () => (q.text ? requestAnimationFrame(check) : res());
          check();
        });
      const flush = () => {
        cancelAnimationFrame(q.raf);
        q.raf = 0;
        if (q.text) append(q.text);
        q.text = "";
      };

      try {
        for await (const ev of streamCoach(content, ctrl.signal)) {
          if (ev.type === "tool") {
            setStatus(`${ev.label}…`);
            patch((x) => ({ ...x, steps: [...(x.steps ?? []), { id: ev.id, label: ev.label, done: false }] }));
          } else if (ev.type === "tool_done") {
            patch((x) => ({ ...x, steps: x.steps?.map((t) => (t.id === ev.id ? { ...t, done: true } : t)) }));
          } else if (ev.type === "proposal") {
            setProposals((cur) => (cur.some((p) => p.id === ev.proposal.id) ? cur : [...cur, ev.proposal]));
          } else if (ev.type === "suggestions") {
            setChips(ev.items);
          } else if (ev.type === "card") {
            patch((x) => ({ ...x, cards: [...(x.cards ?? []), ev.card] }));
          } else if (ev.type === "token") {
            setStatus(null);
            push(ev.text);
          } else if (ev.type === "error") failed = ev.message;
        }
        await drained();
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof CoachHttpError && e.status === 401) {
          router.replace("/login");
          return;
        }
        failed = e instanceof CoachHttpError ? e.message : "Couldn’t reach the coach. Check your connection and try again.";
      } finally {
        flush(); // anything still queued (after an error or abort) is shown at once
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

  async function decide(id: string, approve: boolean) {
    setDeciding(id);
    try {
      const status = await decideProposal(id, approve);
      setProposals((cur) => cur.map((p) => (p.id === id ? { ...p, status } : p)));
      if (status === "applied") toast.success("Change applied");
      else if (status === "rejected") toast.info("Dismissed");
      else if (status === "expired") toast.info("That proposal expired");
      else if (status === "failed") toast.error("Couldn’t apply that change");
    } catch (e) {
      if (e instanceof CoachHttpError && e.status === 401) router.replace("/login");
      else toast.error(e instanceof Error ? e.message : "Couldn’t record your decision.");
    } finally {
      setDeciding(null);
    }
  }

  async function copy(m: Msg) {
    try {
      await navigator.clipboard.writeText(m.content);
      setCopied(m.id);
      setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 1500);
    } catch {
      /* clipboard can be blocked; nothing to recover */
    }
  }

  const empty = messages !== null && messages.length === 0;

  return (
    <AppShell
      title="Coach"
      subtitle="Ask about your training"
      action={
        <span className="flex items-center gap-1 text-sm">
          <Link href="/memory" className="tag rounded-lg px-2 py-1.5 text-muted">
            Notes
          </Link>
          {messages && messages.length > 0 && !busy ? (
            confirmClear ? (
              <>
                <button onClick={clearChat} className="tag rounded-lg bg-danger px-2.5 py-1.5 text-bg">
                  Delete chat
                </button>
                <button onClick={() => setConfirmClear(false)} className="tag rounded-lg px-2 py-1.5 text-muted">
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setConfirmClear(true)} className="tag rounded-lg px-2 py-1.5 text-muted">
                Clear
              </button>
            )
          ) : null}
        </span>
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
              It reads your plan and logs to answer questions. It never changes anything without your approval, and it isn’t a doctor.
            </p>
          </div>
          <SuggestionChips title="Try asking" showTitle items={SUGGESTIONS} onPick={(c) => void send(c)} disabled={busy} />
        </div>
      )}

      <div className="space-y-3" aria-live="polite">
        {messages?.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start gap-2"}>
            {m.steps && m.steps.length > 0 && (
              <ul aria-label="What the coach looked at" className="flex max-w-[88%] flex-wrap gap-1.5">
                {m.steps.map((t) => (
                  <li key={t.id} className="tag flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-muted">
                    <span className={`size-1.5 rounded-full ${t.done ? "bg-accent" : "animate-pulse bg-muted"}`} aria-hidden />
                    {t.label}
                  </li>
                ))}
              </ul>
            )}
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
            {m.cards?.map((card, i) => (
              <div key={i} className="w-full">
                <CoachCardView card={card} />
              </div>
            ))}
            {m.role === "assistant" && m.content && !(busy && m.id === messages[messages.length - 1].id) && (
              <button onClick={() => void copy(m)} className="tag rounded-lg px-2 py-1 text-muted active:text-ink">
                {copied === m.id ? "Copied" : "Copy"}
              </button>
            )}
          </div>
        ))}
        {busy && status && messages?.[messages.length - 1]?.content && (
          <p className="pl-1 text-xs text-muted">{status}</p>
        )}
      </div>

      {proposals.length > 0 && (
        <div className="mt-4 space-y-3">
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} deciding={deciding === p.id} onDecide={(approve) => void decide(p.id, approve)} />
          ))}
        </div>
      )}

      {chips.length > 0 && !busy && !error && (
        <div className="mt-4">
          <SuggestionChips title="Ask next" items={chips} onPick={(c) => void send(c)} />
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorNotice message={error} />
        </div>
      )}
      <div ref={endRef} className="h-44" /> {/* clears the fixed message box and the tab bar */}

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
              {busy ? <InlineSpinner /> : <SendIcon />}
            </button>
          </div>
        </form>
      )}
    </AppShell>
  );
}
