create extension if not exists "pgcrypto";

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.columns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  position integer not null default 1,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  column_id uuid not null references public.columns(id) on delete cascade,
  title text not null,
  description text,
  position integer not null default 1,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.pomodoro_settings (
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  work_minutes integer not null default 25,
  short_break_minutes integer not null default 5,
  long_break_minutes integer not null default 15,
  long_break_every integer not null default 4,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (project_id, owner_id)
);

create index if not exists columns_project_position_idx on public.columns (project_id, position);
create index if not exists tasks_project_column_position_idx on public.tasks (project_id, column_id, position);

alter table public.projects enable row level security;
alter table public.columns enable row level security;
alter table public.tasks enable row level security;
alter table public.pomodoro_settings enable row level security;

create policy if not exists "projects_owner_read" on public.projects
  for select using (auth.uid() = owner_id);

create policy if not exists "projects_owner_write" on public.projects
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy if not exists "columns_owner_access" on public.columns
  for all
  using (
    exists (
      select 1
      from public.projects p
      where p.id = columns.project_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = columns.project_id
        and p.owner_id = auth.uid()
    )
  );

create policy if not exists "tasks_owner_access" on public.tasks
  for all
  using (
    exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id
        and p.owner_id = auth.uid()
    )
  );

create policy if not exists "pomodoro_owner_access" on public.pomodoro_settings
  for all
  using (
    auth.uid() = owner_id
    and exists (
      select 1
      from public.projects p
      where p.id = pomodoro_settings.project_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    auth.uid() = owner_id
    and exists (
      select 1
      from public.projects p
      where p.id = pomodoro_settings.project_id
        and p.owner_id = auth.uid()
    )
  );

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_pomodoro_updated_at on public.pomodoro_settings;
create trigger set_pomodoro_updated_at
  before update on public.pomodoro_settings
  for each row
  execute function public.set_updated_at();

-- Guard rails
create policy if not exists "projects_insert_owner_guard" on public.projects
  for insert with check (auth.uid() = owner_id);
