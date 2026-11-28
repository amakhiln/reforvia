"use client";

import { useEffect, useRef, useState } from "react";
import { InlineSpinner } from "@/components/AppShell";
import { ExerciseDetails } from "@/components/ExerciseDetails";
import { ChevronIcon, PlusIcon } from "@/components/icons";
import { groupTerms, muscleGroups, suggestAlternatives, type Ex } from "@/lib/alternatives";
import { getSupabase } from "@/lib/supabase/client";
import type { Exercise } from "@/lib/types";

export type Found = { id: string; name: string; main_muscles: string | null; is_timed: boolean; source: string };

const COLS = "id,name,main_muscles,equipment,is_timed,source,exercise_media(id)";
type Row = Ex & { exercise_media?: { id: string }[] };

/** Candidates for alternatives: exercises that train the same muscle groups, widened if that finds too few. */
async function loadSuggestions(cur: Ex, exclude: string[], otherKit: boolean): Promise<Found[]> {
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
  return suggestAlternatives(cur, pool, exclude, 4, otherKit).map((e) => ({
    id: e.id, name: e.name, main_muscles: e.main_muscles, is_timed: e.is_timed, source: e.source ?? "curated",
  }));
}

/** Search the exercise library and pick one; each result can be expanded to read about it first. With `suggestFor`, it also lists the closest alternatives before you type. */
export function ExercisePicker({
  onPick,
  onCancel,
  suggestFor,
  exclude,
  otherKit = false,
}: {
  onPick: (ex: Found) => Promise<void>;
  onCancel: () => void;
  suggestFor?: Ex;
  exclude?: string[];
  /** Suggest exercises that need other equipment first. */
  otherKit?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [suggested, setSuggested] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // the exercise being added
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Exercise | "error">>({});
  const seq = useRef(0);
  const [seed] = useState({ suggestFor, exclude: exclude ?? [], otherKit });

  useEffect(() => {
    if (!seed.suggestFor) return;
    let live = true;
    loadSuggestions(seed.suggestFor, seed.exclude, seed.otherKit).then(
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
    setBusy(ex.id);
    try {
      await onPick(ex);
    } finally {
      setBusy(null);
    }
  }

  async function expand(id: string) {
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    if (details[id] && details[id] !== "error") return;
    setDetails((d) => {
      const rest = { ...d };
      delete rest[id];
      return rest;
    });
    const { data, error } = await getSupabase().from("exercises").select("*,exercise_media(*)").eq("id", id).single();
    setDetails((d) => ({ ...d, [id]: error ? "error" : (data as Exercise) }));
  }

  const searching = q.trim().length >= 2;
  const list = (items: Found[]) => (
    <ul className="mt-2 space-y-1">
      {items.map((r) => {
        const open = openId === r.id;
        const info = details[r.id];
        return (
          <li key={r.id} className="rounded-lg bg-surface-2">
            <div className="flex items-center">
              <button onClick={() => void expand(r.id)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pl-3 text-left">
                <ChevronIcon className={`size-4 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm font-semibold uppercase tracking-wide">{r.name}</span>
                  <span className="tag mt-0.5 block truncate text-muted">
                    {[r.main_muscles, r.source === "wger" ? "wger" : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
              <button
                onClick={() => void pick(r)}
                disabled={Boolean(busy)}
                aria-label={`Choose ${r.name}`}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg disabled:opacity-50"
              >
                {busy === r.id ? <InlineSpinner /> : <PlusIcon className="size-4 text-accent" />}
              </button>
            </div>
            {open && (
              <div className="space-y-3 border-t border-line p-3">
                {!info ? (
                  <p role="status" className="flex items-center gap-2 text-sm text-muted">
                    <InlineSpinner /> Loading details…
                  </p>
                ) : info === "error" ? (
                  <p className="text-sm text-muted">Couldn’t load the details. Close and open it to try again.</p>
                ) : (
                  <ExerciseDetails exercise={info} />
                )}
                <button
                  onClick={() => void pick(r)}
                  disabled={Boolean(busy)}
                  className="tag inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-accent-ink disabled:opacity-50"
                >
                  {busy === r.id ? <InlineSpinner /> : "Choose this exercise"}
                </button>
              </div>
            )}
          </li>
        );
      })}
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
