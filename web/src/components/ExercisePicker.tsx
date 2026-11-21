"use client";

import { useRef, useState } from "react";
import { InlineSpinner } from "@/components/AppShell";
import { PlusIcon } from "@/components/icons";
import { getSupabase } from "@/lib/supabase/client";

export type Found = { id: string; name: string; main_muscles: string | null; is_timed: boolean; source: string };

/** Search the exercise library and pick one. Used by the plan editor and by the workout screen. */
export function ExercisePicker({ onPick, onCancel }: { onPick: (ex: Found) => Promise<void>; onCancel: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  async function search(text: string) {
    setQ(text);
    const term = text.replace(/[%_,()*\\"']/g, " ").trim();
    const mine = ++seq.current;
    if (term.length < 2) return setResults([]);
    const { data } = await getSupabase()
      .from("exercises")
      .select("id,name,main_muscles,is_timed,source")
      .ilike("name", `%${term}%`)
      .order("name")
      .limit(8);
    if (mine === seq.current) setResults((data ?? []) as Found[]);
  }

  async function pick(ex: Found) {
    if (busy) return;
    setBusy(true);
    try {
      await onPick(ex);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-bg p-3">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => void search(e.target.value)}
          placeholder="Search exercises…"
          aria-label="Search exercises"
          className="h-10 min-w-0 flex-1 rounded-lg bg-surface-2 px-3 text-base"
        />
        <button onClick={onCancel} className="tag h-10 rounded-lg px-2 text-muted">
          Cancel
        </button>
      </div>
      {q.trim().length >= 2 && results.length === 0 && <p className="mt-2 text-sm text-muted">No exercises match.</p>}
      <ul className="mt-2 space-y-1">
        {results.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => void pick(r)}
              disabled={busy}
              className="flex w-full items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-left disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold uppercase tracking-wide">{r.name}</span>
                <span className="tag mt-0.5 block truncate text-muted">
                  {[r.main_muscles, r.source === "wger" ? "wger" : null].filter(Boolean).join(" · ")}
                </span>
              </span>
              {busy ? <InlineSpinner /> : <PlusIcon className="size-4 shrink-0 text-accent" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
