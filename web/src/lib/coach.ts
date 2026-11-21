import { getSupabase } from "@/lib/supabase/client";

export const COACH_URL = (process.env.NEXT_PUBLIC_COACH_URL ?? "").replace(/\/$/, "");

/** What a tool result looks like once the server has turned it into something drawable. Numbers come from the tool, not the model. */
export type CoachCard =
  | { kind: "volume"; weeks: { week_of: string; sessions: number; sets: number; volume_kg: number }[] }
  | { kind: "progress"; exercise: string; points: { date: string; est_1rm_kg: number; top_set: string }[]; next_load_kg: number | null }
  | { kind: "bests"; rows: { exercise: string; set: string; est_1rm_kg: number | null; date: string }[] };

export type CoachEvent =
  | { type: "tool"; id: string; label: string }
  | { type: "tool_done"; id: string }
  | { type: "card"; card: CoachCard }
  | { type: "token"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

const TOOL_LABELS: Record<string, string> = {
  get_my_plan: "Checking your plan",
  get_recent_workouts: "Reading your recent workouts",
  find_exercise: "Searching exercises",
  get_exercise_guide: "Looking up form cues",
  get_exercise_progress: "Analysing your progress",
  get_weekly_volume: "Checking your weekly volume",
  get_personal_bests: "Checking your personal bests",
};

/** The server speaks AG-UI (docs.ag-ui.com). This keeps the page on a small set of events it cares about. */
function fromAgUi(e: Record<string, unknown>): CoachEvent | null {
  switch (e.type) {
    case "TOOL_CALL_START":
      return { type: "tool", id: String(e.toolCallId), label: TOOL_LABELS[String(e.toolCallName)] ?? "Working" };
    case "TOOL_CALL_END":
      return { type: "tool_done", id: String(e.toolCallId) };
    case "CUSTOM":
      return e.name === "card" ? { type: "card", card: e.value as CoachCard } : null;
    case "TEXT_MESSAGE_CONTENT":
      return { type: "token", text: String(e.delta ?? "") };
    case "RUN_ERROR":
      return { type: "error", message: String(e.message ?? "The coach hit a problem.") };
    case "RUN_FINISHED":
      return { type: "done" };
    default:
      return null; // RUN_STARTED, TEXT_MESSAGE_START/END, and anything newer
  }
}

export class CoachHttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Wakes a sleeping free-tier service. Resolves true once /health answers. */
export async function pingCoach(signal?: AbortSignal): Promise<boolean> {
  if (!COACH_URL) return false;
  try {
    const res = await fetch(`${COACH_URL}/health`, { signal, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Sends a message and yields server-sent events as they arrive. */
export async function* streamCoach(message: string, signal?: AbortSignal): AsyncGenerator<CoachEvent> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new CoachHttpError("You’re signed out. Please sign in again.", 401);

  const res = await fetch(`${COACH_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    signal,
  });

  if (!res.ok || !res.body) {
    let text = "The coach is unavailable right now.";
    try {
      text = (await res.json()).error ?? text;
    } catch {
      /* keep default */
    }
    throw new CoachHttpError(text, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (!frame.startsWith("data: ")) continue;
      let parsed: CoachEvent | null = null;
      try {
        parsed = fromAgUi(JSON.parse(frame.slice(6)));
      } catch {
        /* ignore a malformed frame */
      }
      if (parsed) yield parsed;
    }
  }
}

export type GenerateStatus = "created" | "exists" | "idle";

/** Asks the service to write last week's review for the signed-in user. */
export async function generateSummary(): Promise<GenerateStatus> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new CoachHttpError("You’re signed out. Please sign in again.", 401);
  const res = await fetch(`${COACH_URL}/summaries/generate`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { status?: GenerateStatus; error?: string };
  if (!res.ok || !body.status) throw new CoachHttpError(body.error ?? "Couldn’t create the summary.", res.status);
  return body.status;
}
