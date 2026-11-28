-- Food search that returns the right food for everyday names. 0023 could put a wrong food first: "toor dal" gave lentil
-- (the tables spell it Tuvar or Arhar), "kheer" gave cucumber (inside "Kheera"), "egg" gave fish eggs, and "tel"
-- matched every food with a Telugu name because the language labels sit inside local_names.
--  * common spellings are mapped to the tables' English names
--  * regional names are matched on whole words only (the English name also allows part of a word, from four letters)
--  * language labels ("H.", "Tel.") are ignored
--  * foods the tables do not hold (butter, sugar) return nothing instead of a look-alike
--  * a bare "egg" or "rice" prefers hen's egg and milled rice
-- Replaces the function from 0023 in place.

create or replace function public.search_foods(q text, lim integer default 8)
returns setof public.foods
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with aliases(term, means) as (values
    ('toor', 'red gram'), ('tur', 'red gram'), ('thoor', 'red gram'), ('tuvar', 'red gram'), ('arhar', 'red gram'),
    ('moong', 'green gram'), ('mung', 'green gram'), ('urad', 'black gram'), ('udad', 'black gram'), ('chole', 'bengal gram'),
    ('daliya', 'dalia'), ('sooji', 'semolina'), ('suji', 'semolina'), ('murmura', 'rice puffed'),
    ('moongfali', 'ground nut'), ('groundnut', 'ground nut'), ('peanut', 'ground nut'),
    ('anda', 'egg'), ('murgh', 'chicken'), ('murg', 'chicken'), ('gosht', 'goat'), ('mutton', 'goat'), ('machli', 'fish'), ('jhinga', 'prawn'),
    ('aloo', 'potato'), ('kela', 'banana'), ('aam', 'mango'), ('haldi', 'turmeric'), ('gobhi', 'cauliflower'), ('kaddu', 'pumpkin'),
    ('mirch', 'chillies'), ('lauki', 'bottle gourd'), ('lahsun', 'garlic'), ('laung', 'cloves'), ('nimbu', 'lemon'),
    ('tarbooz', 'water melon'), ('tel', 'oil')
  ),
  absent(term) as (values ('butter'), ('makhan'), ('sugar'), ('cheeni')),   -- not in the tables: a match would be another food
  preferred(term, code) as (values
    ('egg', 'M001'), ('egg', 'M004'), ('anda', 'M001'), ('anda', 'M004'), ('rice', 'A015'), ('chawal', 'A015')   -- hen's egg raw and boiled
  ),
  words as (
    select regexp_replace(t, '[^a-z0-9]', '', 'g') as w          -- letters and digits only: no wildcards, no pattern characters
    from unnest((regexp_split_to_array(lower(btrim(q)), '\s+'))[1:5]) t
  ),
  toks as (
    select distinct case
             when w ~ 'oes$' then left(w, -2)                     -- tomatoes -> tomato
             when length(w) > 3 and w ~ '[^s]s$' then left(w, -1) -- eggs -> egg
             else w
           end as tok
    from words
    where length(w) >= 2 and w not in (select term from absent)
  ),
  alts as (
    select tok, tok as alt from toks
    union
    select t.tok, a.means from toks t join aliases a on a.term = t.tok
  ),
  hay as (
    select f.id, f.code, f.name,
           f.name || ' ' || regexp_replace(coalesce(f.local_names, ''), '\m(Kan|Kash|Kh|Kon|Mal|Mar|Tam|Tel|A|B|E|G|H|M|N|O|P|S|U)\.', ' ', 'g') as text
    from public.foods f
  ),
  per_token as (
    select h.id, a.tok,
           bool_or(h.text ~* ('\m' || a.alt || '(s|es)?\M') or (length(a.tok) >= 4 and h.name ilike '%' || a.tok || '%')) as matched,
           bool_or(h.name ~* ('\m' || a.alt || '(s|es)?\M')) as word_in_name,
           bool_or(h.name ~* ('^' || a.alt || '(,|$)')) as primary_name,
           bool_or(h.name ilike a.tok || '%') as starts
    from hay h cross join alts a
    group by h.id, a.tok
  ),
  hits as (
    select h.id, h.name,
           count(*) filter (where t.matched) as matched,
           count(*) filter (where t.word_in_name) as word_in_name,
           bool_or(exists (select 1 from preferred p where p.term = t.tok and p.code = h.code)) as preferred,
           bool_or(t.primary_name) as primary_name,
           bool_or(t.starts) as starts
    from hay h join per_token t on t.id = h.id
    group by h.id, h.name
  )
  select f.*
  from public.foods f
  join hits h on h.id = f.id
  where h.matched > 0
  order by h.matched desc, h.word_in_name desc, h.preferred desc, (lower(f.name) = lower(btrim(q))) desc,
           h.primary_name desc, h.starts desc, length(f.name), f.name
  limit least(greatest(coalesce(lim, 8), 1), 20);
$$;
