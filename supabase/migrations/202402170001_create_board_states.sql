create table if not exists public.board_states (
  profile_id text primary key,
  state jsonb not null default '{}'::jsonb
);

alter table public.board_states enable row level security;

drop policy if exists "board_states_owner_select" on public.board_states;
create policy "board_states_owner_select"
  on public.board_states
  for select
  using (auth.uid() is not null and profile_id = auth.uid());

drop policy if exists "board_states_owner_write" on public.board_states;
create policy "board_states_owner_write"
  on public.board_states
  for all
  using (auth.uid() is not null and profile_id = auth.uid())
  with check (auth.uid() is not null and profile_id = auth.uid());
