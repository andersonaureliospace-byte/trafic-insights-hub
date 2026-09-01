-- Etapa 13: nova aba Painel > Clientes — ficha com dados preenchidos à mão
-- por cliente. CPA ideal e Investimento mensal já existiam (cpa_target,
-- monthly_investment); faltam Meta de leads, WhatsApp de contato do
-- cliente e Endereço.
alter table account_bindings add column if not exists meta_leads numeric;
alter table account_bindings add column if not exists whatsapp_contact text;
alter table account_bindings add column if not exists address text;
