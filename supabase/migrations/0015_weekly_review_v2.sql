-- Weekly review v2: the Analyst's numbers gain what the new review screen draws.
--  trained_days / plan_days   ISO weekdays (1 = Monday) the user trained on and the plan schedules
--  prior_best_e1rm_kg         the estimated 1RM a new best beat, for "80 -> 84 kg"
--  last_sets / plan           the last session's sets and the plan's rep range, so the server can work out next week's loads
-- Replaces the function from 0006 in place; its grants are kept.

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
    'sessions',         (select count(distinct workout_id) from this_week),
    'sets',             (select count(*) from this_week),
    'volume_kg',        (select round(coalesce(sum(load_kg * reps), 0), 1) from this_week),
    'prev_sessions',    (select count(distinct workout_id) from last_week),
    'prev_volume_kg',   (select round(coalesce(sum(load_kg * reps), 0), 1) from last_week),
    'planned_sessions', (select count(*) from public.program_sessions ps
                           join public.programs p on p.id = ps.program_id
                          where p.user_id = p_user and not ps.is_optional),
    'trained_days', coalesce((select jsonb_agg(distinct extract(isodow from performed_on)::int order by extract(isodow from performed_on)::int) from this_week), '[]'::jsonb),
    'plan_days', coalesce((select jsonb_agg(distinct ps.day_of_week order by ps.day_of_week)
                             from public.program_sessions ps
                             join public.programs p on p.id = ps.program_id
                            where p.user_id = p_user and p.is_active and not ps.is_optional), '[]'::jsonb),
    'lifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exercise', name, 'sets', sets, 'top_load_kg', top_load, 'volume_kg', volume,
        'best_e1rm_kg', best_e1rm, 'prior_best_e1rm_kg', prior_best_e1rm, 'last_week_top_load_kg', last_week_top_load,
        'last_sets', last_sets, 'plan', plan,
        'new_best', (best_e1rm is not null and prior_best_e1rm is not null and best_e1rm > prior_best_e1rm)
      ) order by volume desc) from lifts), '[]'::jsonb)
  );
$$;
