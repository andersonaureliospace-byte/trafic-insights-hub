-- Nov/2026: segundo WhatsApp do cliente (algumas contas anunciam com dois números).
-- A auditoria "WhatsApp do conjunto ≠ ficha" aceita qualquer um dos dois. Pode ser rodado mais de uma vez.
alter table account_bindings add column if not exists whatsapp_contact_2 text;
