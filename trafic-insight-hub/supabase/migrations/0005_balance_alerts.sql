-- Etapa 8: Mensagens > Avisos (aviso automático de saldo baixo).
-- alert_threshold: valor (R$) abaixo do qual a conta é considerada com
-- saldo baixo. Se ficar em branco, usa 20% do "Valor base" (base_amount)
-- como padrão — se nenhum dos dois estiver definido, a conta não entra
-- na checagem (não dá pra saber o que é "baixo" sem uma referência).
-- last_alert_sent_at: evita reavisar toda hora enquanto o saldo continuar
-- baixo — zera sozinho quando o saldo volta a ficar acima do limite.

alter table pix_accounts add column if not exists alert_threshold numeric;
alter table pix_accounts add column if not exists last_alert_sent_at timestamptz;
