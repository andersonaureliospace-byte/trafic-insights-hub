-- Etapa 158: backup das pausas automáticas + standby de fim de semana.
--
-- auto_pause_log: tudo que a pausa AUTOMÁTICA (criativos e conjuntos, por desempenho) pausou. A rodada
-- seguinte confere os pausados das últimas 6h e reativa quem ganhou conversa e voltou pra dentro do limite
-- (a Meta atribui conversas com atraso). reactivated_at preenchido = já reativado; reviewed_at = última conferência.
create table if not exists auto_pause_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('adset', 'ad')),
  entity_id text not null,
  ad_account_id text not null,
  client_name text,
  entity_name text,
  paused_at timestamptz not null default now(),
  spend_at_pause numeric,
  conversations_at_pause integer,
  cpa_at_pause numeric,
  reason text,
  reactivated_at timestamptz,
  reviewed_at timestamptz
);
create index if not exists auto_pause_log_user_paused_idx on auto_pause_log (user_id, paused_at desc);

alter table auto_pause_log enable row level security;
create policy "owner_all_auto_pause_log" on auto_pause_log
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- weekend_standby: conjuntos em "standby" (orçamento diário reduzido pra R$10 no sábado/domingo).
-- Segunda 05h todos voltam pra R$15 e a linha ganha released_at (some da tela Standby).
--  kind = 'standby' (orçamento foi reduzido) ou 'no_cut' (não dava pra reduzir: CBO, vitalício ou já em R$10 ou menos).
--  reason = 'bom desempenho' | 'mais de 3 dias ativo' | 'acima da meta (fim de semana)'.
create table if not exists weekend_standby (
  user_id uuid not null references auth.users(id) on delete cascade,
  adset_id text not null,
  ad_account_id text not null,
  client_name text,
  adset_name text,
  campaign_id text,
  kind text not null default 'standby' check (kind in ('standby', 'no_cut')),
  reason text,
  from_budget numeric,
  to_budget numeric,
  started_at timestamptz not null default now(),
  released_at timestamptz,
  resume_budget numeric,
  primary key (user_id, adset_id)
);
create index if not exists weekend_standby_user_released_idx on weekend_standby (user_id, released_at);

alter table weekend_standby enable row level security;
create policy "owner_all_weekend_standby" on weekend_standby
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
