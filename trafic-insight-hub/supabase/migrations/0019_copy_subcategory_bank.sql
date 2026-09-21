-- Etapa 70 (ajuste): banco de 5 variações fixas por subcategoria — pedido
-- explícito do usuário pra parar de chamar a IA de novo toda vez que gera
-- pra um cliente diferente. Quando a subcategoria tem um banco salvo
-- (bank_variations com 5 itens), gerar pra qualquer cliente passa a reusar
-- essas 5 variações tal e qual, sem chamar o Gemini — só o endereço muda,
-- que já é um campo separado (account_bindings.address), nunca embutido no
-- texto de "copy" mesmo no fluxo de IA. Vazio ('[]') = comportamento de
-- sempre, gera com IA normalmente.
alter table copy_subcategories add column if not exists bank_variations jsonb not null default '[]';
