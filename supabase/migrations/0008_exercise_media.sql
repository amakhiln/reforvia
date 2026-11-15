-- Images and videos for library exercises, stored in Supabase Storage (bucket: exercise-media).
-- Each file keeps its own licence, author and source link. Rows are written by the import
-- (scripts/import_wger.py), not by users, so there are no insert/update/delete policies.

create table public.exercise_media (
  id           uuid primary key default gen_random_uuid(),
  exercise_id  uuid not null references public.exercises(id) on delete cascade,
  kind         text not null check (kind in ('image', 'video')),
  storage_path text not null,                 -- path inside the exercise-media bucket
  license      text,
  author       text,
  source_url   text,
  is_main      boolean not null default false,
  sort_order   smallint not null default 0,
  created_at   timestamptz not null default now(),
  unique (exercise_id, storage_path)
);
create index exercise_media_exercise_idx on public.exercise_media (exercise_id, sort_order);

alter table public.exercise_media enable row level security;

-- Visible to anyone signed in who can see the exercise (shared rows, or their own).
create policy exercise_media_read on public.exercise_media for select to authenticated
  using (exists (
    select 1 from public.exercises e
    where e.id = exercise_id and (e.owner_id is null or e.owner_id = (select auth.uid()))
  ));

-- Public bucket: the files are openly licensed and shown with <img>/<video>, so reads need no token.
-- Uploads happen only with the secret key (service role), which bypasses storage policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-media', 'exercise-media', true, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
on conflict (id) do nothing;
