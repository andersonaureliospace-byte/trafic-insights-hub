-- Aumento programado de investimento (Etapa 139).
--
-- De madrugada o sistema olha os últimos 3 dias (sem hoje) de cada conjunto e monta o PLANO do dia:
-- quais conjuntos recebem aumento de orçamento diário e de quanto. Às 6h da manhã (em fila, um de cada
-- vez) o plano é aplicado — conferindo na Meta, na hora, se o conjunto continua ativo e qual é o orçamento
-- atual. Esta tabela guarda o plano e o resultado (aplicado / pulado / falhou) de cada conjunto por dia.
create table if not exists budget_increase_plan (
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null,
  adset_id text not null,
  ad_account_id text not null,
  client_name text,
  adset_name text,
  cpa_target numeric,
  cpa_3d numeric,
  cpa_7d numeric,
  conversations_3d integer,
  from_cents integer not null,
  step_cents integer not null,
  cap_cents integer not null,
  status text not null default 'planned' check (status in ('planned', 'applied', 'skipped', 'failed')),
  to_cents integer,
  note text,
  planned_at timestamptz not null default now(),
  applied_at timestamptz,
  primary key (user_id, plan_date, adset_id)
);

create index if not exists budget_increase_plan_user_date_idx on budget_increase_plan (user_id, plan_date desc);

alter table budget_increase_plan enable row level security;
create policy "owner_all_budget_increase_plan" on budget_increase_plan
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
