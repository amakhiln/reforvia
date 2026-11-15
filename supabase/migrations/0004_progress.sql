-- Progress analytics. All functions are SECURITY INVOKER, so row-level security scopes them to the caller.
-- Estimated 1RM uses the Epley formula (load x (1 + reps/30)) and only counts sets of 1–12 reps, where it is reliable.

-- One row per workout in which the exercise was logged.
create or replace function public.exercise_history(p_exercise_id uuid)
returns table (
  workout_id   uuid,
  performed_on date,
  sets         integer,
  top_load     numeric,
  top_reps     smallint,
  best_e1rm    numeric,
  volume       numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with s as (
    select w.id as workout_id, w.performed_on, w.started_at, sl.load_kg, sl.reps
    from public.workout_exercises we
    join public.workouts w     on w.id = we.workout_id
    join public.set_logs sl    on sl.workout_exercise_id = we.id
    where we.exercise_id = p_exercise_id and sl.reps is not null
  ),
  agg as (
    select workout_id, performed_on, min(started_at) as started_at,
           count(*)::int as sets,
           coalesce(sum(load_kg * reps), 0) as volume,
           max(case when load_kg > 0 and reps between 1 and 12 then load_kg * (1 + reps / 30.0) end) as best_e1rm
    from s group by workout_id, performed_on
  ),
  top as (
    select distinct on (workout_id) workout_id, load_kg as top_load, reps as top_reps
    from s order by workout_id, load_kg desc nulls last, reps desc
  )
  select a.workout_id, a.performed_on, a.sets, t.top_load, t.top_reps,
         round(a.best_e1rm, 1), round(a.volume, 1)
  from agg a join top t using (workout_id)
  order by a.performed_on, a.started_at;
$$;

-- Training volume per ISO week (Monday start), including empty weeks, ending at the week of p_today.
create or replace function public.weekly_summary(p_weeks integer, p_today date)
returns table (
  week_start date,
  sessions   integer,
  sets       integer,
  volume     numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select (date_trunc('week', p_today)::date - (greatest(p_weeks, 1) - 1) * 7) as first_week,
           date_trunc('week', p_today)::date as last_week
  ),
  weeks as (
    select generate_series(first_week, last_week, interval '7 days')::date as wk from bounds
  ),
  agg as (
    select date_trunc('week', w.performed_on)::date as wk,
           count(distinct w.id)::int as sessions,
           count(sl.id)::int as sets,
           coalesce(sum(sl.load_kg * sl.reps), 0) as volume
    from public.workouts w
    join public.workout_exercises we on we.workout_id = w.id
    join public.set_logs sl          on sl.workout_exercise_id = we.id
    where w.performed_on >= (select first_week from bounds)
    group by 1
  )
  select weeks.wk, coalesce(agg.sessions, 0), coalesce(agg.sets, 0), round(coalesce(agg.volume, 0), 1)
  from weeks left join agg on agg.wk = weeks.wk
  order by weeks.wk;
$$;

-- Best estimated 1RM per exercise, with the set that produced it.
create or replace function public.personal_records()
returns table (
  exercise_id  uuid,
  name         text,
  load_kg      numeric,
  reps         smallint,
  e1rm         numeric,
  performed_on date
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (we.exercise_id)
         we.exercise_id, e.name, sl.load_kg, sl.reps,
         round(sl.load_kg * (1 + sl.reps / 30.0), 1) as e1rm,
         w.performed_on
  from public.set_logs sl
  join public.workout_exercises we on we.id = sl.workout_exercise_id
  join public.workouts w           on w.id = we.workout_id
  join public.exercises e          on e.id = we.exercise_id
  where sl.load_kg > 0 and sl.reps between 1 and 12
  order by we.exercise_id, sl.load_kg * (1 + sl.reps / 30.0) desc, w.performed_on desc;
$$;

grant execute on function public.exercise_history(uuid)        to authenticated;
grant execute on function public.weekly_summary(integer, date) to authenticated;
grant execute on function public.personal_records()            to authenticated;
