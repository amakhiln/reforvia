-- The Nutrition agent: the user's own profile (entered on a screen, never inferred from chat) and a separate chat
-- history per agent. The profile feeds a deterministic targets calculator; the agent explains the numbers, it does not make them.

create table public.nutrition_profile (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  birth_year       smallint not null check (birth_year between 1930 and 2100),
  sex              text not null check (sex in ('female', 'male')),            -- only used by the energy equation
  height_cm        numeric(4,1) not null check (height_cm between 120 and 230),
  weight_kg        numeric(4,1) not null check (weight_kg between 30 and 250),
  goal             text not null check (goal in ('lose', 'maintain', 'gain')),
  diet             text not null default 'any' check (diet in ('any', 'vegetarian', 'eggetarian', 'vegan')),
  see_professional boolean not null default false,                             -- pregnancy, breastfeeding, a condition affecting diet, or a history of disordered eating: no targets from the app
  updated_at       timestamptz not null default now()
);

alter table public.nutrition_profile enable row level security;
create policy nutrition_profile_read on public.nutrition_profile for select to authenticated using (user_id = (select auth.uid()));
-- Adults only: a profile for anyone under 18 cannot be saved.
create policy nutrition_profile_create on public.nutrition_profile for insert to authenticated
  with check (user_id = (select auth.uid()) and birth_year <= extract(year from now())::int - 18);
create policy nutrition_profile_edit on public.nutrition_profile for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and birth_year <= extract(year from now())::int - 18);
create policy nutrition_profile_delete on public.nutrition_profile for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.nutrition_profile from anon;

-- One chat history per agent. Existing rows are the Coach's.
alter table public.coach_messages add column agent text not null default 'coach' check (agent in ('coach', 'nutrition'));
create index coach_messages_agent_idx on public.coach_messages (user_id, agent, created_at desc);
