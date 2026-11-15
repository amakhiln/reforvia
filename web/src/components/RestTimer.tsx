"use client";

import { useEffect, useRef, useState } from "react";

export function RestTimer({
  endsAt,
  total,
  onAdjust,
  onDismiss,
}: {
  endsAt: number;
  total: number;
  onAdjust: (deltaSeconds: number) => void;
  onDismiss: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
  }, [endsAt]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const remainingMs = Math.max(0, endsAt - now);
  const remaining = Math.ceil(remainingMs / 1000);
  const finished = remainingMs === 0;

  useEffect(() => {
    if (!finished || firedRef.current) return;
    firedRef.current = true;
    try {
      navigator.vibrate?.([220, 120, 220]);
    } catch {
      /* vibration is optional */
    }
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [finished, onDismiss]);

  const pct = Math.min(100, Math.max(0, ((total * 1000 - remainingMs) / (total * 1000)) * 100));
  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      <div
        role="timer"
        aria-live="off"
        className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-lg shadow-black/20"
      >
        <div className="h-1 bg-surface-2">
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">{finished ? "Rest over" : "Rest"}</p>
            <p className={`text-2xl font-semibold tabular-nums ${finished ? "text-accent" : ""}`}>
              {finished ? "Go!" : `${mm}:${ss}`}
            </p>
          </div>
          <button onClick={() => onAdjust(-15)} className="h-10 rounded-lg bg-surface-2 px-3 text-sm font-medium" aria-label="Subtract 15 seconds">
            −15s
          </button>
          <button onClick={() => onAdjust(15)} className="h-10 rounded-lg bg-surface-2 px-3 text-sm font-medium" aria-label="Add 15 seconds">
            +15s
          </button>
          <button onClick={onDismiss} className="h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink">
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
