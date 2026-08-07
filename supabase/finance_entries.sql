-- Tabela usada pela aba Financeiro (js/finance.js).
-- Rode este script no SQL Editor do projeto Supabase (não pode ser criado
-- pelo app, que só tem a publishable/anon key).

create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('bill','income')),
  name text not null,
  amount numeric(10,2) not null check (amount > 0),
  date date not null,
  paid boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists finance_entries_user_date_idx
  on public.finance_entries (user_id, date);

alter table public.finance_entries enable row level security;

create policy "finance_entries_select_own"
  on public.finance_entries for select
  using (auth.uid() = user_id);

create policy "finance_entries_insert_own"
  on public.finance_entries for insert
  with check (auth.uid() = user_id);

create policy "finance_entries_update_own"
  on public.finance_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "finance_entries_delete_own"
  on public.finance_entries for delete
  using (auth.uid() = user_id);
