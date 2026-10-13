-- Aba "Descrição" (Etapa 115): descrição de cada cliente espelhada do Asana.
--
-- asana_description é a cópia da descrição da tarefa do cliente no Asana (texto simples), atualizada
-- a cada 30 min em horário comercial (hook asana-descriptions-tick) ou no botão "Atualizar do Asana".
-- draft é o que o usuário digitou no Traffic e ainda NÃO enviou: enquanto existir, a sincronização
-- não sobrescreve. Só o botão "Enviar ao Asana" (por cliente) grava de volta no Asana.
--
-- Pode ser rodado mais de uma vez (idempotente).
create table if not exists client_descriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  client_name text,
  asana_task_gid text,
  asana_task_name text,
  asana_description text not null default '',
  asana_has_rich boolean not null default false,
  match_status text not null default 'pending' check (match_status in ('ok', 'not_found', 'ambiguous', 'pending')),
  draft text,
  synced_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, ad_account_id)
);

alter table client_descriptions enable row level security;
drop policy if exists "owner_all_client_descriptions" on client_descriptions;
create policy "owner_all_client_descriptions" on client_descriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
