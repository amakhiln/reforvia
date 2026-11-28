-- Food search that understands more than one word. The first version looked for the whole phrase, so "chana dal",
-- "chicken breast" or "basmati rice" found nothing and the agent kept retrying. Now every word is looked for in the
-- English and regional names; foods matching more words come first, then whole-word matches in the English name, then
-- a food's main name ("Rice, raw, milled") over a look-alike ("Ricebean"). Replaces the function from 0020 in place.

create or replace function public.search_foods(q text, lim integer default 8)
returns setof public.foods
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with p as (
    select array(
             select regexp_replace(t, '[^a-z0-9]', '', 'g')   -- letters and digits only: no wildcards, no pattern characters
             from unnest((regexp_split_to_array(lower(btrim(q)), '\s+'))[1:5]) t
             where length(regexp_replace(t, '[^a-z0-9]', '', 'g')) >= 2
           ) as toks,
           lower(btrim(q)) as raw
  ),
  hits as (
    select f.id,
           (select count(*) from unnest(p.toks) t where (f.name || ' ' || coalesce(f.local_names, '')) ilike '%' || t || '%') as matched,
           (select count(*) from unnest(p.toks) t where f.name ~* ('\m' || t || '\M')) as word_in_name,
           (select count(*) from unnest(p.toks) t where f.name ilike '%' || t || '%') as in_name,
           exists (select 1 from unnest(p.toks) t where f.name ilike t || ',%' or lower(f.name) = t) as primary_name,
           exists (select 1 from unnest(p.toks) t where f.name ilike t || '%') as starts
    from public.foods f, p
    where cardinality(p.toks) > 0
  )
  select f.*
  from public.foods f
  join hits h on h.id = f.id, p
  where h.matched > 0
  order by h.matched desc, h.word_in_name desc, h.in_name desc, (lower(f.name) = p.raw) desc,
           h.primary_name desc, h.starts desc, length(f.name), f.name
  limit least(greatest(coalesce(lim, 8), 1), 20);
$$;
