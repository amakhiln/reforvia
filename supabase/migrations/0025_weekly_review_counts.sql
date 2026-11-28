-- Weekly review counting, fixed:
--  * optional sessions no longer count toward the plan: "5/5" was shown with a planned session missed
--  * timed work (cardio, planks) counts as trained, in the session count, the set count and the day strip
--  * a planned session done on another day counts as done
-- New keys: planned_done, extra_sessions, missed_sessions, missed_days. Replaces the function from 0015; grants are kept.
-- Reviews already written keep their old numbers; delete one and generate it again to recount it.

create or replace function public.analyst_week_stats(p_user uuid, p_week_start date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with wk as (
    select p_week_start as s, p_week_start + 6 as e, p_week_start - 7 as ps
  ),
  sets as (
    select w.id as workout_id, w.performed_on, we.exercise_id, e.name,
           sl.load_kg, sl.reps,
           case when sl.load_kg > 0 and sl.reps between 1 and 12 then sl.load_kg * (1 + sl.reps / 30.0) end as e1rm
    from public.set_logs sl
    join public.workout_exercises we on we.id = sl.workout_exercise_id
    join public.workouts w           on w.id = we.workout_id
    join public.exercises e          on e.id = we.exercise_id
    where sl.user_id = p_user and sl.reps is not null
  ),
  logged as (  -- any logged set, with reps or a time: this is what counts as having trained
    select w.id as workout_id, w.performed_on, w.session_id, w.session_name
    from public.set_logs sl
    join public.workout_exercises we on we.id = sl.workout_exercise_id
    join public.workouts w           on w.id = we.workout_id
    where sl.user_id = p_user and (sl.reps is not null or sl.duration_sec is not null)
  ),
  week_logged as (select logged.* from logged, wk where logged.performed_on between wk.s and wk.e),
  planned as (  -- the sessions the active plan expects each week, and whether each one was done on any day
    select ps.id, ps.name, ps.day_of_week, ps.sort_order,
           exists (select 1 from week_logged l
                    where l.session_id = ps.id or (l.session_id is null and l.session_name = ps.name)) as done
    from public.program_sessions ps
    join public.programs p on p.id = ps.program_id
    where p.user_id = p_user and p.is_active and not ps.is_optional
  ),
  this_week as (select * from sets, wk where performed_on between wk.s and wk.e),
  last_week as (select * from sets, wk where performed_on between wk.ps and wk.s - 1),
  lifts as (
    select t.exercise_id, t.name,
           count(*)::int as sets,
           max(t.load_kg) as top_load,
           round(coalesce(sum(t.load_kg * t.reps), 0), 1) as volume,
           round(max(t.e1rm), 1) as best_e1rm,
           (select round(max(l.e1rm), 1) from sets l where l.exercise_id = t.exercise_id and l.performed_on < (select s from wk)) as prior_best_e1rm,
           (select round(max(l.load_kg), 1) from last_week l where l.exercise_id = t.exercise_id) as last_week_top_load,
           (select coalesce(jsonb_agg(jsonb_build_object('load_kg', l.load_kg, 'reps', l.reps)), '[]'::jsonb)
              from this_week l
             where l.exercise_id = t.exercise_id
               and l.performed_on = (select max(m.performed_on) from this_week m where m.exercise_id = t.exercise_id)) as last_sets,
           (select jsonb_build_object('planned_sets', pe.planned_sets, 'rep_min', pe.rep_min, 'rep_max', pe.rep_max, 'rep_target', pe.rep_target)
              from public.planned_exercises pe
              join public.program_sessions ps on ps.id = pe.session_id
              join public.programs p on p.id = ps.program_id
             where p.user_id = p_user and p.is_active and pe.exercise_id = t.exercise_id
             limit 1) as plan
    from this_week t
    group by t.exercise_id, t.name
  )
  select jsonb_build_object(
    'week_start', p_week_start,
    'sessions',         (select count(distinct workout_id) from week_logged),
    'sets',             (select count(*) from week_logged),
    'volume_kg',        (select round(coalesce(sum(load_kg * reps), 0), 1) from this_week),
    'prev_sessions',    (select count(distinct l.workout_id) from logged l, wk where l.performed_on between wk.ps and wk.s - 1),
    'prev_volume_kg',   (select round(coalesce(sum(load_kg * reps), 0), 1) from last_week),
    'planned_sessions', (select count(*) from planned),
    'planned_done',     (select count(*) from planned where done),
    -- everything else logged that week: optional sessions and repeats
    'extra_sessions',   greatest((select count(distinct workout_id) from week_logged) - (select count(*) from planned where done), 0),
    'missed_sessions',  coalesce((select jsonb_agg(name order by day_of_week, sort_order) from planned where not done), '[]'::jsonb),
    'trained_days', coalesce((select jsonb_agg(distinct extract(isodow from performed_on)::int order by extract(isodow from performed_on)::int) from week_logged), '[]'::jsonb),
    'plan_days',    coalesce((select jsonb_agg(distinct day_of_week order by day_of_week) from planned), '[]'::jsonb),
    -- a planned day is missed only if its session was not done on any day and nothing was logged that day
    'missed_days',  coalesce((select jsonb_agg(distinct day_of_week order by day_of_week) from planned
                               where not done and day_of_week not in (select extract(isodow from performed_on)::int from week_logged)), '[]'::jsonb),
    'lifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exercise', name, 'sets', sets, 'top_load_kg', top_load, 'volume_kg', volume,
        'best_e1rm_kg', best_e1rm, 'prior_best_e1rm_kg', prior_best_e1rm, 'last_week_top_load_kg', last_week_top_load,
        'last_sets', last_sets, 'plan', plan,
        'new_best', (best_e1rm is not null and prior_best_e1rm is not null and best_e1rm > prior_best_e1rm)
      ) order by volume desc) from lifts), '[]'::jsonb)
  );
$$;
