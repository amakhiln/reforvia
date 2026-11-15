import { getSupabase } from "@/lib/supabase/client";
import { localISO } from "@/lib/dates";
import type { WorkoutBundle } from "@/lib/workoutBundle";

/** Starts today's workout for a plan session (or reopens it if one exists) and returns everything to show, in one round trip. */
export async function startWorkout(sessionId: string): Promise<WorkoutBundle> {
  const { data, error } = await getSupabase().rpc("start_workout", { p_session_id: sessionId, p_performed_on: localISO() });
  if (error) throw error;
  if (!data) throw new Error("Could not start workout");
  return data as WorkoutBundle;
}
