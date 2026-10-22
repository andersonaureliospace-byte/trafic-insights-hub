-- Registro das automações (Etapa 190).
--
-- Cada vez que uma automação roda (hooks chamados pelo n8n em app/api/public/hooks/*-tick), grava uma
-- linha aqui por usuário — INCLUSIVE quando verificou e não mexeu em nada. Aparece em
-- Auditoria → Alertas → "Registro das automações", com filtro por automação e por resultado.
--   status: 'changed'   = gerou alerta / mexeu em algo (os títulos ficam em details.alerts)
--           'no-change' = verificou e não precisou mexer em nada
--           'error'     = deu erro (mensagem em summary)
-- Linhas com mais de 30 dias são apagadas sozinhas (lib/automation-runs.ts).
--
-- Pode ser rodado mais de uma vez (idempotente).
create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  automation text not null,
  status text not null check (status in ('changed', 'no-change', 'error')),
  summary text not null default '',
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists automation_runs_user_started_idx on automation_runs (user_id, started_at desc);
create index if not exists automation_runs_user_automation_idx on automation_runs (user_id, automation, started_at desc);

alter table automation_runs enable row level security;
drop policy if exists "owner_all_automation_runs" on automation_runs;
create policy "owner_all_automation_runs" on automation_runs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
