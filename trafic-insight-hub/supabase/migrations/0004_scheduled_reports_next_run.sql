-- Etapa 7: Mensagens > Relatórios. scheduled_reports precisa de um
-- "próximo disparo" concreto (igual ao whatsapp_scheduled_dispatches) pra
-- o hook report-tick saber quando rodar, e de um jeito de pausar sem
-- apagar a configuração.

alter table scheduled_reports add column if not exists next_run_at timestamptz;
alter table scheduled_reports add column if not exists paused boolean not null default false;

update scheduled_reports set next_run_at = now() where next_run_at is null;

alter table scheduled_reports alter column next_run_at set not null;
