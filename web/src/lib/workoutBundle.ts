import { getSupabase } from "@/lib/supabase/client";
import type { PreviousSet, Workout, WorkoutExercise } from "@/lib/types";

/** Everything the workout screen shows, fetched in one round trip (see migration 0014). */
export type WorkoutBundle = { workout: Workout; items: WorkoutExercise[]; previous: PreviousSet[] };

// A preloaded bundle is handed to the workout screen once, and only while it is fresh, so it never shows stale sets.
const FRESH_MS = 30_000;
const cache = new Map<string, { bundle: WorkoutBundle; at: number }>();

export function primeBundle(bundle: WorkoutBundle) {
  cache.set(bundle.workout.id, { bundle, at: Date.now() });
}

export function takeBundle(id: string): WorkoutBundle | null {
  const hit = cache.get(id);
  cache.delete(id);
  return hit && Date.now() - hit.at < FRESH_MS ? hit.bundle : null;
}

export async function fetchBundle(id: string): Promise<WorkoutBundle> {
  const { data, error } = await getSupabase().rpc("workout_bundle", { p_workout_id: id });
  if (error) throw error;
  if (!data) throw new Error("Workout not found");
  return data as WorkoutBundle;
}

/** Warm the cache in the background; a failure just means the screen fetches it itself. */
export function prefetchBundle(id: string) {
  void fetchBundle(id).then(primeBundle, () => {});
}
