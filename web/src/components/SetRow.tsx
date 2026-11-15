"use client";

import { useState } from "react";
import { CheckIcon } from "./icons";
import type { SetLog } from "@/lib/types";

export type SetValues = { load: number | null; reps: number | null; duration: number | null };

type Props = {
  setNumber: number;
  log?: SetLog;
  timed: boolean;
  timedUnit: "sec" | "min";
  placeholder: { load: number | null; reps: number | null };
  onLog: (values: SetValues) => Promise<void>;
  onEditLogged: (values: SetValues) => Promise<void>;
  onUnlog: () => Promise<void>;
};

const toStr = (n: number | null | undefined) => (n == null ? "" : String(n));
const toNum = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function SetRow({ setNumber, log, timed, timedUnit, placeholder, onLog, onEditLogged, onUnlog }: Props) {
  const divisor = timedUnit === "min" ? 60 : 1;
  const [load, setLoad] = useState(toStr(log?.load_kg));
  const [reps, setReps] = useState(toStr(log?.reps));
  const [dur, setDur] = useState(toStr(log?.duration_sec != null ? log.duration_sec / divisor : null));
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  // Re-sync the inputs when the saved row changes (derive state from props, no effect needed).
  const signature = `${log?.id}|${log?.load_kg}|${log?.reps}|${log?.duration_sec}|${divisor}`;
  const [seenSignature, setSeenSignature] = useState(signature);
  if (signature !== seenSignature) {
    setSeenSignature(signature);
    setLoad(toStr(log?.load_kg));
    setReps(toStr(log?.reps));
    setDur(toStr(log?.duration_sec != null ? log.duration_sec / divisor : null));
  }

  const logged = Boolean(log);

  function current(): SetValues | null {
    if (timed) {
      const d = toNum(dur) ?? placeholder.reps;
      if (d == null) return null;
      return { load: null, reps: null, duration: Math.round(d * divisor) };
    }
    const r = toNum(reps) ?? placeholder.reps;
    if (r == null) return null;
    return { load: toNum(load) ?? placeholder.load, reps: Math.round(r), duration: null };
  }

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (logged) {
        await onUnlog();
        return;
      }
      const v = current();
      if (!v) {
        setInvalid(true);
        setTimeout(() => setInvalid(false), 900);
        return;
      }
      setInvalid(false);
      await onLog(v);
    } finally {
      setBusy(false);
    }
  }

  async function blurSave() {
    if (!logged || busy) return;
    const v = current();
    if (!v) return;
    const changed =
      v.load !== (log?.load_kg ?? null) || v.reps !== (log?.reps ?? null) || v.duration !== (log?.duration_sec ?? null);
    if (changed) await onEditLogged(v);
  }

  const field =
    "h-12 w-full min-w-0 rounded-xl border bg-surface-2 px-3 text-center text-xl font-semibold tabular-nums tracking-tight placeholder:font-normal placeholder:text-muted/60";
  const ring = invalid ? "border-danger" : "border-transparent";

  return (
    <div className="flex items-center gap-2">
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-semibold ${
          logged ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"
        }`}
      >
        {setNumber}
      </span>

      {timed ? (
        <input
          inputMode="decimal"
          aria-label={`Set ${setNumber} duration in ${timedUnit === "min" ? "minutes" : "seconds"}`}
          placeholder={toStr(placeholder.reps) || (timedUnit === "min" ? "min" : "sec")}
          value={dur}
          onChange={(e) => setDur(e.target.value)}
          onBlur={blurSave}
          className={`${field} ${ring}`}
        />
      ) : (
        <>
          <input
            inputMode="decimal"
            aria-label={`Set ${setNumber} load in kilograms`}
            placeholder={toStr(placeholder.load) || "kg"}
            value={load}
            onChange={(e) => setLoad(e.target.value)}
            onBlur={blurSave}
            className={`${field} ${ring}`}
          />
          <input
            inputMode="numeric"
            aria-label={`Set ${setNumber} reps`}
            placeholder={toStr(placeholder.reps) || "reps"}
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            onBlur={blurSave}
            className={`${field} ${ring}`}
          />
        </>
      )}

      <button
        onClick={toggle}
        disabled={busy}
        aria-pressed={logged}
        aria-label={logged ? `Undo set ${setNumber}` : `Log set ${setNumber}`}
        className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${
          logged ? "bg-accent text-accent-ink pop" : "bg-surface-2 text-muted"
        }`}
      >
        <CheckIcon />
      </button>
    </div>
  );
}
