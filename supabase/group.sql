-- Tabelas e funções usadas pela aba Grupo (js/group.js).
-- Rode este script no SQL Editor do projeto Supabase (não pode ser criado
-- pelo app, que só tem a publishable/anon key).
--
-- Modelo: um "grupo" é a casa/república. Cada pessoa entra digitando o
-- código de convite do grupo. Dentro do grupo, qualquer membro cria
-- tarefas compartilhadas (ex.: "dar comida pro cachorro") e marca/desmarca
-- o dia como feito — todo mundo vê quem marcou.

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_tasks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.group_task_log (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  task_id uuid not null references public.group_tasks(id) on delete cascade,
  log_date date not null,
  done boolean not null default false,
  done_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (task_id, log_date)
);

create index if not exists group_task_log_group_date_idx
  on public.group_task_log (group_id, log_date);

-- ---------- helper: checa se o usuário logado é membro do grupo ----------
-- security definer para não recursar na policy de group_members.
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid()
  );
$$;

grant execute on function public.is_group_member(uuid) to authenticated;

-- ---------- criar grupo (cria o grupo + já entra como membro) ----------
create or replace function public.create_group(p_name text, p_display_name text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups;
  code text;
begin
  code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into public.groups (name, invite_code, owner_id)
  values (p_name, code, auth.uid())
  returning * into g;

  insert into public.group_members (group_id, user_id, display_name)
  values (g.id, auth.uid(), p_display_name);

  return g;
end;
$$;

grant execute on function public.create_group(text, text) to authenticated;

-- ---------- entrar em um grupo existente via código de convite ----------
create or replace function public.join_group_by_code(p_code text, p_display_name text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups;
begin
  select * into g from public.groups where invite_code = upper(p_code);
  if g.id is null then
    raise exception 'Código de convite inválido';
  end if;

  insert into public.group_members (group_id, user_id, display_name)
  values (g.id, auth.uid(), p_display_name)
  on conflict (group_id, user_id) do update set display_name = excluded.display_name;

  return g;
end;
$$;

grant execute on function public.join_group_by_code(text, text) to authenticated;

-- ---------- RLS ----------
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_tasks enable row level security;
alter table public.group_task_log enable row level security;

create policy "groups_select_member"
  on public.groups for select
  using (public.is_group_member(id));

create policy "groups_insert_own"
  on public.groups for insert
  with check (auth.uid() = owner_id);

create policy "groups_update_owner"
  on public.groups for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "group_members_select_member"
  on public.group_members for select
  using (public.is_group_member(group_id));

create policy "group_members_insert_self"
  on public.group_members for insert
  with check (auth.uid() = user_id);

create policy "group_members_delete_self_or_owner"
  on public.group_members for delete
  using (
    auth.uid() = user_id
    or exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid())
  );

create policy "group_tasks_select_member"
  on public.group_tasks for select
  using (public.is_group_member(group_id));

create policy "group_tasks_insert_member"
  on public.group_tasks for insert
  with check (public.is_group_member(group_id));

create policy "group_tasks_update_member"
  on public.group_tasks for update
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

create policy "group_tasks_delete_member"
  on public.group_tasks for delete
  using (public.is_group_member(group_id));

create policy "group_task_log_select_member"
  on public.group_task_log for select
  using (public.is_group_member(group_id));

create policy "group_task_log_insert_member"
  on public.group_task_log for insert
  with check (public.is_group_member(group_id));

create policy "group_task_log_update_member"
  on public.group_task_log for update
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));
