"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronIcon } from "@/components/icons";
import { getSupabase } from "@/lib/supabase/client";

/** Entry point to the weekly review; shows a dot while the latest one is unread. */
export function SummaryLink() {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    void (async () => {
      const { data } = await getSupabase().from("weekly_summaries").select("id").is("read_at", null).limit(1);
      setUnread((data ?? []).length > 0);
    })();
  }, []);
  return (
    <Link
      href="/summaries"
      className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 active:bg-surface-2"
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2 font-semibold">
          Weekly review
          {unread && <span aria-label="New review" className="size-2.5 rounded-full bg-accent" />}
        </span>
        <span className="mt-0.5 block text-sm text-muted">A short analysis of your last week</span>
      </span>
      <ChevronIcon className="-rotate-90 shrink-0 text-muted" />
    </Link>
  );
}
