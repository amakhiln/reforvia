-- Coach: chat history + per-user usage limits.

create table public.coach_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null check (length(content) between 1 and 20000),
  created_at timestamptz not null default now()
);
create index coach_messages_user_idx on public.coach_messages (user_id, created_at desc);

alter table public.coach_messages enable row level security;
create policy coach_messages_read   on public.coach_messages for select to authenticated using (user_id = (select auth.uid()));
create policy coach_messages_insert on public.coach_messages for insert to authenticated with check (user_id = (select auth.uid()));
create policy coach_messages_delete on public.coach_messages for delete to authenticated using (user_id = (select auth.uid()));

-- Usage counters can only be changed through the functions below, never directly by the user,
-- so the daily cap cannot be reset from the browser.
create table public.agent_usage (
  user_id       uuid not null references auth.users(id) on delete cascade,
  day           date not null,
  messages      integer not null default 0,
  input_tokens  bigint  not null default 0,
  output_tokens bigint  not null default 0,
  primary key (user_id, day)
);
alter table public.agent_usage enable row level security;
create policy agent_usage_read on public.agent_usage for select to authenticated using (user_id = (select auth.uid()));

-- Atomically counts one message for today and says whether the user is still under the cap.
create or replace function public.agent_register_message(p_day date, p_limit integer)
returns table (allowed boolean, used integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n   integer;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  insert into public.agent_usage (user_id, day, messages) values (uid, p_day, 1)
  on conflict (user_id, day) do update set messages = public.agent_usage.messages + 1
  returning messages into n;
  return query select (n <= p_limit), n;
end;
$$;

create or replace function public.agent_add_tokens(p_day date, p_input bigint, p_output bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  update public.agent_usage
     set input_tokens = input_tokens + greatest(p_input, 0),
         output_tokens = output_tokens + greatest(p_output, 0)
   where user_id = auth.uid() and day = p_day;
end;
$$;

revoke all on function public.agent_register_message(date, integer) from public, anon;
revoke all on function public.agent_add_tokens(date, bigint, bigint) from public, anon;
grant execute on function public.agent_register_message(date, integer) to authenticated;
grant execute on function public.agent_add_tokens(date, bigint, bigint) to authenticated;
