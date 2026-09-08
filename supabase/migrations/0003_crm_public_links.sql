-- Etapa 6: CRM (webhook de venda por instância) + link público por conta
-- (upsert idempotente do token em public_dashboards).

alter table crm_instances add column if not exists sale_webhook_url text;

alter table public_dashboards
  add constraint public_dashboards_user_account_unique unique (user_id, ad_account_id);
