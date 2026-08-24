-- Tabelas e funções usadas pela aba Grupo (js/group.js).
-- Rode este script inteiro no SQL Editor do projeto Supabase sempre que ele
-- mudar (não pode ser criado pelo app, que só tem a publishable/anon key).
-- O script inteiro é seguro para rodar de novo em cima de um banco que já
-- tem os dados da v1 — ele só adiciona colunas/funções/policies, nunca
-- apaga dados.
--
-- Modelo: uma pessoa pode participar de vários grupos (a casa, a
-- república, etc). Dentro de um grupo existe hierarquia (dono > admin >
-- membro) e o grupo pode ser aberto (qualquer um com o código entra na
-- hora) ou fechado (precisa ser aprovado por um dono/admin). Tarefas
-- compartilhadas podem ser diárias, várias vezes ao dia, ou semanais.

/* ============================================================
   TABELAS
   ============================================================ */

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.groups add column if not exists is_open boolean not null default true;

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_members add column if not exists role text not null default 'member';
alter table public.group_members add column if not exists status text not null default 'active';

do $$ begin
  alter table public.group_members
    add constraint group_members_role_check check (role in ('owner','admin','member'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.group_members
    add constraint group_members_status_check check (status in ('active','pending'));
exception when duplicate_object then null; end $$;

-- garante que o dono de cada grupo já existente tenha o papel 'owner'
update public.group_members gm
set role = 'owner'
from public.groups g
where g.id = gm.group_id and g.owner_id = gm.user_id;

create table if not exists public.group_tasks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.group_tasks add column if not exists freq_type text not null default 'daily';
alter table public.group_tasks add column if not exists freq_count int not null default 1;

do $$ begin
  alter table public.group_tasks
    add constraint group_tasks_freq_type_check check (freq_type in ('daily','multi_daily','weekly'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.group_tasks
    add constraint group_tasks_freq_count_check check (freq_count >= 1);
exception when duplicate_object then null; end $$;

create table if not exists public.group_task_log (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  task_id uuid not null references public.group_tasks(id) on delete cascade,
  log_date date not null,   -- dia (diária/várias-ao-dia) ou segunda-feira da semana (semanal)
  done boolean not null default false,  -- mantido por compatibilidade; a fonte de verdade é "count"
  count int not null default 0,
  done_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (task_id, log_date)
);
alter table public.group_task_log add column if not exists count int not null default 0;
update public.group_task_log set count = 1 where done = true and count = 0;

create index if not exists group_task_log_group_date_idx
  on public.group_task_log (group_id, log_date);

/* ============================================================
   FUNÇÕES AUXILIARES (security definer para driblar a recursão
   de RLS em group_members e permitir ações administrativas)
   ============================================================ */

create or replace function public.is_group_member(gid uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid() and m.status = 'active'
  );
$$;
grant execute on function public.is_group_member(uuid) to authenticated;

create or replace function public.is_group_admin(gid uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin')
  );
$$;
grant execute on function public.is_group_admin(uuid) to authenticated;

create or replace function public.is_group_owner(gid uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid() and m.status = 'active' and m.role = 'owner'
  );
$$;
grant execute on function public.is_group_owner(uuid) to authenticated;

-- qualquer vínculo (mesmo pendente) já é suficiente pra ver o nome do grupo
create or replace function public.has_group_membership(gid uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid()
  );
$$;
grant execute on function public.has_group_membership(uuid) to authenticated;

/* ============================================================
   RPCs
   ============================================================ */

-- criar grupo (cria o grupo + já entra como dono)
drop function if exists public.create_group(text, text);
create or replace function public.create_group(p_name text, p_display_name text, p_is_open boolean)
returns public.groups
language plpgsql security definer set search_path = public
as $$
declare
  g public.groups;
  code text;
begin
  code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into public.groups (name, invite_code, owner_id, is_open)
  values (p_name, code, auth.uid(), p_is_open)
  returning * into g;

  insert into public.group_members (group_id, user_id, display_name, role, status)
  values (g.id, auth.uid(), p_display_name, 'owner', 'active');

  return g;
end;
$$;
grant execute on function public.create_group(text, text, boolean) to authenticated;

-- entrar em um grupo via código de convite: entra direto se o grupo é
-- aberto, ou fica pendente aguardando aprovação se o grupo é fechado.
drop function if exists public.join_group_by_code(text, text);
create or replace function public.join_group_by_code(p_code text, p_display_name text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  g public.groups;
  existing record;
  new_status text;
begin
  select * into g from public.groups where invite_code = upper(p_code);
  if g.id is null then
    raise exception 'Código de convite inválido';
  end if;

  select * into existing from public.group_members where group_id = g.id and user_id = auth.uid();

  if existing.user_id is not null then
    update public.group_members set display_name = p_display_name
      where group_id = g.id and user_id = auth.uid();
    new_status := existing.status;
  else
    new_status := case when g.is_open then 'active' else 'pending' end;
    insert into public.group_members (group_id, user_id, display_name, role, status)
    values (g.id, auth.uid(), p_display_name, 'member', new_status);
  end if;

  return jsonb_build_object('group', to_jsonb(g), 'status', new_status);
end;
$$;
grant execute on function public.join_group_by_code(text, text) to authenticated;

-- aceitar/recusar um pedido de entrada (só dono/admin)
create or replace function public.respond_join_request(p_group_id uuid, p_user_id uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'Sem permissão para gerenciar este grupo';
  end if;
  if p_approve then
    update public.group_members set status = 'active'
      where group_id = p_group_id and user_id = p_user_id and status = 'pending';
  else
    delete from public.group_members
      where group_id = p_group_id and user_id = p_user_id and status = 'pending';
  end if;
end;
$$;
grant execute on function public.respond_join_request(uuid, uuid, boolean) to authenticated;

-- promover/rebaixar um membro (só o dono, e nunca o próprio dono)
create or replace function public.set_member_role(p_group_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  target_role text;
begin
  if not public.is_group_owner(p_group_id) then
    raise exception 'Só o dono do grupo pode alterar papéis';
  end if;
  if p_role not in ('admin','member') then
    raise exception 'Papel inválido';
  end if;
  select role into target_role from public.group_members where group_id = p_group_id and user_id = p_user_id;
  if target_role is null then
    raise exception 'Membro não encontrado';
  end if;
  if target_role = 'owner' then
    raise exception 'Não é possível alterar o papel do dono';
  end if;
  update public.group_members set role = p_role
    where group_id = p_group_id and user_id = p_user_id and status = 'active';
end;
$$;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;

-- sair do grupo (ou cancelar um pedido pendente). Se quem sai é o dono,
-- a propriedade passa para o admin (ou membro) mais antigo; se ninguém
-- mais restar ativo, o grupo inteiro é apagado (evita grupo "fantasma").
create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  my_role text;
  successor uuid;
begin
  select role into my_role from public.group_members where group_id = p_group_id and user_id = auth.uid();
  if my_role is null then
    return;
  end if;

  delete from public.group_members where group_id = p_group_id and user_id = auth.uid();

  if my_role = 'owner' then
    select user_id into successor from public.group_members
      where group_id = p_group_id and status = 'active'
      order by (role = 'admin') desc, joined_at asc
      limit 1;
    if successor is not null then
      update public.group_members set role = 'owner' where group_id = p_group_id and user_id = successor;
      update public.groups set owner_id = successor where id = p_group_id;
    else
      delete from public.groups where id = p_group_id;
      return;
    end if;
  end if;

  if not exists (select 1 from public.group_members where group_id = p_group_id and status = 'active') then
    delete from public.groups where id = p_group_id;
  end if;
end;
$$;
grant execute on function public.leave_group(uuid) to authenticated;

/* ============================================================
   RLS
   ============================================================ */

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_tasks enable row level security;
alter table public.group_task_log enable row level security;

drop policy if exists "groups_select_member" on public.groups;
create policy "groups_select_member"
  on public.groups for select
  using (public.has_group_membership(id));

drop policy if exists "groups_insert_own" on public.groups;
create policy "groups_insert_own"
  on public.groups for insert
  with check (auth.uid() = owner_id);

-- dono ou admin podem editar (ex.: alternar aberto/fechado)
drop policy if exists "groups_update_owner" on public.groups;
drop policy if exists "groups_update_admin" on public.groups;
create policy "groups_update_admin"
  on public.groups for update
  using (public.is_group_admin(id))
  with check (public.is_group_admin(id));

-- só o dono pode excluir o grupo inteiro
drop policy if exists "groups_delete_owner" on public.groups;
create policy "groups_delete_owner"
  on public.groups for delete
  using (public.is_group_owner(id));

drop policy if exists "group_members_select_member" on public.group_members;
create policy "group_members_select_member"
  on public.group_members for select
  using (user_id = auth.uid() or public.is_group_member(group_id));

drop policy if exists "group_members_insert_self" on public.group_members;
create policy "group_members_insert_self"
  on public.group_members for insert
  with check (auth.uid() = user_id);

-- sair sozinho sempre é permitido; dono remove qualquer um (menos a si
-- mesmo, isso é "sair"); admin só remove membro comum
drop policy if exists "group_members_delete_self_or_owner" on public.group_members;
drop policy if exists "group_members_delete_member" on public.group_members;
create policy "group_members_delete_member"
  on public.group_members for delete
  using (
    user_id = auth.uid()
    or (public.is_group_owner(group_id) and role <> 'owner')
    or (public.is_group_admin(group_id) and role = 'member')
  );

drop policy if exists "group_tasks_select_member" on public.group_tasks;
create policy "group_tasks_select_member"
  on public.group_tasks for select
  using (public.is_group_member(group_id));

drop policy if exists "group_tasks_insert_member" on public.group_tasks;
create policy "group_tasks_insert_member"
  on public.group_tasks for insert
  with check (public.is_group_member(group_id));

drop policy if exists "group_tasks_update_member" on public.group_tasks;
create policy "group_tasks_update_member"
  on public.group_tasks for update
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

drop policy if exists "group_tasks_delete_member" on public.group_tasks;
create policy "group_tasks_delete_member"
  on public.group_tasks for delete
  using (public.is_group_member(group_id));

drop policy if exists "group_task_log_select_member" on public.group_task_log;
create policy "group_task_log_select_member"
  on public.group_task_log for select
  using (public.is_group_member(group_id));

drop policy if exists "group_task_log_insert_member" on public.group_task_log;
create policy "group_task_log_insert_member"
  on public.group_task_log for insert
  with check (public.is_group_member(group_id));

drop policy if exists "group_task_log_update_member" on public.group_task_log;
create policy "group_task_log_update_member"
  on public.group_task_log for update
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));
