-- Give the original (curated) exercises demos by linking them to the closest wger exercise's media.
-- The same files are reused (no copies), each keeping its own licence and author. The matches below are
-- hand-picked by name: a few are a close variant (for example Lat pulldown uses a close-grip demo).

insert into public.exercise_media (exercise_id, kind, storage_path, license, author, source_url, is_main, sort_order)
select c.id, m.kind, m.storage_path, m.license, m.author, m.source_url, m.is_main, m.sort_order
from (values
  ('Cable lateral raise',              '81942f3d-d92c-431c-b9d0-0da12918d1e4'),  -- Cable Lateral Raises (Single Arm)
  ('Cable or machine lateral raise',   '3d2adf99-8fe9-45cb-b669-c5b18242e282'),  -- Machine Lateral Raise
  ('Chest-supported row',              '51a2d520-b510-4b6e-bd65-9fc40365e8de'),  -- Incline Chest-Supported Dumbbell Row
  ('Hammer curl',                      'c0d9fe98-f4fe-49f3-8037-05e1984e7d2d'),  -- Hammer Curls
  ('Incline dumbbell curl',            '43e85cb8-51d0-4892-b1bf-80a3cb111ff6'),  -- Dumbbell Incline Curl
  ('Incline dumbbell press',           '57e17672-52b9-43cf-8d0d-4b3f06a0c0d0'),  -- Incline Bench Press - Dumbbell
  ('Lat pulldown',                     '63fbb8e5-6ebc-4def-8844-3e65e097213b'),  -- Close-grip Lat Pull Down (variant)
  ('Leg press (or squat)',             '66a42396-c207-44da-bc75-758a89d32404'),  -- Leg Press
  ('Machine chest press',              '5c414175-fe72-455a-ba8f-a0575cf792bd'),  -- Chest Press
  ('Overhead cable triceps extension', 'c5797bdf-1aa1-4d51-9775-c929ec5a2aaf'),  -- Overhead Triceps Extension
  ('Romanian deadlift',                '65d12ecf-54b8-466d-a412-e55c396cad69'),  -- Dumbbell Romanian Deadlift (variant)
  ('Rope triceps pushdown',            'fc608f0e-d754-4911-ae59-8856952e7064'),  -- Tricep Rope Pushdowns
  ('Seated cable row (neutral grip)',  '0ecfec6f-5d0f-4e8a-8d37-f6203a8923b8'),  -- Seated Cable Row
  ('Seated leg curl',                  '440a5184-de58-4a86-a7ba-76ddeafaa855'),  -- Leg Curls (sitting)
  ('Seated shoulder press',            '87affa4b-395b-437c-9581-2bd20ea5aa7c'),  -- Shoulder Press, Dumbbells
  ('Standing calf raise',              '7ce443b6-eb84-4f65-b05f-461c1cc8bcc0'),  -- Standing Calf Raises
  ('Straight-arm cable pulldown',      'a45123c6-34c2-43cf-b6bf-914a8f40995a')   -- Straight-Arm Pulldown (Cable)
) as map(curated_name, wger_id)
join public.exercises c on c.name = map.curated_name and c.owner_id is null and c.source <> 'wger'
join public.exercise_media m on m.exercise_id = map.wger_id::uuid
on conflict (exercise_id, storage_path) do nothing;
