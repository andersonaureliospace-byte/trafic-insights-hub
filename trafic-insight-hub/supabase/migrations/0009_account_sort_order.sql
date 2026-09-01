-- Etapa 14: ordem manual (arrastar-e-soltar) dos clientes na aba
-- Acompanhamento. Fica em account_bindings — por usuário/conta, igual ao
-- resto — nunca em localStorage, pra valer em qualquer navegador/computador.
alter table account_bindings add column if not exists sort_order integer;
