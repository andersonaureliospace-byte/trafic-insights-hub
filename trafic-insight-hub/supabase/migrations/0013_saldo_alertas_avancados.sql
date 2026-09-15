-- Etapa 63: Controle de Saldo vira um quadro de monitoramento orientado a
-- alerta — toda conta é monitorada, mas a aba só mostra quem está pendente
-- ou com aviso (quem está OK não aparece). Além do saldo baixo e do erro de
-- pagamento que já existiam, entram 2 novos tipos de monitoramento:
--
-- 1) Sexta-feira, saldo 2x/3x menor que o limite (pré-paga/híbrida) — pensado
--    pra avisar a tempo do fim de semana, quando não dá pra recarregar. Tem
--    cooldown de 24h próprio (friday_alert_sent_at), separado do cooldown do
--    saldo baixo comum (last_alert_sent_at), já que são condições diferentes
--    e podem disparar em dias diferentes.
-- 2) Verificação manual — não importa se a conta é pré-paga ou pós-paga:
--    o usuário escolhe uma conta pra ser lembrado num dia fixo da semana
--    (manual_check_mode = 'weekday') ou daqui X dias (manual_check_mode =
--    'interval'). manual_check_next_at é a data (fuso America/Sao_Paulo)
--    que, uma vez alcançada, deixa a conta "pendente" até o usuário marcar
--    como verificada. manual_check_repeat controla o que acontece depois de
--    verificar: true recalcula o próximo lembrete (mesmo dia da semana, ou
--    +X dias de novo), false zera manual_check_next_at e deixa a rotina
--    dormente (configuração preservada) até o usuário reativar.
alter table pix_accounts add column if not exists friday_multiplier numeric;
alter table pix_accounts add column if not exists friday_alert_sent_at timestamptz;

alter table pix_accounts add column if not exists manual_check_mode text
  check (manual_check_mode in ('weekday', 'interval'));
alter table pix_accounts add column if not exists manual_check_weekday int
  check (manual_check_weekday between 0 and 6);
alter table pix_accounts add column if not exists manual_check_interval_days int;
alter table pix_accounts add column if not exists manual_check_repeat boolean not null default true;
alter table pix_accounts add column if not exists manual_check_next_at date;
alter table pix_accounts add column if not exists manual_check_last_verified_at timestamptz;
alter table pix_accounts add column if not exists manual_check_alert_sent_at timestamptz;
