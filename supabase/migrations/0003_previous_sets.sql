-- Most recent logged sets for each exercise (excluding the workout being edited).
-- SECURITY INVOKER: row-level security applies, so a user only ever sees their own history.
create or replace function public.previous_sets(p_exercise_ids uuid[], p_exclude_workout uuid)
returns table (
  exercise_id  uuid,
  set_number   smallint,
  load_kg      numeric,
  reps         smallint,
  duration_sec smallint,
  performed_on date,
  rir_last_set smallint
)
language sql
stable
security invoker
set search_path = public
as $$
  with latest as (
    select distinct on (we.exercise_id)
           we.id, we.exercise_id, w.performed_on, we.rir_last_set
    from public.workout_exercises we
    join public.workouts w on w.id = we.workout_id
    where we.exercise_id = any (p_exercise_ids)
      and we.workout_id <> p_exclude_workout
      and exists (select 1 from public.set_logs s where s.workout_exercise_id = we.id)
    order by we.exercise_id, w.started_at desc
  )
  select l.exercise_id, s.set_number, s.load_kg, s.reps, s.duration_sec, l.performed_on, l.rir_last_set
  from latest l
  join public.set_logs s on s.workout_exercise_id = l.id
  order by l.exercise_id, s.set_number;
$$;

grant execute on function public.previous_sets(uuid[], uuid) to authenticated;
