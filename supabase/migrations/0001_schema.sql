-- Reforvia — core schema
-- Multi-user from day one: every user-owned row carries user_id and is protected by RLS.
-- Shared content (exercise library, default program template) has a NULL owner and is read-only to users.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Exercise library (shared rows: owner_id is null; custom rows: owner_id = user)
-- ---------------------------------------------------------------------------
create table public.exercises (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid references auth.users(id) on delete cascade,
  name              text not null,
  main_muscles      text,
  purpose           text,
  form_instructions text,
  common_mistakes   text,
  alternatives      text,
  video_url         text,
  equipment         text,
  is_timed          boolean not null default false,
  -- provenance, so imported libraries (e.g. wger, Creative Commons) stay properly attributed
  source            text not null default 'curated',
  license           text,
  author            text,
  source_url        text,
  created_at        timestamptz not null default now()
);

create unique index exercises_shared_name_uq on public.exercises (lower(name)) where owner_id is null;
create unique index exercises_owner_name_uq  on public.exercises (owner_id, lower(name)) where owner_id is not null;

-- ---------------------------------------------------------------------------
-- Programs: user_id null + is_template = default template copied to each new user
-- ---------------------------------------------------------------------------
create table public.programs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  name        text not null,
  is_template boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint template_has_no_owner check (is_template = (user_id is null))
);

create table public.program_sessions (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.programs(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 1 and 7), -- 1 = Monday ... 7 = Sunday
  name        text not null,
  kind        text not null default 'strength' check (kind in ('strength', 'cardio')),
  is_optional boolean not null default false,
  sort_order  smallint not null default 0
);
create index program_sessions_program_idx on public.program_sessions (program_id);

create table public.planned_exercises (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.program_sessions(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  exercise_id  uuid not null references public.exercises(id),
  sort_order   smallint not null default 0,
  planned_sets smallint not null check (planned_sets > 0),
  rep_target   text not null,            -- as written in the plan, e.g. '8–12', '30–45 sec / side'
  rep_min      smallint,                 -- parsed bounds, used for progression
  rep_max      smallint,
  per_side     boolean not null default false,
  is_timed     boolean not null default false
);
create index planned_exercises_session_idx on public.planned_exercises (session_id);

-- ---------------------------------------------------------------------------
-- Logging
-- ---------------------------------------------------------------------------
create table public.workouts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   uuid references public.program_sessions(id) on delete set null,
  session_name text not null,            -- snapshot, survives plan edits
  performed_on date not null default current_date,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  notes        text
);
create index workouts_user_date_idx on public.workouts (user_id, performed_on desc);

create table public.workout_exercises (
  id                  uuid primary key default gen_random_uuid(),
  workout_id          uuid not null references public.workouts(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  planned_exercise_id uuid references public.planned_exercises(id) on delete set null,
  exercise_id         uuid not null references public.exercises(id),
  sort_order          smallint not null default 0,
  rir_last_set        smallint check (rir_last_set between 0 and 10),
  completed           boolean not null default false,
  notes               text
);
create index workout_exercises_workout_idx  on public.workout_exercises (workout_id);
create index workout_exercises_exercise_idx on public.workout_exercises (user_id, exercise_id);

create table public.set_logs (
  id                  uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  set_number          smallint not null check (set_number > 0),
  load_kg             numeric(6,2) check (load_kg >= 0),
  reps                smallint check (reps >= 0),
  duration_sec        smallint check (duration_sec >= 0),
  created_at          timestamptz not null default now(),
  unique (workout_exercise_id, set_number)
);
create index set_logs_we_idx on public.set_logs (workout_exercise_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.exercises         enable row level security;
alter table public.programs          enable row level security;
alter table public.program_sessions  enable row level security;
alter table public.planned_exercises enable row level security;
alter table public.workouts          enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.set_logs          enable row level security;

-- Exercises: everyone signed in reads shared rows + their own; users manage only their own.
create policy exercises_read   on public.exercises for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
create policy exercises_insert on public.exercises for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy exercises_update on public.exercises for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy exercises_delete on public.exercises for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Programs and children: template rows readable by all, user rows only by their owner.
create policy programs_read on public.programs for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy programs_write on public.programs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy sessions_read on public.program_sessions for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy sessions_write on public.program_sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy planned_read on public.planned_exercises for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy planned_write on public.planned_exercises for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Logs: strictly private.
create policy workouts_all on public.workouts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy workout_exercises_all on public.workout_exercises for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy set_logs_all on public.set_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- New users get their own editable copy of the default program template
-- ---------------------------------------------------------------------------
create or replace function public.clone_default_program(target_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tpl        public.programs%rowtype;
  new_prog   uuid;
  s          public.program_sessions%rowtype;
  new_sess   uuid;
begin
  select * into tpl from public.programs where is_template order by created_at limit 1;
  if not found then
    return null;
  end if;

  insert into public.programs (user_id, name, is_template, is_active)
  values (target_user, tpl.name, false, true)
  returning id into new_prog;

  for s in select * from public.program_sessions where program_id = tpl.id order by sort_order loop
    insert into public.program_sessions (program_id, user_id, day_of_week, name, kind, is_optional, sort_order)
    values (new_prog, target_user, s.day_of_week, s.name, s.kind, s.is_optional, s.sort_order)
    returning id into new_sess;

    insert into public.planned_exercises
      (session_id, user_id, exercise_id, sort_order, planned_sets, rep_target, rep_min, rep_max, per_side, is_timed)
    select new_sess, target_user, exercise_id, sort_order, planned_sets, rep_target, rep_min, rep_max, per_side, is_timed
    from public.planned_exercises where session_id = s.id;
  end loop;

  return new_prog;
end;
$$;

revoke all on function public.clone_default_program(uuid) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.clone_default_program(new.id);
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Safety net: if a user signed up before the template was seeded, the app calls this once.
create or replace function public.ensure_my_program()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select id into existing from public.programs where user_id = uid limit 1;
  if existing is not null then
    return existing;
  end if;
  return public.clone_default_program(uid);
end;
$$;

revoke all on function public.ensure_my_program() from public, anon;
grant execute on function public.ensure_my_program() to authenticated;
