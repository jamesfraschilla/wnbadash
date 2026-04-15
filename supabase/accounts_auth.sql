create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'coach' check (role in ('admin', 'coach')),
  team_scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  feature_flags text[] not null default '{}',
  last_login_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  role text not null check (role in ('admin', 'coach')),
  team_scopes text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  legacy_local_id text,
  game_id text not null,
  period_label text,
  minutes integer,
  seconds integer,
  text text not null default '',
  tags text[] not null default '{}',
  source_meta jsonb not null default '{}'::jsonb,
  sharing_scope text not null default 'private' check (sharing_scope in ('private', 'shared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_notes
add column if not exists legacy_local_id text;

alter table public.user_notes
add column if not exists source_meta jsonb not null default '{}'::jsonb;

create table if not exists public.user_note_shares (
  note_id uuid not null references public.user_notes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  shared_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (note_id, user_id)
);

create table if not exists public.user_note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.user_notes(id) on delete cascade,
  version_number integer not null,
  snapshot jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (note_id, version_number)
);

create table if not exists public.user_drawings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  game_id text,
  title text not null default 'Untitled board',
  court_mode text not null default 'half' check (court_mode in ('half', 'full')),
  strokes jsonb not null default '[]'::jsonb,
  sharing_scope text not null default 'private' check (sharing_scope in ('private', 'shared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_tool_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'matchup_graphic',
  title text not null default 'Untitled',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.matchup_player_profiles (
  person_id text primary key,
  league text not null default 'wnba' check (league in ('nba', 'gleague', 'wnba')),
  team_id text,
  full_name text,
  height_in integer,
  archetype text,
  defender_role text,
  offensive_role text,
  prefer_offensive_roles text[] not null default '{}',
  avoid_offensive_roles text[] not null default '{}',
  prefer_opponent_ids text[] not null default '{}',
  avoid_opponent_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_drawing_shares (
  drawing_id uuid not null references public.user_drawings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  shared_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (drawing_id, user_id)
);

create table if not exists public.user_drawing_versions (
  id uuid primary key default gen_random_uuid(),
  drawing_id uuid not null references public.user_drawings(id) on delete cascade,
  version_number integer not null,
  snapshot jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (drawing_id, version_number)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_account_invites_email on public.account_invites (lower(email));
create index if not exists idx_user_notes_game_id on public.user_notes (game_id);
create index if not exists idx_user_notes_owner_id on public.user_notes (owner_id);
create unique index if not exists idx_user_notes_owner_legacy_local_id
on public.user_notes (owner_id, legacy_local_id);
create index if not exists idx_user_drawings_owner_id on public.user_drawings (owner_id);
create index if not exists idx_user_tool_records_owner_id on public.user_tool_records (owner_id);
create index if not exists idx_audit_logs_actor_id on public.audit_logs (actor_id);
create index if not exists idx_matchup_player_profiles_team_id on public.matchup_player_profiles (team_id);

drop trigger if exists set_account_invites_updated_at on public.account_invites;
create trigger set_account_invites_updated_at
before update on public.account_invites
for each row
execute function public.set_updated_at();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_user_notes_updated_at on public.user_notes;
create trigger set_user_notes_updated_at
before update on public.user_notes
for each row
execute function public.set_updated_at();

drop trigger if exists set_user_drawings_updated_at on public.user_drawings;
create trigger set_user_drawings_updated_at
before update on public.user_drawings
for each row
execute function public.set_updated_at();

drop trigger if exists set_user_tool_records_updated_at on public.user_tool_records;
create trigger set_user_tool_records_updated_at
before update on public.user_tool_records
for each row
execute function public.set_updated_at();

drop trigger if exists set_matchup_player_profiles_updated_at on public.matchup_player_profiles;
create trigger set_matchup_player_profiles_updated_at
before update on public.matchup_player_profiles
for each row
execute function public.set_updated_at();

create or replace function public.is_admin_user(target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.profiles
    where id = coalesce(target_user, auth.uid())
      and role = 'admin'
      and status = 'active'
  );
$$;

create or replace function public.can_access_note(note_row_id uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.user_notes n
    where n.id = note_row_id
      and (
        n.owner_id = coalesce(target_user, auth.uid())
        or public.is_admin_user(target_user)
        or exists (
          select 1
          from public.user_note_shares s
          where s.note_id = n.id
            and s.user_id = coalesce(target_user, auth.uid())
        )
      )
  );
$$;

create or replace function public.can_manage_note(note_row_id uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.user_notes n
    where n.id = note_row_id
      and (
        n.owner_id = coalesce(target_user, auth.uid())
        or public.is_admin_user(target_user)
      )
  );
$$;

create or replace function public.can_access_drawing(drawing_row_id uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.user_drawings d
    where d.id = drawing_row_id
      and (
        d.owner_id = coalesce(target_user, auth.uid())
        or public.is_admin_user(target_user)
        or exists (
          select 1
          from public.user_drawing_shares s
          where s.drawing_id = d.id
            and s.user_id = coalesce(target_user, auth.uid())
        )
      )
  );
$$;

create or replace function public.can_manage_drawing(drawing_row_id uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.user_drawings d
    where d.id = drawing_row_id
      and (
        d.owner_id = coalesce(target_user, auth.uid())
        or public.is_admin_user(target_user)
      )
  );
$$;

create or replace function public.can_access_tool_record(tool_row_id uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.user_tool_records t
    where t.id = tool_row_id
      and (
        t.owner_id = coalesce(target_user, auth.uid())
        or public.is_admin_user(target_user)
      )
  );
$$;

create or replace function public.handle_new_account_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row public.account_invites;
begin
  select *
  into invite_row
  from public.account_invites
  where lower(email) = lower(new.email)
    and status = 'pending'
  order by created_at desc
  limit 1;

  if invite_row.id is null then
    raise exception 'No pending invite exists for %', new.email;
  end if;

  insert into public.profiles (
    id,
    email,
    display_name,
    role,
    team_scopes,
    status
  ) values (
    new.id,
    lower(new.email),
    coalesce(invite_row.display_name, new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    invite_row.role,
    coalesce(invite_row.team_scopes, '{}'),
    'active'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name,
    role = excluded.role,
    team_scopes = excluded.team_scopes,
    status = 'active';

  update public.account_invites
  set
    status = 'accepted',
    accepted_by = new.id,
    updated_at = now()
  where id = invite_row.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_account_user();

alter table public.account_invites enable row level security;
alter table public.profiles enable row level security;
alter table public.user_notes enable row level security;
alter table public.user_note_shares enable row level security;
alter table public.user_note_versions enable row level security;
alter table public.user_drawings enable row level security;
alter table public.user_tool_records enable row level security;
alter table public.user_drawing_shares enable row level security;
alter table public.user_drawing_versions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.matchup_player_profiles enable row level security;

drop policy if exists "admins manage invites" on public.account_invites;
create policy "admins manage invites"
on public.account_invites
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists "users read active profiles" on public.profiles;
create policy "users read active profiles"
on public.profiles
for select
to authenticated
using (
  auth.uid() = id
  or status = 'active'
  or public.is_admin_user()
);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id or public.is_admin_user())
with check (auth.uid() = id or public.is_admin_user());

drop policy if exists "authenticated insert own profile" on public.profiles;
create policy "authenticated insert own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id or public.is_admin_user());

drop policy if exists "notes visible to owner shared admin" on public.user_notes;
create policy "notes visible to owner shared admin"
on public.user_notes
for select
to authenticated
using (public.can_access_note(id));

drop policy if exists "notes insert own rows" on public.user_notes;
create policy "notes insert own rows"
on public.user_notes
for insert
to authenticated
with check (owner_id = auth.uid() or public.is_admin_user());

drop policy if exists "notes update owner shared admin" on public.user_notes;
create policy "notes update owner shared admin"
on public.user_notes
for update
to authenticated
using (public.can_access_note(id))
with check (public.can_access_note(id));

drop policy if exists "notes delete owner admin" on public.user_notes;
create policy "notes delete owner admin"
on public.user_notes
for delete
to authenticated
using (owner_id = auth.uid() or public.is_admin_user());

drop policy if exists "note shares visible to related users" on public.user_note_shares;
create policy "note shares visible to related users"
on public.user_note_shares
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_admin_user()
  or public.can_manage_note(note_id)
);

drop policy if exists "note shares owner admin manage" on public.user_note_shares;
create policy "note shares owner admin manage"
on public.user_note_shares
for all
to authenticated
using (
  public.is_admin_user()
  or public.can_manage_note(note_id)
)
with check (
  public.is_admin_user()
  or public.can_manage_note(note_id)
);

drop policy if exists "note versions visible to related users" on public.user_note_versions;
create policy "note versions visible to related users"
on public.user_note_versions
for select
to authenticated
using (
  public.is_admin_user()
  or public.can_access_note(note_id)
);

drop policy if exists "note versions insert actor" on public.user_note_versions;
create policy "note versions insert actor"
on public.user_note_versions
for insert
to authenticated
with check (created_by = auth.uid() or public.is_admin_user());

drop policy if exists "drawings visible to owner shared admin" on public.user_drawings;
create policy "drawings visible to owner shared admin"
on public.user_drawings
for select
to authenticated
using (public.can_access_drawing(id));

drop policy if exists "drawings insert own rows" on public.user_drawings;
create policy "drawings insert own rows"
on public.user_drawings
for insert
to authenticated
with check (owner_id = auth.uid() or public.is_admin_user());

drop policy if exists "drawings update owner shared admin" on public.user_drawings;
create policy "drawings update owner shared admin"
on public.user_drawings
for update
to authenticated
using (public.can_access_drawing(id))
with check (public.can_access_drawing(id));

drop policy if exists "drawings delete owner admin" on public.user_drawings;
create policy "drawings delete owner admin"
on public.user_drawings
for delete
to authenticated
using (owner_id = auth.uid() or public.is_admin_user());

drop policy if exists "tool records visible to owner admin" on public.user_tool_records;
create policy "tool records visible to owner admin"
on public.user_tool_records
for select
to authenticated
using (public.can_access_tool_record(id));

drop policy if exists "tool records insert own rows" on public.user_tool_records;
create policy "tool records insert own rows"
on public.user_tool_records
for insert
to authenticated
with check (owner_id = auth.uid() or public.is_admin_user());

drop policy if exists "tool records update owner admin" on public.user_tool_records;
create policy "tool records update owner admin"
on public.user_tool_records
for update
to authenticated
using (public.can_access_tool_record(id))
with check (public.can_access_tool_record(id));

drop policy if exists "tool records delete owner admin" on public.user_tool_records;
create policy "tool records delete owner admin"
on public.user_tool_records
for delete
to authenticated
using (owner_id = auth.uid() or public.is_admin_user());

drop policy if exists "matchup profiles read authenticated" on public.matchup_player_profiles;
create policy "matchup profiles read authenticated"
on public.matchup_player_profiles
for select
to authenticated
using (true);

drop policy if exists "matchup profiles insert admin" on public.matchup_player_profiles;
create policy "matchup profiles insert admin"
on public.matchup_player_profiles
for insert
to authenticated
with check (public.is_admin_user());

drop policy if exists "matchup profiles update admin" on public.matchup_player_profiles;
create policy "matchup profiles update admin"
on public.matchup_player_profiles
for update
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists "matchup profiles delete admin" on public.matchup_player_profiles;
create policy "matchup profiles delete admin"
on public.matchup_player_profiles
for delete
to authenticated
using (public.is_admin_user());

drop policy if exists "drawing shares visible to related users" on public.user_drawing_shares;
create policy "drawing shares visible to related users"
on public.user_drawing_shares
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_admin_user()
  or public.can_manage_drawing(drawing_id)
);

drop policy if exists "drawing shares owner admin manage" on public.user_drawing_shares;
create policy "drawing shares owner admin manage"
on public.user_drawing_shares
for all
to authenticated
using (
  public.is_admin_user()
  or public.can_manage_drawing(drawing_id)
)
with check (
  public.is_admin_user()
  or public.can_manage_drawing(drawing_id)
);

drop policy if exists "drawing versions visible to related users" on public.user_drawing_versions;
create policy "drawing versions visible to related users"
on public.user_drawing_versions
for select
to authenticated
using (
  public.is_admin_user()
  or public.can_access_drawing(drawing_id)
);

drop policy if exists "drawing versions insert actor" on public.user_drawing_versions;
create policy "drawing versions insert actor"
on public.user_drawing_versions
for insert
to authenticated
with check (created_by = auth.uid() or public.is_admin_user());

drop policy if exists "audit logs visible to admins" on public.audit_logs;
create policy "audit logs visible to admins"
on public.audit_logs
for select
to authenticated
using (public.is_admin_user());

drop policy if exists "audit logs insert authenticated" on public.audit_logs;
create policy "audit logs insert authenticated"
on public.audit_logs
for insert
to authenticated
with check (actor_id = auth.uid() or public.is_admin_user());
