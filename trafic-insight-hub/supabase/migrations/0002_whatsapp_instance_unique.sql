-- Garante uma única instância de WhatsApp por usuário (mesmo padrão de
-- user_meta_credentials), pra podermos usar upsert com onConflict: "user_id"
-- em vez de gerenciar uma lista de instâncias (isso era necessário no app
-- antigo por causa do modelo multi-workspace, que não existe mais aqui).

alter table whatsapp_instances
  add constraint whatsapp_instances_user_id_key unique (user_id);
