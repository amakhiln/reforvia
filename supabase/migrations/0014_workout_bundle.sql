-- Open or start a workout in one round trip.
--   workout_bundle(id)               everything the workout screen shows, as one JSON document
--   start_workout(session, date)     creates the workout (or reuses today's) and returns the same bundle
-- Both are SECURITY INVOKER, so row-level security scopes them to the signed-in user.
-- Shape: { workout, items: [workout_exercises + exercises(+exercise_media) + planned_exercises + set_logs], previous: [previous_sets rows] }

create or replace function public.workout_bundle(p_workout_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'workout', to_jsonb(w),
    'items', coalesce((
      select jsonb_agg(s.item order by s.sort_order)
      from (
        select we.sort_order,
               to_jsonb(we) || jsonb_build_object(
                 'exercises', to_jsonb(e) || jsonb_build_object(
                   'exercise_media', coalesce((
                     select jsonb_agg(to_jsonb(m) order by m.sort_order) from public.exercise_media m where m.exercise_id = e.id
                   ), '[]'::jsonb)),
                 'planned_exercises', (select to_jsonb(pe) from public.planned_exercises pe where pe.id = we.planned_exercise_id),
                 'set_logs', coalesce((
                   select jsonb_agg(to_jsonb(sl) order by sl.set_number) from public.set_logs sl where sl.workout_exercise_id = we.id
                 ), '[]'::jsonb)
               ) as item
        from public.workout_exercises we
        join public.exercises e on e.id = we.exercise_id
        where we.workout_id = w.id
      ) s
    ), '[]'::jsonb),
    'previous', coalesce((
      select jsonb_agg(to_jsonb(p))
      from public.previous_sets(
        array(select we2.exercise_id from public.workout_exercises we2 where we2.workout_id = w.id), w.id
      ) p
    ), '[]'::jsonb)
  )
  from public.workouts w
  where w.id = p_workout_id;
$$;

create or replace function public.start_workout(p_session_id uuid, p_performed_on date)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  s   public.program_sessions%rowtype;
  wid uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select * into s from public.program_sessions where id = p_session_id and user_id = uid;
  if not found then
    raise exception 'session not found';
  end if;

  -- A second tap, or a second device, opens the same workout instead of creating a duplicate.
  select id into wid from public.workouts
   where user_id = uid and session_id = s.id and performed_on = p_performed_on
   order by started_at desc limit 1;

  if wid is null then
    insert into public.workouts (user_id, session_id, session_name, performed_on)
    values (uid, s.id, s.name, p_performed_on)
    returning id into wid;

    insert into public.workout_exercises (workout_id, user_id, planned_exercise_id, exercise_id, sort_order)
    select wid, uid, pe.id, pe.exercise_id, (row_number() over (order by pe.sort_order, pe.id) - 1)::smallint
    from public.planned_exercises pe
    where pe.session_id = s.id;
  end if;

  return public.workout_bundle(wid);
end;
$$;

revoke all on function public.workout_bundle(uuid) from public, anon;
revoke all on function public.start_workout(uuid, date) from public, anon;
grant execute on function public.workout_bundle(uuid) to authenticated;
grant execute on function public.start_workout(uuid, date) to authenticated;
