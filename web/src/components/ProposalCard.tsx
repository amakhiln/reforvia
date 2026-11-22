import Link from "next/link";
import { useEffect, useState } from "react";
import { InlineSpinner } from "@/components/AppShell";
import { CheckIcon } from "@/components/icons";
import type { CoachProposal } from "@/lib/coach";

const TITLE: Record<CoachProposal["kind"], string> = { plan_change: "Proposed plan change", memory: "Memory to save" };

/** Preview lines start with + (added), - (removed) or ~ (changed); the marker only colours the line. */
function Line({ text }: { text: string }) {
  const mark = text[0];
  const colored = mark === "+" ? "text-accent" : mark === "-" ? "text-danger" : "text-muted";
  const known = "+-~".includes(mark);
  return (
    <li className="flex gap-2 font-mono text-sm">
      <span className={`w-3 shrink-0 ${colored}`} aria-hidden>
        {known ? mark : ""}
      </span>
      <span className="min-w-0 break-words">{known ? text.slice(1).trim() : text}</span>
    </li>
  );
}

/** What the Coach wants to change, exactly as it will be stored, with Approve and Reject. The Coach cannot apply it itself. */
export function ProposalCard({
  proposal,
  deciding,
  onDecide,
}: {
  proposal: CoachProposal;
  deciding: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const expiresMs = new Date(proposal.expires_at).getTime();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const wait = expiresMs - Date.now();
    if (wait <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), wait + 50); // the buttons switch off the moment it expires
    return () => clearTimeout(t);
  }, [expiresMs]);
  const expired = proposal.status === "pending" && expiresMs <= now;
  const status = expired ? "expired" : proposal.status;
  const done: Record<string, string> = {
    applied: "Applied",
    rejected: "Dismissed",
    expired: "Expired. Ask the coach again if you still want it.",
    failed: "Couldn’t apply this change. Nothing was changed.",
  };

  return (
    <section aria-label="Proposed change" className="w-full rounded-2xl border border-line bg-surface p-4">
      <h3 className="tag text-accent">{TITLE[proposal.kind]}</h3>
      <p className="mt-2 font-semibold leading-snug">{proposal.summary}</p>
      {proposal.preview.length > 0 && (
        <ul className="mt-3 space-y-1.5 rounded-xl bg-surface-2 p-3">
          {proposal.preview.map((l, i) => (
            <Line key={i} text={l} />
          ))}
        </ul>
      )}
      {status === "pending" ? (
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => onDecide(true)}
            disabled={deciding}
            className="tag flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-accent-ink disabled:opacity-60"
          >
            {deciding ? <InlineSpinner /> : <CheckIcon className="size-4" />} Approve
          </button>
          <button onClick={() => onDecide(false)} disabled={deciding} className="tag h-11 flex-1 rounded-xl border border-line text-muted disabled:opacity-60">
            Reject
          </button>
        </div>
      ) : (
        <p role="status" className={`mt-4 flex items-center gap-2 text-sm ${status === "applied" ? "text-ink" : "text-muted"}`}>
          {status === "applied" && <CheckIcon className="size-4 text-accent" />}
          {done[status]}
          {status === "applied" && proposal.kind === "plan_change" && (
            <Link href="/plan" className="tag ml-auto text-accent underline">
              View plan
            </Link>
          )}
        </p>
      )}
    </section>
  );
}
