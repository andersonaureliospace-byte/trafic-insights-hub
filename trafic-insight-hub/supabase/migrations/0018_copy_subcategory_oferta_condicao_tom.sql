-- Etapa 70 (ajuste): Oferta e Condição deixam de ser digitadas a cada
-- geração e passam a ser fixadas na subcategoria (perguntadas só na hora de
-- criar/editar uma subcategoria nova) — junto com um Tom de comunicação
-- novo (ex.: "urgente", "persuasiva"; vazio = "neutro", sem gatilho
-- nenhum). Oferta vazia continua deixando a IA inferir o mecanismo pelos
-- modelos de referência, como antes; Condição vazia usa um texto padrão
-- genérico (DEFAULT_CONDICAO_TEXT, lib/copy/types.ts) em vez da IA
-- inventar uma condição nova a cada geração. `fixed` marca subcategorias
-- que não podem ser apagadas/renomeadas pela tela — hoje só a "Neutro" de
-- Geral, pedido explícito pra sempre existir uma opção sem tom nenhum.
alter table copy_subcategories add column if not exists oferta text not null default '';
alter table copy_subcategories add column if not exists condicao text not null default '';
alter table copy_subcategories add column if not exists tom text not null default '';
alter table copy_subcategories add column if not exists fixed boolean not null default false;
