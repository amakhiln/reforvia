-- Phase 4: weekly summaries written by the Analyst agent, plus Web Push subscriptions.
-- Summaries are written only by the server (service role); users can read them and mark them read.

create table public.weekly_summaries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  week_start  date not null,                       -- Monday of the week being summarised
  content     text not null check (length(content) between 1 and 20000),
  stats       jsonb not null default '{}'::jsonb,  -- the numbers the summary was written from
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  unique (user_id, week_start)
);
create index weekly_summaries_user_idx on public.weekly_summaries (user_id, week_start desc);

alter table public.weekly_summaries enable row level security;
create policy weekly_summaries_read on public.weekly_summaries for select to authenticated using (user_id = (select auth.uid()));
create policy weekly_summaries_mark on public.weekly_summaries for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Users may only change read_at, never the text or the numbers.
revoke update on public.weekly_summaries from authenticated;
grant update (read_at) on public.weekly_summaries to authenticated;

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique check (length(endpoint) <= 2000),
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy push_subs_read   on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy push_subs_insert on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy push_subs_delete on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Server-only helpers for the weekly run (callable with the service role key only).

-- Users who trained in the last 28 days before p_week_end and have no summary for that week yet.
create or replace function public.analyst_users(p_week_start date)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct w.user_id
  from public.workouts w
  where w.performed_on >= p_week_start - 28
    and w.performed_on <  p_week_start + 7
    and not exists (
      select 1 from public.weekly_summaries s where s.user_id = w.user_id and s.week_start = p_week_start
    );
$$;

-- Everything the Analyst needs about one user's week, as one JSON document.
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
           (select round(max(l.load_kg), 1) from last_week l where l.exercise_id = t.exercise_id) as last_week_top_load
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
    'lifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exercise', name, 'sets', sets, 'top_load_kg', top_load, 'volume_kg', volume,
        'best_e1rm_kg', best_e1rm, 'last_week_top_load_kg', last_week_top_load,
        'new_best', (best_e1rm is not null and prior_best_e1rm is not null and best_e1rm > prior_best_e1rm)
      ) order by volume desc) from lifts), '[]'::jsonb)
  );
$$;

revoke all on function public.analyst_users(date)              from public, anon, authenticated;
revoke all on function public.analyst_week_stats(uuid, date)   from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.analyst_users(date)            to service_role;
    grant execute on function public.analyst_week_stats(uuid, date) to service_role;
    grant select, insert, update on public.weekly_summaries to service_role;
    grant select, delete on public.push_subscriptions to service_role;
  end if;
end $$;
