-- Pausa automática de Conjuntos com quarentena (Etapa 99).
--
-- Conjunto acima da meta nos últimos 3 dias, mas com CPA dos últimos 7 dias ainda abaixo
-- do ideal (a "linha verde" de Análise), não é pausado: o orçamento diário cai R$10 e o
-- conjunto entra em quarentena por 24h — nas verificações dessas 24h ele é ignorado (não
-- pausa, não corta de novo). Passou a quarentena, volta a ser avaliado (ver
-- lib/alerts/adsets-pause.ts). Esta tabela guarda até quando vale a quarentena.
--
-- budget_scope: 'adset' quando o corte foi no orçamento do próprio conjunto (ABO) e
-- 'campaign' quando foi no da campanha (CBO) — nesse caso campaign_id impede que outro
-- conjunto da mesma campanha corte o orçamento da campanha de novo dentro das 24h.
create table if not exists adset_quarantine (
  user_id uuid not null references auth.users(id) on delete cascade,
  adset_id text not null,
  ad_account_id text not null,
  campaign_id text,
  budget_scope text not null default 'adset' check (budget_scope in ('adset', 'campaign')),
  quarantine_until timestamptz not null,
  cuts integer not null default 1,
  last_from_budget numeric,
  last_to_budget numeric,
  updated_at timestamptz not null default now(),
  primary key (user_id, adset_id)
);

create index if not exists adset_quarantine_user_until_idx on adset_quarantine (user_id, quarantine_until);

alter table adset_quarantine enable row level security;
create policy "owner_all_adset_quarantine" on adset_quarantine
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
