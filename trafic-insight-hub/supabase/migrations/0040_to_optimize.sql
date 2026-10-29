-- Etapa 226: 3º estado da marcação do cliente — "Otimizar" (Pendente → Otimizar → Otimizado).
-- Diferente do "Otimizado", não volta sozinho à meia-noite: fica até você mudar. Pode rodar mais de uma vez.
alter table account_bindings add column if not exists to_optimize boolean not null default false;
