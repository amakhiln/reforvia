"use client";

import { useEffect, useRef, useState } from "react";
import { InlineSpinner } from "@/components/AppShell";
import { PlusIcon } from "@/components/icons";
import { groupTerms, muscleGroups, suggestAlternatives, type Ex } from "@/lib/alternatives";
import { getSupabase } from "@/lib/supabase/client";

export type Found = { id: string; name: string; main_muscles: string | null; is_timed: boolean; source: string };

const COLS = "id,name,main_muscles,equipment,is_timed,source,exercise_media(id)";
type Row = Ex & { exercise_media?: { id: string }[] };

/** Candidates for alternatives: exercises that train the same muscle groups, widened if that finds too few. */
async function loadSuggestions(cur: Ex, exclude: string[]): Promise<Found[]> {
  const sb = getSupabase();
  const terms = muscleGroups(cur.main_muscles).slice(0, 2).flatMap(groupTerms);
  let rows: Row[] = [];
  if (terms.length) {
    const { data } = await sb.from("exercises").select(COLS).or(terms.map((t) => `main_muscles.ilike.*${t}*`).join(",")).limit(300);
    rows = (data ?? []) as unknown as Row[];
  }
  if (rows.length < 8) {
    const { data } = await sb.from("exercises").select(COLS).order("name").limit(60);
    const have = new Set(rows.map((r) => r.id));
    rows = [...rows, ...((data ?? []) as unknown as Row[]).filter((r) => !have.has(r.id))];
  }
  const pool: Ex[] = rows.map((r) => ({ ...r, media_count: r.exercise_media?.length ?? 0 }));
  return suggestAlternatives(cur, pool, exclude, 4).map((e) => ({
    id: e.id, name: e.name, main_muscles: e.main_muscles, is_timed: e.is_timed, source: e.source ?? "curated",
  }));
}

/** Search the exercise library and pick one. With `suggestFor`, it also lists the closest alternatives before you type. */
export function ExercisePicker({
  onPick,
  onCancel,
  suggestFor,
  exclude,
}: {
  onPick: (ex: Found) => Promise<void>;
  onCancel: () => void;
  suggestFor?: Ex;
  exclude?: string[];
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [suggested, setSuggested] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const [seed] = useState({ suggestFor, exclude: exclude ?? [] });

  useEffect(() => {
    if (!seed.suggestFor) return;
    let live = true;
    loadSuggestions(seed.suggestFor, seed.exclude).then(
      (r) => live && setSuggested(r),
      () => live && setSuggested([]),
    );
    return () => {
      live = false;
    };
  }, [seed]);

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

  const searching = q.trim().length >= 2;
  const list = (items: Found[]) => (
    <ul className="mt-2 space-y-1">
      {items.map((r) => (
        <li key={r.id}>
          <button
            onClick={() => void pick(r)}
            disabled={busy}
            className="flex w-full items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-left disabled:opacity-50"
          >
            <span className="min-w-0">
              <span className="line-clamp-2 text-sm font-semibold uppercase tracking-wide">{r.name}</span>
              <span className="tag mt-0.5 block truncate text-muted">
                {[r.main_muscles, r.source === "wger" ? "wger" : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            {busy ? <InlineSpinner /> : <PlusIcon className="size-4 shrink-0 text-accent" />}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="rounded-xl bg-bg p-3">
      <div className="flex items-center gap-2">
        <input
          autoFocus={!suggestFor}
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

      {searching ? (
        <>
          {results.length === 0 && <p className="mt-2 text-sm text-muted">No exercises match.</p>}
          {list(results)}
        </>
      ) : (
        seed.suggestFor && (
          <div className="mt-3">
            <p className="tag text-muted">Suggested alternatives</p>
            {suggested === null ? (
              <div className="mt-2 space-y-1" role="status">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-12 rounded-lg bg-surface-2 motion-safe:animate-pulse" />
                ))}
                <span className="sr-only">Finding alternatives</span>
              </div>
            ) : suggested.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No suggestions. Search above.</p>
            ) : (
              list(suggested)
            )}
          </div>
        )
      )}
    </div>
  );
}
