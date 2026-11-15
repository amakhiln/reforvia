import { getSupabase } from "@/lib/supabase/client";

export const COACH_URL = (process.env.NEXT_PUBLIC_COACH_URL ?? "").replace(/\/$/, "");

export type CoachEvent =
  | { type: "tool"; label: string }
  | { type: "token"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

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
      try {
        yield JSON.parse(frame.slice(6)) as CoachEvent;
      } catch {
        /* ignore a malformed frame */
      }
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
