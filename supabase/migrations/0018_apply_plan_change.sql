-- Phase 4 of the Coach roadmap: plan changes. The Coach proposes (see 0016); when the user approves, approve_proposal
-- calls this function as them, so row-level security still decides what they can touch. The proposal's payload holds
-- the final values, already validated by the agent; this re-checks them against the plan as it is now and applies
-- every change or none (any error rolls the whole proposal back and marks it failed).
--
-- payload: { "changes": [ up to 5 of
--   {"op":"add",     "session_id", "exercise_id", "planned_sets", "rep_target", "rep_min", "rep_max", "is_timed"}
--   {"op":"replace", "planned_id", "expected_exercise_id", "exercise_id", "is_timed", "per_side", "rep_target", "rep_min", "rep_max"}
--   {"op":"edit",    "planned_id", "expected_exercise_id", "planned_sets", "rep_target", "rep_min", "rep_max"} ] }

create or replace function public.apply_plan_change(p public.agent_proposals)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  ch        jsonb;
  op        text;
  n         int := coalesce(jsonb_array_length(p.payload->'changes'), 0);
  pid       uuid;
  sid       uuid;
  cur_ex    uuid;
  sets      int;
  lo        int;
  hi        int;
  timed     boolean;
begin
  if p.user_id is distinct from auth.uid() then
    raise exception 'Not your proposal';
  end if;
  if n < 1 or n > 5 then
    raise exception 'A plan change holds 1 to 5 changes.';
  end if;

  for ch in select * from jsonb_array_elements(p.payload->'changes') loop
    op   := ch->>'op';
    sets := (ch->>'planned_sets')::int;
    lo   := (ch->>'rep_min')::int;
    hi   := (ch->>'rep_max')::int;

    if op in ('add', 'edit') and (sets is null or sets not between 1 and 10) then
      raise exception 'Sets must be between 1 and 10.';
    end if;
    -- an old plan row can lack parsed bounds (null); edit and replace may carry that through, an add may not
    if (op = 'add' or lo is not null or hi is not null) and (lo is null or hi is null or lo < 1 or hi < lo or hi > 999) then
      raise exception 'The rep range is not valid.';
    end if;

    if op = 'add' then
      sid := (ch->>'session_id')::uuid;
      perform 1 from public.program_sessions where id = sid;
      if not found then
        raise exception 'That session is no longer in your plan.';
      end if;
      perform 1 from public.planned_exercises where session_id = sid and exercise_id = (ch->>'exercise_id')::uuid;
      if found then
        raise exception 'That exercise is already in the session.';
      end if;
      perform 1 from public.exercises where id = (ch->>'exercise_id')::uuid;
      if not found then
        raise exception 'That exercise is no longer available.';
      end if;
      insert into public.planned_exercises
        (session_id, user_id, exercise_id, sort_order, planned_sets, rep_target, rep_min, rep_max, per_side, is_timed)
      values
        (sid, p.user_id, (ch->>'exercise_id')::uuid,
         coalesce((select max(sort_order) + 1 from public.planned_exercises where session_id = sid), 0),
         sets, ch->>'rep_target', lo, hi, false, coalesce((ch->>'is_timed')::boolean, false));

    elsif op in ('replace', 'edit') then
      pid := (ch->>'planned_id')::uuid;
      select exercise_id into cur_ex from public.planned_exercises where id = pid;
      if not found then
        raise exception 'An exercise in this change is no longer in your plan.';
      end if;
      if cur_ex is distinct from (ch->>'expected_exercise_id')::uuid then
        raise exception 'Your plan changed since this was proposed. Ask the Coach again.';
      end if;
      if op = 'replace' then
        perform 1 from public.exercises where id = (ch->>'exercise_id')::uuid;
        if not found then
          raise exception 'That exercise is no longer available.';
        end if;
        timed := coalesce((ch->>'is_timed')::boolean, false);
        update public.planned_exercises
           set exercise_id = (ch->>'exercise_id')::uuid, is_timed = timed,
               per_side = coalesce((ch->>'per_side')::boolean, false),
               rep_target = ch->>'rep_target', rep_min = lo, rep_max = hi
         where id = pid;
      else
        update public.planned_exercises
           set planned_sets = sets, rep_target = ch->>'rep_target', rep_min = lo, rep_max = hi
         where id = pid;
      end if;

    else
      raise exception 'Unknown change type.';
    end if;
  end loop;
end;
$$;

revoke all on function public.apply_plan_change(public.agent_proposals) from public, anon;
grant execute on function public.apply_plan_change(public.agent_proposals) to authenticated;
