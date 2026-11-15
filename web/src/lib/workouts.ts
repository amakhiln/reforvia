import { getSupabase } from "@/lib/supabase/client";
import { localISO } from "@/lib/dates";

/** Creates a workout from a plan session and pre-creates one entry per planned exercise. */
export async function startWorkout(sessionId: string, sessionName: string): Promise<string> {
  const sb = getSupabase();
  const { data: auth } = await sb.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) throw new Error("You’re signed out. Please sign in again.");

  // The two requests don't depend on each other, so send them together.
  const [{ data: workout, error: wErr }, { data: planned, error: pErr }] = await Promise.all([
    sb
      .from("workouts")
      .insert({ user_id: userId, session_id: sessionId, session_name: sessionName, performed_on: localISO() })
      .select("id")
      .single(),
    sb.from("planned_exercises").select("id, exercise_id, sort_order").eq("session_id", sessionId).order("sort_order"),
  ]);
  if (wErr || !workout) throw wErr ?? new Error("Could not start workout");
  if (pErr) throw pErr;

  if (planned && planned.length > 0) {
    const { error: eErr } = await sb.from("workout_exercises").insert(
      (planned as { id: string; exercise_id: string }[]).map((p, i) => ({
        workout_id: workout.id,
        user_id: userId,
        planned_exercise_id: p.id,
        exercise_id: p.exercise_id,
        sort_order: i,
      })),
    );
    if (eErr) throw eErr;
  }
  return workout.id as string;
}
