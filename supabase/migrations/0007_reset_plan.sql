-- Reset the signed-in user's plan to the default template.
-- Logged workouts and history are kept: the plan is rebuilt, then this user's workouts are
-- re-linked to the new sessions and planned exercises by name, so this week's status survives.

create or replace function public.reset_my_program()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  new_prog uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.programs where is_template) then
    raise exception 'no default program template found';  -- checked first so nothing is deleted
  end if;

  -- Cascades to sessions and planned exercises; workouts keep their rows (session_id and
  -- planned_exercise_id are set null by their foreign keys).
  delete from public.programs where user_id = uid;
  new_prog := public.clone_default_program(uid);

  update public.workouts w
     set session_id = s.id
    from public.program_sessions s
   where w.user_id = uid and w.session_id is null
     and s.program_id = new_prog and s.name = w.session_name;

  update public.workout_exercises we
     set planned_exercise_id = pe.id
    from public.workouts w, public.planned_exercises pe
   where we.user_id = uid and we.planned_exercise_id is null
     and w.id = we.workout_id and pe.session_id = w.session_id and pe.exercise_id = we.exercise_id;

  return new_prog;
end;
$$;

revoke all on function public.reset_my_program() from public, anon;
grant execute on function public.reset_my_program() to authenticated;
