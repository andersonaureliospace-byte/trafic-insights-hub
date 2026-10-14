-- Backup diário das métricas das contas (Etapa 125): uma linha por conta e por dia, guardando só os
-- últimos 37 dias (janela móvel — o que fica mais velho que isso é apagado todo dia pela rotina noturna).
-- Serve pra NÃO pedir à Meta o mês inteiro toda hora: os dias fechados vêm daqui e a Meta só é consultada
-- pelo dia de hoje. A rotina noturna (hook metrics-sync-tick, madrugada) refaz os 37 dias, o que também
-- pega as conversas atribuídas depois.
--
-- spend      = investimento total do dia (tudo, menos campanha [VAGA])
-- cpa_spend  = só o gasto das campanhas que contam pra resultado/CPA (fora seguidores/tráfego/reconhecimento…)
-- results    = resultados (conversas iniciadas etc.) dessas campanhas
-- result_types = tipos de resultado do dia (só pro rótulo)
--
-- Só o servidor (service role) lê e escreve — RLS ligada e sem policy de propósito.
-- Pode ser rodado mais de uma vez (idempotente).
create table if not exists meta_daily_metrics (
  ad_account_id text not null,
  day date not null,
  spend numeric not null default 0,
  cpa_spend numeric not null default 0,
  results numeric not null default 0,
  result_types text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (ad_account_id, day)
);

create index if not exists meta_daily_metrics_day_idx on meta_daily_metrics (day);

alter table meta_daily_metrics enable row level security;
