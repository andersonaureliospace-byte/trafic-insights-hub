-- Aba "Alertas" (Etapa 112).
--
-- Toda notificação das verificações automáticas (pausas, avisos de investimento, saldo,
-- pagamento, CPA etc.) é gravada aqui e aparece na aba Alertas do Painel. No grupo do
-- WhatsApp vão só as urgentes (lista GROUP_KINDS em lib/alerts/notifications.ts).
--
-- Some sozinha 72h depois (expires_at) ou quando o usuário clica em OK (a linha é apagada).
-- Avisos que se repetem a cada rodada (Invest. diário em 50% do Ritmo e Investimento baixo)
-- não empilham: a linha aberta mais recente do mesmo tipo é atualizada (replace_kind).
--
-- Pode ser rodado mais de uma vez (idempotente).
create table if not exists alert_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  item_count integer not null default 1,
  sent_to_group boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '72 hours')
);

create index if not exists alert_notifications_user_created_idx on alert_notifications (user_id, created_at desc);
create index if not exists alert_notifications_user_kind_idx on alert_notifications (user_id, kind);
create index if not exists alert_notifications_expires_idx on alert_notifications (expires_at);

alter table alert_notifications enable row level security;
drop policy if exists "owner_all_alert_notifications" on alert_notifications;
create policy "owner_all_alert_notifications" on alert_notifications
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
