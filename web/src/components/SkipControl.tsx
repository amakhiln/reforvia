"use client";

import { useState } from "react";
import { toast } from "@yusufceng1z/ding-react";
import { InlineSpinner } from "@/components/AppShell";
import { reasonLabel, SKIP_REASONS, type Skip, type SkipReason } from "@/lib/skips";
import { getSupabase } from "@/lib/supabase/client";

/** "I didn't train": marks a planned day as skipped, with an optional reason, and lets it be undone. */
export function SkipControl({
  session,
  date,
  skip,
  onChanged,
}: {
  session: { id: string; name: string };
  date: string;
  skip?: Skip;
  onChanged: () => void | Promise<void>;
}) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(work: () => PromiseLike<{ error: { message: string } | null }>, done: string) {
    setBusy(true);
    try {
      const { error } = await work();
      if (error) return void toast.error(error.message);
      setChoosing(false);
      toast.info(done);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function mark(reason: SkipReason | null) {
    const sb = getSupabase();
    const { data } = await sb.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return void toast.error("You’re signed out. Please sign in again.");
    await run(
      () =>
        sb
          .from("session_skips")
          .upsert({ user_id: userId, session_id: session.id, session_name: session.name, skipped_on: date, reason }, { onConflict: "user_id,session_id,skipped_on" }),
      "Marked as skipped",
    );
  }

  if (skip) {
    const why = reasonLabel(skip.reason);
    return (
      <p className="flex items-center gap-3 text-sm text-muted">
        <span>
          Skipped{why ? ` · ${why}` : ""}
        </span>
        <button
          onClick={() => void run(() => getSupabase().from("session_skips").delete().eq("id", skip.id), "Skip removed")}
          disabled={busy}
          className="tag inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-accent disabled:opacity-50"
        >
          {busy && <InlineSpinner />} Undo
        </button>
      </p>
    );
  }

  if (!choosing) {
    return (
      <button onClick={() => setChoosing(true)} className="tag rounded-lg py-1.5 text-muted underline underline-offset-4">
        Didn’t train? Mark skipped
      </button>
    );
  }

  return (
    <div role="group" aria-label={`Why did you skip ${session.name}?`}>
      <p className="text-sm text-muted">Why? Optional.</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {SKIP_REASONS.map((r) => (
          <button key={r.id} onClick={() => void mark(r.id)} disabled={busy} className="min-h-9 rounded-lg border border-line px-3 text-sm text-ink active:bg-surface-2 disabled:opacity-50">
            {r.label}
          </button>
        ))}
        <button onClick={() => void mark(null)} disabled={busy} className="min-h-9 rounded-lg border border-line px-3 text-sm text-muted active:bg-surface-2 disabled:opacity-50">
          No reason
        </button>
        <button onClick={() => setChoosing(false)} disabled={busy} className="tag min-h-9 rounded-lg px-2 text-muted">
          Cancel
        </button>
        {busy && <InlineSpinner className="text-muted" />}
      </div>
    </div>
  );
}
