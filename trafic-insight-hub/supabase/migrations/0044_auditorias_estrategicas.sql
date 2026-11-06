-- Etapa 257: Auditorias do Hub estratégico (Automações → Auditorias).
-- Uma agenda só (hook estr-tick, chamado pelo n8n a cada 15 min) roda as conferências em lotes pra caber no limite de
-- requisições da Meta com 50 contas. O que cada conferência acha NÃO vai na hora pro WhatsApp: entra nesta fila e sai
-- junto, numa mensagem só por grupo (separada por gestor), nos horários de resumo. Pode ser rodado mais de uma vez.

create table if not exists estr_digest_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  check_id text not null,          -- qual conferência achou (expansao, whatsapp, custo_pausa, custo_alerta, saldo...)
  ad_account_id text not null,
  client_name text not null default '',
  responsible text,                -- gestor da conta (separa o resumo)
  line text not null,              -- o texto do item no resumo
  dedupe_key text,                 -- o mesmo item não entra duas vezes (ex.: aviso de custo 1x por dia)
  group_id text,                   -- pra qual grupo vai (decidido na hora que entra na fila)
  group_name text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists estr_digest_items_dedupe on estr_digest_items (user_id, dedupe_key);
create index if not exists estr_digest_items_pending on estr_digest_items (user_id, sent_at, created_at);
alter table estr_digest_items enable row level security;
drop policy if exists "owner_all_estr_digest_items" on estr_digest_items;
create policy "owner_all_estr_digest_items" on estr_digest_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Última vez que cada conta teve os conjuntos conferidos (expansão + WhatsApp): a próxima rodada só olha o que foi
-- criado/alterado depois disso — é isso que deixa a conferência leve (1 pedido por conta).
create table if not exists estr_location_checks (
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  checked_at timestamptz not null,
  primary key (user_id, ad_account_id)
);
alter table estr_location_checks enable row level security;
drop policy if exists "owner_all_estr_location_checks" on estr_location_checks;
create policy "owner_all_estr_location_checks" on estr_location_checks for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Registro de cada rodada (o que rodou, quantas contas, quantos pedidos à Meta, erros) — mostra na tela.
create table if not exists estr_audit_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slot text not null,              -- HH:MM de Brasília
  check_id text not null,
  lot text,                        -- ex.: "2/4"
  accounts integer not null default 0,
  meta_calls integer not null default 0,
  found integer not null default 0,
  error text,
  ran_at timestamptz not null default now()
);
create index if not exists estr_audit_runs_user_ran on estr_audit_runs (user_id, ran_at desc);
alter table estr_audit_runs enable row level security;
drop policy if exists "owner_all_estr_audit_runs" on estr_audit_runs;
create policy "owner_all_estr_audit_runs" on estr_audit_runs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
