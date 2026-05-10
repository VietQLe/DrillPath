create or replace function public.can_manage_kid_avatar(
  kid_id text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.kids
    where public.kids.id::text = kid_id
      and (
        public.kids.parent_id = auth.uid()
        or public.kids.trainee_user_id = auth.uid()
      )
  );
$$;

drop policy if exists "Parents manage kid avatars"
on storage.objects;

drop policy if exists "Trainees manage own avatar"
on storage.objects;

create policy "Manage kid avatars"
on storage.objects
for all
using (
  bucket_id = 'kid-avatars'
  and public.can_manage_kid_avatar(
    split_part(name, '/', 1)
  )
)
with check (
  bucket_id = 'kid-avatars'
  and public.can_manage_kid_avatar(
    split_part(name, '/', 1)
  )
);