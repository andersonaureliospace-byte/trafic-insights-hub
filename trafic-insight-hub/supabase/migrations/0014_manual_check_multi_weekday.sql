-- Etapa 67: verificação manual em "dia fixo da semana" agora aceita mais de
-- um dia por semana (ex.: segunda E quinta), não só um único dia — pedido
-- explícito. manual_check_weekday (int único, 0-6) vira
-- manual_check_weekdays (array de int, 0-6). Backfill preserva quem já tinha
-- um dia configurado (vira array de 1 elemento); a coluna antiga sai do
-- banco, mesmo padrão da 0011 (nada mais no código referencia ela).
alter table pix_accounts add column if not exists manual_check_weekdays integer[];

update pix_accounts
set manual_check_weekdays = array[manual_check_weekday]
where manual_check_weekday is not null and manual_check_weekdays is null;

alter table pix_accounts drop column if exists manual_check_weekday;
