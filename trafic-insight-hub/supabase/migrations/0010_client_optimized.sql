-- Coluna "Otimizado" de Acompanhamento (Etapa 36) — marca manualmente que o
-- cliente já foi revisado/otimizado no dia, com o motivo. Reseta sozinho
-- todo dia à meia-noite (horário de Brasília): a data de quando foi marcado
-- fica gravada junto (optimized_date), e a API só considera "otimizado" de
-- verdade quando essa data bate com o dia de hoje em BRT (ver
-- app/api/account-bindings/route.ts) — não precisa de nenhum job/cron
-- apagando nada, o "reset" é só a leitura ignorar marcação de um dia
-- anterior.
alter table account_bindings add column if not exists optimized boolean not null default false;
alter table account_bindings add column if not exists optimized_reason text;
alter table account_bindings add column if not exists optimized_date date;
