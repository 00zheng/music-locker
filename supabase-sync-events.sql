create table if not exists public.sync_events (
  user_id uuid primary key references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.sync_events enable row level security;

grant select, insert, update on public.sync_events to authenticated;

drop policy if exists "Users can read their own sync event." on public.sync_events;
create policy "Users can read their own sync event."
on public.sync_events
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own sync event." on public.sync_events;
create policy "Users can create their own sync event."
on public.sync_events
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own sync event." on public.sync_events;
create policy "Users can update their own sync event."
on public.sync_events
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sync_events'
  ) then
    alter publication supabase_realtime add table public.sync_events;
  end if;
end $$;
