-- Etapa 38: nova notificação de "conta de anúncios com erro no pagamento"
-- (account_status/disable_reason da Meta) — precisa da mesma lógica de
-- cooldown de 24h que o saldo baixo já usa (last_alert_sent_at em
-- pix_accounts), mas aqui em account_bindings, já que considera TODAS as
-- contas vinculadas, não só pré-paga/híbrida.
alter table account_bindings add column if not exists payment_alert_sent_at timestamptz;
