-- Mark a planned day as skipped. The user says "I didn't train", optionally why; the weekly review and the Coach then
-- treat it as skipped on purpose, not forgotten. Doing the session afterwards overrides the mark.

create table public.session_skips (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   uuid references public.program_sessions(id) on delete set null,
  session_name text not null check (length(session_name) between 1 and 200),  -- snapshot, survives plan edits
  skipped_on   date not null,
  reason       text check (reason in ('rest', 'sick', 'injury', 'busy', 'travel')),
  created_at   timestamptz not null default now(),
  unique (user_id, session_id, skipped_on)
);
create index session_skips_user_date_idx on public.session_skips (user_id, skipped_on desc);

alter table public.session_skips enable row level security;
create policy session_skips_read   on public.session_skips for select to authenticated using (user_id = (select auth.uid()));
create policy session_skips_create on public.session_skips for insert to authenticated with check (user_id = (select auth.uid()));
create policy session_skips_edit   on public.session_skips for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy session_skips_delete on public.session_skips for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.session_skips from anon;

-- The weekly stats gain skipped_sessions and skipped_days; missed_* now means not done and not marked.
-- Replaces the function from 0025; its grants are kept.

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
  planned as (  -- the sessions the active plan expects each week, whether each was done on any day, and if the user marked it skipped
    select ps.id, ps.name, ps.day_of_week, ps.sort_order,
           exists (select 1 from week_logged l
                    where l.session_id = ps.id or (l.session_id is null and l.session_name = ps.name)) as done,
           sk.id is not null as skip_marked, sk.reason as skip_reason
    from public.program_sessions ps
    join public.programs p on p.id = ps.program_id
    left join lateral (
      select k.id, k.reason from public.session_skips k, wk
       where k.user_id = p_user and k.skipped_on between wk.s and wk.e
         and (k.session_id = ps.id or (k.session_id is null and k.session_name = ps.name))
       order by k.skipped_on desc limit 1
    ) sk on true
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
    -- not done and not explained: forgotten or missed. Doing the session later overrides an earlier skip mark.
    'missed_sessions',  coalesce((select jsonb_agg(name order by day_of_week, sort_order) from planned where not done and not skip_marked), '[]'::jsonb),
    'skipped_sessions', coalesce((select jsonb_agg(jsonb_build_object('session', name, 'reason', skip_reason) order by day_of_week, sort_order)
                                    from planned where not done and skip_marked), '[]'::jsonb),
    'trained_days', coalesce((select jsonb_agg(distinct extract(isodow from performed_on)::int order by extract(isodow from performed_on)::int) from week_logged), '[]'::jsonb),
    'plan_days',    coalesce((select jsonb_agg(distinct day_of_week order by day_of_week) from planned), '[]'::jsonb),
    -- a planned day is missed only if its session was not done on any day and nothing was logged that day
    'missed_days',  coalesce((select jsonb_agg(distinct day_of_week order by day_of_week) from planned
                               where not done and not skip_marked and day_of_week not in (select extract(isodow from performed_on)::int from week_logged)), '[]'::jsonb),
    'skipped_days', coalesce((select jsonb_agg(distinct day_of_week order by day_of_week) from planned
                               where not done and skip_marked and day_of_week not in (select extract(isodow from performed_on)::int from week_logged)), '[]'::jsonb),
    'lifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exercise', name, 'sets', sets, 'top_load_kg', top_load, 'volume_kg', volume,
        'best_e1rm_kg', best_e1rm, 'prior_best_e1rm_kg', prior_best_e1rm, 'last_week_top_load_kg', last_week_top_load,
        'last_sets', last_sets, 'plan', plan,
        'new_best', (best_e1rm is not null and prior_best_e1rm is not null and best_e1rm > prior_best_e1rm)
      ) order by volume desc) from lifts), '[]'::jsonb)
  );
$$;
