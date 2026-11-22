-- Food composition reference data for the Nutrition agent. Shared by every user and read-only for them: rows are loaded
-- by a migration (see scripts/import_ifct.py), never written by the app or an agent. Values are per 100 g of the food as
-- listed (raw ingredients, not cooked dishes). Provenance is kept on every row, as for the wger exercise library.

create extension if not exists pg_trgm with schema extensions;

create table public.foods (
  id              uuid primary key default gen_random_uuid(),
  source          text not null,                         -- e.g. 'ifct2017'
  code            text not null,                         -- the source's own food code, e.g. 'A019'
  name            text not null,
  scientific_name text,
  local_names     text,                                  -- regional names, so "atta" or "bajra" can be found
  food_group      text not null,
  tags            text[] not null default '{}',          -- the source's dietary tags, e.g. vegetarian
  basis           text not null default 'per 100 g edible portion',
  energy_kcal     numeric(7,1) not null check (energy_kcal >= 0),
  energy_derived  boolean not null default false,        -- true when the source gave no energy and it was worked out from the macros
  protein_g       numeric(6,2) not null check (protein_g >= 0),
  fat_g           numeric(6,2) not null check (fat_g >= 0),
  carbs_g         numeric(6,2) not null check (carbs_g >= 0),   -- available carbohydrate
  fibre_g         numeric(6,2) not null check (fibre_g >= 0),
  water_g         numeric(6,2) not null check (water_g >= 0),
  sugars_g        numeric(6,2) not null check (sugars_g >= 0),
  sat_fat_g       numeric(6,2) not null check (sat_fat_g >= 0),
  cholesterol_mg  numeric(8,2) not null check (cholesterol_mg >= 0),
  calcium_mg      numeric(8,2) not null check (calcium_mg >= 0),
  iron_mg         numeric(8,2) not null check (iron_mg >= 0),
  magnesium_mg    numeric(8,2) not null check (magnesium_mg >= 0),
  phosphorus_mg   numeric(8,2) not null check (phosphorus_mg >= 0),
  potassium_mg    numeric(8,2) not null check (potassium_mg >= 0),
  sodium_mg       numeric(8,2) not null check (sodium_mg >= 0),
  zinc_mg         numeric(8,2) not null check (zinc_mg >= 0),
  vitamin_c_mg    numeric(8,2) not null check (vitamin_c_mg >= 0),
  source_note     text not null,                         -- who measured it and how it reached us
  unique (source, code)
);

create index foods_search_idx on public.foods
  using gin ((name || ' ' || coalesce(local_names, '')) extensions.gin_trgm_ops);

alter table public.foods enable row level security;
create policy foods_read on public.foods for select to authenticated using (true);  -- reference data: everyone signed in may read, nobody may write
revoke all on public.foods from anon;
revoke insert, update, delete on public.foods from authenticated;

-- Matches a name, a regional name or a scientific name; exact and prefix matches first.
create or replace function public.search_foods(q text, lim integer default 8)
returns setof public.foods
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with p as (select replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') as pat, lower(btrim(q)) as raw)
  select f.*
  from public.foods f, p
  where length(p.raw) >= 2
    and (f.name || ' ' || coalesce(f.local_names, '')) ilike '%' || p.pat || '%'
  order by (lower(f.name) = p.raw) desc,
           (f.name ilike p.pat || '%') desc,
           (f.name ilike '%' || p.pat || '%') desc,
           length(f.name),
           f.name
  limit least(greatest(coalesce(lim, 8), 1), 20);
$$;

revoke all on function public.search_foods(text, integer) from public, anon;
grant execute on function public.search_foods(text, integer) to authenticated;
