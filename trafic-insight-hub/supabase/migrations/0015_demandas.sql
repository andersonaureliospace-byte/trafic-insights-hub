-- Etapa 68: aba Demandas — solicitações mandadas num grupo dedicado do
-- WhatsApp (processadas por um workflow no n8n com IA, ver README) viram
-- tarefas aqui. Uma mensagem pode trazer várias tarefas de uma vez (ex.:
-- "Plano de ação:" com uma lista) — tudo isso vira UMA demanda só: o resumo
-- fica em `title` e cada item da lista fica em `items` (mesmo quando é só 1
-- item). O nome do cliente vem como texto solto, exatamente como foi digitado
-- na 2ª mensagem do WhatsApp (`client_name_raw`) — quando bate com um
-- cliente já cadastrado em `account_bindings`, `ad_account_id`/`client_name`
-- ficam preenchidos também; senão ficam nulos e a tela usa só o texto cru
-- (pedido explícito: pode ter demanda de cliente que não está no Painel).
-- `sort_order` guarda a ordem manual (arrastar-e-soltar, mesmo padrão de
-- account_bindings.sort_order da Etapa 14) — sem reordenar nunca, a ordem
-- padrão é da mais antiga pra mais nova (`requested_at`). Não existe status
-- "concluída": o botão "Finalizar" da tela apaga a linha direto (pedido
-- explícito — não precisa manter histórico).
create table demands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text,
  client_name text,
  client_name_raw text not null default '',
  title text not null default '',
  items text[] not null default '{}',
  source_text text not null default '',
  requested_at timestamptz not null default now(),
  sort_order integer,
  created_at timestamptz not null default now()
);

create index demands_user_id_idx on demands (user_id);

alter table demands enable row level security;
create policy "owner_all_demands" on demands
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Grupo do WhatsApp dedicado a receber solicitações (separado do
-- alerts_group_id, que é só pra ENVIAR avisos) — configurável em
-- Configurações → WhatsApp, mesmo padrão do grupo de avisos. O hook público
-- demand-ingest confere esse ID antes de gravar qualquer demanda.
alter table whatsapp_instances add column if not exists demands_group_id text;
alter table whatsapp_instances add column if not exists demands_group_name text;
