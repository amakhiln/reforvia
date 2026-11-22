-- Phase 2 of the Coach roadmap: proposals.
-- The Coach never changes data. It writes a proposal row; the user approves or rejects it in the app, and only then
-- does ordinary SQL apply it. Everything runs as the signed-in user, so row-level security covers every step.

create table public.agent_proposals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('plan_change', 'memory')),
  payload    jsonb not null,                                   -- the validated change itself; what apply_<kind> reads
  summary    text not null check (length(summary) between 1 and 300),
  preview    jsonb not null default '[]'::jsonb,               -- lines shown on the approval card, built by code from payload
  status     text not null default 'pending' check (status in ('pending', 'applied', 'rejected', 'expired', 'failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  decided_at timestamptz,
  error      text
);
create index agent_proposals_user_idx on public.agent_proposals (user_id, status, created_at desc);

alter table public.agent_proposals enable row level security;
create policy agent_proposals_read   on public.agent_proposals for select to authenticated using (user_id = (select auth.uid()));
create policy agent_proposals_create on public.agent_proposals for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');
-- A decided proposal is final: only a pending one can still change.
create policy agent_proposals_decide on public.agent_proposals for update to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()));

revoke all on public.agent_proposals from anon;
revoke update on public.agent_proposals from authenticated;
grant select, insert on public.agent_proposals to authenticated;
grant update (status, decided_at, error) on public.agent_proposals to authenticated;

-- Approve: claims the proposal, runs public.apply_<kind>(proposal) if it exists, and records the result, all in one
-- transaction. Business outcomes are returned, not raised: the row as it stands (so a second tap just sees "applied"),
-- or null when the proposal is not visible to the caller. Security invoker: apply functions run under the user's own RLS.
create or replace function public.approve_proposal(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.agent_proposals;
  fn text;
begin
  select * into r from public.agent_proposals where id = p_id;
  if not found then
    return null;
  end if;
  if r.status <> 'pending' then
    return to_jsonb(r);
  end if;
  -- Lock it so two taps at once cannot both apply. Row-level security hides a decided row from FOR UPDATE, so a
  -- miss here means another call decided it first: report how it ended.
  select * into r from public.agent_proposals where id = p_id and status = 'pending' for update;
  if not found then
    select * into r from public.agent_proposals where id = p_id;
    return to_jsonb(r);
  end if;
  if r.expires_at <= now() then
    update public.agent_proposals set status = 'expired', decided_at = now() where id = p_id returning * into r;
    return to_jsonb(r);
  end if;

  fn := 'apply_' || r.kind;
  if to_regprocedure('public.' || fn || '(public.agent_proposals)') is null then
    update public.agent_proposals set status = 'failed', decided_at = now(), error = 'This kind of change cannot be applied yet.'
      where id = p_id returning * into r;
    return to_jsonb(r);
  end if;

  begin
    execute format('select public.%I($1)', fn) using r;
    update public.agent_proposals set status = 'applied', decided_at = now() where id = p_id returning * into r;
  exception when others then
    -- the sub-transaction rolled back whatever the apply function had done
    update public.agent_proposals set status = 'failed', decided_at = now(), error = left(sqlerrm, 300)
      where id = p_id returning * into r;
  end;
  return to_jsonb(r);
end;
$$;

create or replace function public.reject_proposal(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.agent_proposals;
begin
  update public.agent_proposals set status = 'rejected', decided_at = now()
    where id = p_id and status = 'pending' returning * into r;
  if not found then
    select * into r from public.agent_proposals where id = p_id;
    if not found then
      return null;
    end if;
  end if;
  return to_jsonb(r);
end;
$$;

revoke all on function public.approve_proposal(uuid) from public, anon;
revoke all on function public.reject_proposal(uuid) from public, anon;
grant execute on function public.approve_proposal(uuid) to authenticated;
grant execute on function public.reject_proposal(uuid) to authenticated;
