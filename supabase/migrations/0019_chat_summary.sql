-- Phase 5 of the Coach roadmap: a rolling summary of the chat that has scrolled out of the Coach's window.
-- One row per user, rewritten by the agent (as the user) when older messages fall out of the last-20 window.
-- The user can read it, and delete it on the notes screen; clearing the chat deletes it too.

create table public.agent_chat_summary (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  summary       text not null check (length(summary) between 1 and 2000),
  covered_until timestamptz not null,   -- created_at of the newest message the summary includes
  updated_at    timestamptz not null default now()
);

alter table public.agent_chat_summary enable row level security;
create policy agent_chat_summary_read   on public.agent_chat_summary for select to authenticated using (user_id = (select auth.uid()));
create policy agent_chat_summary_create on public.agent_chat_summary for insert to authenticated with check (user_id = (select auth.uid()));
create policy agent_chat_summary_edit   on public.agent_chat_summary for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy agent_chat_summary_delete on public.agent_chat_summary for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.agent_chat_summary from anon;
