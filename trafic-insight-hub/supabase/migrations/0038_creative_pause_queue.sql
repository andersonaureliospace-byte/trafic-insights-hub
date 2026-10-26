-- Fila da pausa de criativos em duas etapas (Etapa 209).
--
-- 1ª chamada (creatives-pause-tick com {"step":"analyze"}): analisa as contas e grava aqui quem tem que ser pausado.
-- 2ª chamada (creatives-pause-queue-tick): lê os "pending", pausa um por um e marca "paused" ou "failed".
-- O que já foi processado some sozinho depois de 3 dias.
--
-- Pode ser rodado mais de uma vez (idempotente).
create table if not exists creative_pause_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_id text not null,
  ad_account_id text not null,
  client_name text,
  ad_name text,
  spend numeric,
  conversations numeric,
  cost_per_conversation numeric,
  cpa_target numeric,
  good_history boolean not null default false,
  age_hours numeric,
  kind text not null default 'cpa',
  status text not null default 'pending' check (status in ('pending', 'paused', 'failed')),
  error text,
  queued_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (user_id, ad_id)
);

create index if not exists creative_pause_queue_pending_idx on creative_pause_queue (user_id, status, queued_at);

alter table creative_pause_queue enable row level security;
drop policy if exists "owner_all_creative_pause_queue" on creative_pause_queue;
create policy "owner_all_creative_pause_queue" on creative_pause_queue
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
