create table if not exists public.rotations_shared_state (
  scope_type text not null,
  scope_key text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (scope_type, scope_key)
);

create or replace function public.rotations_shared_state_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists rotations_shared_state_set_updated_at on public.rotations_shared_state;

create trigger rotations_shared_state_set_updated_at
before update on public.rotations_shared_state
for each row
execute function public.rotations_shared_state_set_updated_at();

alter table public.rotations_shared_state enable row level security;

drop policy if exists rotations_shared_state_select_public on public.rotations_shared_state;
create policy rotations_shared_state_select_public
on public.rotations_shared_state
for select
using (true);

drop policy if exists rotations_shared_state_insert_public on public.rotations_shared_state;
create policy rotations_shared_state_insert_public
on public.rotations_shared_state
for insert
with check (true);

drop policy if exists rotations_shared_state_update_public on public.rotations_shared_state;
create policy rotations_shared_state_update_public
on public.rotations_shared_state
for update
using (true)
with check (true);

alter publication supabase_realtime add table public.rotations_shared_state;
