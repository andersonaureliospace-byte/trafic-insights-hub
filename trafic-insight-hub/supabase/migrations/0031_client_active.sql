-- Etapa 131: cliente ativo/desativado. Desativado = a conta fica só com o histórico de configurações (Clientes) e some de
-- todos os painéis, análises, alertas e automações. Padrão = ativo (todo cliente existente continua ativo).
alter table account_bindings add column if not exists active boolean not null default true;
