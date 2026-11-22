-- Phase 3 of the Coach roadmap: memory. Notes the user has told the Coach (an injury, how many days they train,
-- what equipment they have), shared by every agent. The Coach can only propose a note; saving happens through
-- apply_memory when the user approves the card (see 0016), or the user adds and edits notes themselves.

create table public.agent_memories (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null default 'fact' check (kind in ('fact', 'preference', 'constraint', 'goal')),
  text          text not null check (length(text) between 3 and 300),
  source        text not null default 'user' check (source in ('user', 'coach')),  -- who wrote it: the user, or the Coach with approval
  status        text not null default 'active' check (status in ('active', 'superseded')),
  supersedes_id uuid references public.agent_memories(id) on delete set null,       -- the older note a correction replaced
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index agent_memories_user_idx on public.agent_memories (user_id, status, created_at desc);

alter table public.agent_memories enable row level security;
create policy agent_memories_read   on public.agent_memories for select to authenticated using (user_id = (select auth.uid()));
create policy agent_memories_create on public.agent_memories for insert to authenticated with check (user_id = (select auth.uid()));
create policy agent_memories_edit   on public.agent_memories for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy agent_memories_delete on public.agent_memories for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.agent_memories from anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.agent_memories to service_role;  -- the weekly Analyst reads notes for context
  end if;
end $$;

-- Applies an approved 'memory' proposal: saves the note and, for a correction, retires the note it replaces.
-- Called by approve_proposal as the signed-in user, so row-level security still applies.
create or replace function public.apply_memory(p public.agent_proposals)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_text  text := btrim(p.payload->>'text');
  new_kind  text := coalesce(p.payload->>'kind', 'fact');
  old_id    uuid := nullif(p.payload->>'supersedes_id', '')::uuid;
begin
  if p.user_id is distinct from auth.uid() then
    raise exception 'Not your proposal';
  end if;
  if (select count(*) from public.agent_memories where status = 'active') >= 40 and old_id is null then
    raise exception 'The Coach already holds 40 notes. Remove one first.';
  end if;
  if old_id is not null then
    update public.agent_memories set status = 'superseded', updated_at = now() where id = old_id and status = 'active';
    if not found then
      raise exception 'The note this would replace is no longer there.';
    end if;
  end if;
  insert into public.agent_memories (user_id, kind, text, source, supersedes_id)
  values (p.user_id, new_kind, new_text, 'coach', old_id);
end;
$$;

revoke all on function public.apply_memory(public.agent_proposals) from public, anon;
grant execute on function public.apply_memory(public.agent_proposals) to authenticated;
