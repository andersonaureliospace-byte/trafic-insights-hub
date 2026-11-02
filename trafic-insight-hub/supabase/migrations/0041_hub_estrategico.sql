-- Etapa 238: Hub estratégico (/estrategia). Ficha do cliente ganha:
--   responsible  = gestor responsável pela conta (texto livre, escolhido na lista de responsáveis);
--   client_since = desde quando é cliente (primeiro dia do mês);
--   archived     = cliente arquivado (some de todas as telas, dados guardados; dá pra trazer de volta).
alter table account_bindings add column if not exists responsible text;
alter table account_bindings add column if not exists client_since date;
alter table account_bindings add column if not exists archived boolean not null default false;
