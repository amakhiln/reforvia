"use client";

import { useState } from "react";
import { startOfWeekISO } from "@/lib/dates";
import { getSupabase } from "@/lib/supabase/client";

type Kind = "logs" | "plan";

const COPY: Record<Kind, { button: string; warn: string; confirm: string }> = {
  logs: {
    button: "Clear this week’s logs",
    warn: "This permanently deletes every workout and set you logged since Monday. Your plan and older history stay.",
    confirm: "Delete this week’s logs",
  },
  plan: {
    button: "Restore default plan",
    warn: "Your plan is replaced with the default program. Logged workouts and history are kept.",
    confirm: "Restore default plan",
  },
};

/** Two resets, each behind a confirmation: wipe this week's logs, or put the default plan back. */
export function ResetWeek({ onDone }: { onDone: () => void }) {
  const [pending, setPending] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: Kind) {
    setBusy(true);
    setError(null);
    try {
      const sb = getSupabase();
      const { error } =
        kind === "logs"
          ? await sb.from("workouts").delete().gte("performed_on", startOfWeekISO())
          : await sb.rpc("reset_my_program");
      if (error) throw error;
      setPending(null);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "Reset failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Reset" className="space-y-3">
      <h2 className="tag text-muted">Reset</h2>
      {pending ? (
        <div role="alertdialog" aria-label={COPY[pending].button} className="rounded-2xl bg-surface p-4">
          <p className="text-sm">{COPY[pending].warn}</p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => void run(pending)}
              disabled={busy}
              className={`tag h-11 flex-1 rounded-xl text-white disabled:opacity-50 ${pending === "logs" ? "bg-danger" : "bg-accent text-accent-ink"}`}
            >
              {busy ? "Working…" : COPY[pending].confirm}
            </button>
            <button onClick={() => setPending(null)} disabled={busy} className="tag h-11 rounded-xl border-2 border-line px-4">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(COPY) as Kind[]).map((k) => (
            <button key={k} onClick={() => setPending(k)} className="tag min-h-11 rounded-xl border-2 border-line px-3 py-2.5">
              {COPY[k].button}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  );
}
