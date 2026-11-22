"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@yusufceng1z/ding-react";
import { AppShell, ErrorNotice, InlineSpinner, Spinner } from "@/components/AppShell";
import { getSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type Kind = "fact" | "preference" | "constraint" | "goal";
type Note = { id: string; kind: Kind; text: string; source: "user" | "coach" };

const KINDS: { id: Kind; label: string }[] = [
  { id: "fact", label: "Fact" },
  { id: "constraint", label: "Limit" },
  { id: "preference", label: "Preference" },
  { id: "goal", label: "Goal" },
];
const LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label])) as Record<Kind, string>;

export default function MemoryPage() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<Kind>("fact");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("agent_memories")
      .select("id,kind,text,source")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) setError(error.message);
    else setNotes((data ?? []) as Note[]);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    // Fetch on mount; state is only set after the awaited request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function add() {
    const text = draft.trim();
    if (text.length < 3 || busy) return;
    setBusy(true);
    const sb = getSupabase();
    const { data } = await sb.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) {
      toast.error("You’re signed out. Please sign in again.");
      setBusy(false);
      return;
    }
    const { error } = await sb.from("agent_memories").insert({ user_id: userId, kind, text, source: "user" });
    setBusy(false);
    if (error) return void toast.error(error.message);
    setDraft("");
    toast.success("Note saved");
    await load();
  }

  async function saveEdit() {
    if (!editing || editing.text.trim().length < 3) return;
    setBusy(true);
    const { error } = await getSupabase()
      .from("agent_memories")
      .update({ text: editing.text.trim(), updated_at: new Date().toISOString() })
      .eq("id", editing.id);
    setBusy(false);
    if (error) return void toast.error(error.message);
    setEditing(null);
    await load();
  }

  async function remove(id: string) {
    setBusy(true);
    const { error } = await getSupabase().from("agent_memories").delete().eq("id", id);
    setBusy(false);
    setConfirm(null);
    if (error) return void toast.error(error.message);
    toast.info("Note deleted");
    await load();
  }

  return (
    <AppShell title="What the Coach knows" subtitle="Notes you’ve shared" backHref="/coach">
      <p className="mb-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs text-muted">
        The Coach and your weekly review read these to give better advice. Your logged workouts always win if they disagree. Edit or delete anything you don’t want kept.
      </p>

      {error && (
        <div className="mb-4">
          <ErrorNotice message={error} />
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        className="mb-5 rounded-2xl bg-surface p-4"
      >
        <label htmlFor="note" className="tag text-muted">
          Add a note
        </label>
        <input
          id="note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={200}
          placeholder="e.g. I only have dumbbells at home"
          className="mt-2 h-12 w-full rounded-xl border border-line bg-bg px-3.5 text-base"
        />
        <div className="mt-3 flex items-center gap-2">
          <div role="group" aria-label="Kind of note" className="flex flex-1 rounded-xl bg-surface-2 p-1">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                aria-pressed={kind === k.id}
                className={`tag h-9 flex-1 rounded-lg ${kind === k.id ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <button type="submit" disabled={busy || draft.trim().length < 3} className="tag flex h-11 w-20 items-center justify-center rounded-xl bg-accent text-accent-ink disabled:opacity-40">
            {busy ? <InlineSpinner /> : "Add"}
          </button>
        </div>
      </form>

      {notes === null && !error && <Spinner />}
      {notes?.length === 0 && (
        <p className="rounded-2xl bg-surface p-5 text-sm text-muted">
          Nothing saved yet. Tell the Coach about an injury, how many days you train or what equipment you have, and it will offer to save a note for you to approve.
        </p>
      )}

      <ul className="space-y-2">
        {notes?.map((n) => (
          <li key={n.id} className="rounded-2xl bg-surface p-4">
            <p className="tag text-muted">
              {LABEL[n.kind]}
              {n.source === "coach" ? " · from your coach" : ""}
            </p>
            {editing?.id === n.id ? (
              <div className="mt-2 flex gap-2">
                <input
                  value={editing.text}
                  onChange={(e) => setEditing({ id: n.id, text: e.target.value })}
                  maxLength={200}
                  aria-label="Edit note"
                  className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-base"
                />
                <button onClick={() => void saveEdit()} disabled={busy} className="tag rounded-xl bg-accent px-3 text-accent-ink disabled:opacity-50">
                  Save
                </button>
                <button onClick={() => setEditing(null)} className="tag rounded-xl px-2 text-muted">
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <p className="mt-1 break-words text-[15px]">{n.text}</p>
                <div className="mt-3 flex items-center gap-1">
                  {confirm === n.id ? (
                    <>
                      <button onClick={() => void remove(n.id)} disabled={busy} className="tag rounded-lg bg-danger px-2.5 py-1.5 text-bg">
                        Delete note
                      </button>
                      <button onClick={() => setConfirm(null)} className="tag rounded-lg px-2 py-1.5 text-muted">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setEditing({ id: n.id, text: n.text })} className="tag rounded-lg px-2 py-1.5 text-muted">
                        Edit
                      </button>
                      <button onClick={() => setConfirm(n.id)} className="tag rounded-lg px-2 py-1.5 text-muted">
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
