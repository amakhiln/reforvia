import { CheckIcon } from "@/components/icons";
import { formatCompact } from "@/lib/chartMath";
import { formatKg } from "@/lib/progression";
import { reasonLabel } from "@/lib/skips";
import type { WeeklySummary } from "@/lib/types";
import { weekCells, wins, type DayState } from "@/lib/weekReview";

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const CELL: Record<DayState, { box: string; label: string }> = {
  trained: { box: "bg-accent text-accent-ink", label: "trained" },
  extra: { box: "bg-accent-soft text-accent", label: "trained, not planned" },
  missed: { box: "border-2 border-dashed border-accent text-accent", label: "planned, skipped" },
  skipped: { box: "border-2 border-dashed border-muted text-muted", label: "marked skipped" },
  rest: { box: "bg-surface-2 text-muted", label: "rest" },
};

type Stats = WeeklySummary["stats"];

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-surface-2 p-3.5">
      <h3 className="tag text-muted">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** The numbers behind a weekly review, drawn from the stored stats. Nothing here comes from the model's text. */
export function WeekReview({ st }: { st: Stats }) {
  const delta =
    st.prev_volume_kg && st.volume_kg !== undefined ? Math.round(((st.volume_kg - st.prev_volume_kg) / st.prev_volume_kg) * 100) : null;
  const cells = st.trained_days ? weekCells(st.trained_days, st.plan_days, st.missed_days, st.skipped_days) : null;
  const skipped = (st.skipped_sessions ?? []).map((k) => (k.reason ? `${k.session} (${reasonLabel(k.reason)?.toLowerCase()})` : k.session));
  const done = st.planned_done; // undefined on reviews written before planned and extra sessions were counted apart
  const planned = st.plan_days?.length ?? 0;
  const hit = cells?.filter((c) => c.state === "trained").length ?? 0;
  const won = wins(st.lifts);
  const targets = st.targets ?? [];

  return (
    <div className="space-y-3">
      {cells && (
        <Panel title="Training days">
          <ol className="grid grid-cols-7 gap-1.5">
            {cells.map((c, i) => (
              <li key={c.day} aria-label={`${NAMES[i]}: ${CELL[c.state].label}`} className="flex flex-col items-center gap-1.5">
                <span className={`flex size-9 items-center justify-center rounded-lg ${CELL[c.state].box}`}>
                  {c.state === "trained" || c.state === "extra" ? <CheckIcon className="size-4" /> : c.state === "skipped" ? <span aria-hidden>–</span> : null}
                </span>
                <span className="tag text-muted">{LETTERS[i]}</span>
              </li>
            ))}
          </ol>
          {st.missed_sessions && (st.planned_sessions ?? 0) > 0 && (
            <p className="mt-3 text-sm text-muted">
              {st.missed_sessions.length === 0 && skipped.length === 0 && "Every planned session done."}
              {st.missed_sessions.length > 0 && (
                <span className="block">
                  Missed: <span className="font-semibold text-ink">{st.missed_sessions.join(", ")}</span>
                </span>
              )}
              {skipped.length > 0 && (
                <span className="block">
                  Skipped: <span className="font-semibold text-ink">{skipped.join(", ")}</span>
                </span>
              )}
            </p>
          )}
          {!st.missed_sessions && planned > 0 && (
            <p className="mt-3 text-sm text-muted">
              <span className="font-mono font-semibold tabular-nums text-ink">
                {hit} of {planned}
              </span>{" "}
              planned days trained
            </p>
          )}
        </Panel>
      )}

      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-surface-2 px-2 py-2.5">
          <dd className="font-mono text-xl font-semibold tabular-nums">
            {done ?? st.sessions ?? 0}
            {st.planned_sessions ? <span className="text-sm font-normal text-muted">/{st.planned_sessions}</span> : null}
          </dd>
          <dt className="tag mt-1 text-muted">{done === undefined ? "Sessions" : "Planned"}</dt>
          {(st.extra_sessions ?? 0) > 0 && <dd className="mt-0.5 text-xs text-muted">+{st.extra_sessions} extra</dd>}
        </div>
        <div className="rounded-xl bg-surface-2 px-2 py-2.5">
          <dd className="font-mono text-xl font-semibold tabular-nums">{formatCompact(st.volume_kg ?? 0)}</dd>
          <dt className="tag mt-1 text-muted">Volume (kg)</dt>
        </div>
        <div className="rounded-xl bg-surface-2 px-2 py-2.5">
          <dd className="font-mono text-xl font-semibold tabular-nums">{delta === null ? "–" : `${delta > 0 ? "+" : ""}${delta}%`}</dd>
          <dt className="tag mt-1 text-muted">vs prior week</dt>
        </div>
      </dl>

      {st.lifts && (
        <Panel title="Wins">
          {won.length > 0 ? (
            <ul className="divide-y divide-line">
              {won.map((w) => (
                <li key={w.exercise + w.label} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{w.exercise}</span>
                    <span className="tag text-muted">{w.label}</span>
                  </span>
                  <span className="shrink-0 font-mono text-sm tabular-nums">
                    <span className="text-muted">{formatKg(w.from)}</span>
                    <span className="mx-1.5 text-muted" aria-hidden>→</span>
                    <span className="font-semibold text-accent">{formatKg(w.to)}</span>
                    <span className="ml-1 text-muted">{w.unit}</span>
                    <span className="sr-only"> from {formatKg(w.from)} to {formatKg(w.to)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No new bests this week. Holding strength through a steady week counts too.</p>
          )}
        </Panel>
      )}

      {targets.length > 0 && (
        <Panel title="Next week">
          <ul className="divide-y divide-line">
            {targets.map((t) => (
              <li key={t.exercise} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{t.exercise}</span>
                  <span className="tag text-muted">{t.plan}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {formatKg(t.next_load_kg)} kg × {t.target_reps}
                    {t.kind === "increase" ? "+" : ""}
                  </span>
                  <span className={`tag rounded-md px-1.5 py-0.5 ${t.kind === "increase" ? "bg-accent text-accent-ink" : "bg-surface text-muted"}`}>
                    {t.kind === "increase" ? "Go up" : "Hold"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
