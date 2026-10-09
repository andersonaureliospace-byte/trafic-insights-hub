-- Coluna "Otimizado" da aba Acompanhamento de metas (Etapa 83) — mesmo
-- comportamento da de Acompanhamento, mas com a PRÓPRIA marcação, totalmente
-- separada da coluna Otimizado de Acompanhamento (optimized/optimized_date, migration 0010): marcar numa aba
-- não muda nada na outra. Mesma regra de reset à meia-noite (horário de
-- Brasília): a marcação só vale se tab_optimized_date bater com o dia de hoje
-- em BRT (ver app/api/account-bindings/route.ts).
alter table account_bindings add column if not exists tab_optimized boolean not null default false;
alter table account_bindings add column if not exists tab_optimized_date date;
