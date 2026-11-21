export type Exercise = {
  id: string;
  name: string;
  main_muscles: string | null;
  purpose: string | null;
  form_instructions: string | null;
  common_mistakes: string | null;
  alternatives: string | null;
  video_url: string | null;
  is_timed: boolean;
  source?: string;
  license?: string | null;
  author?: string | null;
  source_url?: string | null;
  exercise_media?: ExerciseMedia[];
};

export type ExerciseMedia = {
  id: string;
  kind: "image" | "video";
  storage_path: string;
  license: string | null;
  author: string | null;
  is_main: boolean;
  sort_order: number;
};

export type PlannedExercise = {
  id: string;
  planned_sets: number;
  rep_target: string;
  rep_min: number | null;
  rep_max: number | null;
  per_side: boolean;
  is_timed: boolean;
};

export type SetLog = {
  id: string;
  workout_exercise_id: string;
  set_number: number;
  load_kg: number | null;
  reps: number | null;
  duration_sec: number | null;
};

export type WorkoutExercise = {
  id: string;
  workout_id: string;
  exercise_id: string;
  sort_order: number;
  rir_last_set: number | null;
  completed: boolean;
  notes: string | null;
  exercises: Exercise;
  planned_exercises: PlannedExercise | null;
  set_logs: SetLog[];
};

export type Workout = {
  id: string;
  session_id: string | null;
  session_name: string;
  performed_on: string;
  started_at: string;
  finished_at: string | null;
  notes: string | null;
};

export type ProgramSession = {
  id: string;
  name: string;
  day_of_week: number;
  kind: "strength" | "cardio";
  is_optional: boolean;
  sort_order: number;
  planned_exercises: { count: number }[];
};

export type PreviousSet = {
  exercise_id: string;
  set_number: number;
  load_kg: number | null;
  reps: number | null;
  duration_sec: number | null;
  performed_on: string;
  rir_last_set: number | null;
};

export type ExerciseHistoryRow = {
  workout_id: string;
  performed_on: string;
  sets: number;
  top_load: number | null;
  top_reps: number | null;
  best_e1rm: number | null;
  volume: number;
};

export type WeekRow = { week_start: string; sessions: number; sets: number; volume: number };

export type PersonalRecord = {
  exercise_id: string;
  name: string;
  load_kg: number;
  reps: number;
  e1rm: number;
  performed_on: string;
};

export type WeeklySummary = {
  id: string;
  week_start: string;
  content: string;
  read_at: string | null;
  stats: {
    sessions?: number;
    planned_sessions?: number;
    volume_kg?: number;
    prev_volume_kg?: number;
    sets?: number;
    // added by migration 0015; older reviews do not have these and show the simpler layout
    trained_days?: number[]; // ISO weekdays, 1 = Monday
    plan_days?: number[];
    lifts?: {
      exercise: string;
      top_load_kg: number | null;
      best_e1rm_kg: number | null;
      prior_best_e1rm_kg: number | null;
      last_week_top_load_kg: number | null;
      new_best: boolean;
    }[];
    targets?: { exercise: string; kind: "increase" | "hold"; next_load_kg: number; target_reps: number; plan: string }[];
  };
};
