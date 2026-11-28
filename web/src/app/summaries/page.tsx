"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@yusufceng1z/ding-react";
import { AppShell, ErrorNotice, InlineSpinner, Spinner } from "@/components/AppShell";
import { RichText } from "@/components/RichText";
import { WeekReview } from "@/components/WeekReview";
import { BellIcon } from "@/components/icons";
import { COACH_URL, CoachHttpError, generateSummary } from "@/lib/coach";
import { formatShortDate } from "@/lib/dates";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";
import { getSupabase } from "@/lib/supabase/client";
import type { WeeklySummary } from "@/lib/types";

function weekRange(start: string): string {
  const [y, m, d] = start.split("-").map(Number);
  const end = new Date(y, m - 1, d + 6);
  const endISO = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return `${formatShortDate(start)} – ${formatShortDate(endISO)}`;
}

function split(content: string): { headline: string; body: string } {
  const [first, ...rest] = content.trim().split("\n");
  return { headline: first.replace(/[*_#`]/g, "").trim(), body: rest.join("\n").trim() };
}

function Summary({ s, open, latest }: { s: WeeklySummary; open?: boolean; latest?: boolean }) {
  const { headline, body } = split(s.content);
  const st = s.stats ?? {};
  return (
    <details open={open} className="group rounded-2xl bg-surface">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-4">
        <span className="min-w-0">
          <span className="tag block text-muted">{weekRange(s.week_start)}</span>
          <span className="mt-1 block font-semibold leading-snug">{headline}</span>
        </span>
        {!s.read_at && <span aria-label="New" className="mt-1.5 size-2.5 shrink-0 rounded-full bg-accent" />}
      </summary>
      <div className="space-y-4 border-t border-line p-4 text-[15px]">
        {body && <RichText text={body} />}
        <WeekReview st={st} />
        {latest && (
          <Link href="/coach?ask=review" className="tag flex h-11 items-center justify-center rounded-xl border border-accent text-accent">
            Discuss with Coach
          </Link>
        )}
      </div>
    </details>
  );
}

const PUSH_COPY: Record<PushState, string> = {
  unsupported: "This browser can’t show notifications. On iPhone, add the app to your Home Screen first.",
  unconfigured: "Notifications aren’t set up on this server yet.",
  denied: "Notifications are blocked. Allow them in your browser or phone settings, then come back.",
  off: "Get a notification when your weekly review is ready.",
  on: "You’ll get a notification when your weekly review is ready.",
};

export default function SummariesPage() {
  const [items, setItems] = useState<WeeklySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("weekly_summaries")
      .select("id,week_start,content,read_at,stats")
      .order("week_start", { ascending: false })
      .limit(12);
    if (error) return setError(error.message);
    const rows = (data ?? []) as WeeklySummary[];
    setItems(rows);
    const unread = rows.filter((r) => !r.read_at).map((r) => r.id);
    if (unread.length) await sb.from("weekly_summaries").update({ read_at: new Date().toISOString() }).in("id", unread);
  }, []);

  useEffect(() => {
    // Fetch on mount; state is only set after the awaited requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void pushState().then(setPush, () => setPush("unsupported"));
  }, [load]);

  async function togglePush() {
    setBusy(true);
    try {
      const next = push === "on" ? await disablePush() : await enablePush();
      setPush(next);
      if (next === "on") toast.success("Notifications on");
      else if (next === "off") toast.info("Notifications off");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t change notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    try {
      const status = await generateSummary();
      if (status === "idle") toast.info("No logged workouts last week, so there’s nothing to review yet.");
      else {
        await load();
        toast.success("Review ready");
      }
    } catch (e) {
      toast.error(e instanceof CoachHttpError || e instanceof Error ? e.message : "Couldn’t create the summary.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Weekly review" subtitle="Written every Monday" backHref="/progress">
      {error && (
        <div className="mb-4">
          <ErrorNotice message={error} />
        </div>
      )}

      {push && push !== "unconfigured" && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl bg-surface p-4">
          <BellIcon className="shrink-0 text-muted" />
          <p className="min-w-0 flex-1 text-sm text-muted">{PUSH_COPY[push]}</p>
          {(push === "off" || push === "on") && (
            <button
              onClick={() => void togglePush()}
              disabled={busy}
              className={`tag inline-flex min-w-20 shrink-0 items-center justify-center rounded-lg px-3 py-2 disabled:opacity-50 ${push === "off" ? "bg-accent text-accent-ink" : "bg-surface-2"}`}
            >
              {busy ? <InlineSpinner /> : push === "off" ? "Turn on" : "Turn off"}
            </button>
          )}
        </div>
      )}

      {items === null && !error && <Spinner />}

      {items && items.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface p-5 text-sm">
          <p className="font-semibold">No reviews yet</p>
          <p className="mt-1 text-muted">
            Your first review appears after a full week of logging. Once you’ve trained, you can also create last week’s review now.
          </p>
          {COACH_URL && (
            <button
              onClick={() => void generate()}
              disabled={busy}
              className="tag mt-4 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-3 text-accent-ink disabled:opacity-50"
            >
              {busy ? (
                <>
                  <InlineSpinner /> Writing…
                </>
              ) : (
                "Create last week’s review"
              )}
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {items?.map((s, i) => <Summary key={s.id} s={s} open={i === 0} latest={i === 0} />)}
      </div>
    </AppShell>
  );
}
