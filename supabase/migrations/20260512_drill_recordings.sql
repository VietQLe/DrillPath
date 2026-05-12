-- Drill recordings: users record themselves performing drills during workouts

-- Private storage bucket for drill recordings
insert into storage.buckets (id, name, public)
values ('drill-recordings', 'drill-recordings', false)
on conflict (id) do nothing;

-- Helper: check if the current user owns or is the trainee for a given kid_id
create or replace function public.can_manage_drill_recording(kid_id_from_path text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.kids
    where public.kids.id::text = kid_id_from_path
      and (
        public.kids.parent_id = auth.uid()
        or public.kids.trainee_user_id = auth.uid()
      )
  );
$$;

-- Storage policy: only the owning parent/trainee can read, write, delete
create policy "Manage drill recordings storage"
  on storage.objects for all
  using (
    bucket_id = 'drill-recordings'
    and public.can_manage_drill_recording(split_part(name, '/', 1))
  )
  with check (
    bucket_id = 'drill-recordings'
    and public.can_manage_drill_recording(split_part(name, '/', 1))
  );

-- Table: one row per saved recording clip
create table if not exists drill_recordings (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid references kids(id) on delete cascade not null,
  drill_id uuid references drills(id) on delete cascade not null,
  plan_id uuid references training_plans(id) on delete set null,
  video_url text not null,  -- storage path: {kid_id}/{drill_id}/{uuid}.webm|mp4
  recorded_at timestamptz default now()
);

alter table drill_recordings enable row level security;

create policy "Parents manage drill recordings for their kids"
  on drill_recordings for all
  using (kid_id in (select id from kids where parent_id = auth.uid()))
  with check (kid_id in (select id from kids where parent_id = auth.uid()));

create policy "Trainees manage their drill recordings"
  on drill_recordings for all
  using (kid_id in (select id from kids where trainee_user_id = auth.uid()))
  with check (kid_id in (select id from kids where trainee_user_id = auth.uid()));
