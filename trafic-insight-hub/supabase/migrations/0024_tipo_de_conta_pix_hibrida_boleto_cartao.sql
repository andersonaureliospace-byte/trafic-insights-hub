-- Etapa 79: redesenho visual de Controle de Saldo em sub-abas por "Tipo de
-- conta" — Pendências, Pix, Híbrida, Boleto, Cartão, Configurações (ver
-- components/painel/controle-saldo.tsx). Reaproveita a coluna `payment_type`
-- que já existia (pix_accounts, criada em 0001_init.sql), mas:
--
-- 1) Troca os valores aceitos de ('prepaid', 'postpaid', 'hybrid') pra
--    ('pix', 'hybrid', 'boleto', 'card') — "Pré-paga" vira "Pix", "Híbrida"
--    continua, e "Pós-paga" (que misturava quem paga por boleto e quem paga
--    por cartão, sem distinguir) agora é escolhida manualmente entre
--    "Boleto" ou "Cartão". "Loja própria" (own_store) nunca chegou a ter
--    constraint liberando esse valor (só existia no front), então não
--    precisa de tratamento de migração.
-- 2) Por isso NENHUM valor antigo é migrado automaticamente pro novo — não
--    dá pra saber, só pelo dado existente, quem era pago por boleto e quem
--    era pago por cartão dentro de "Pós-paga". Fica null (sem tipo
--    definido) pra toda conta, e o usuário reclassifica manualmente na nova
--    aba Configurações (pedido explícito, ciente de que os avisos
--    automáticos de saldo — que dependem de payment_type ser 'pix'/'hybrid'
--    — ficam pausados pra cada conta até ela ser reclassificada). O resto
--    da configuração de cada conta (Observação, Alertar quando <, valor
--    base, sexta-feira, verificação manual, destino do Pix) é preservado
--    intacto — só a classificação de tipo é resetada.
-- 3) Coluna vira opcional (sem not null/default) — "sem tipo definido" é um
--    estado válido e esperado logo após essa migração.
alter table pix_accounts drop constraint pix_accounts_payment_type_check;
alter table pix_accounts alter column payment_type drop not null;
alter table pix_accounts alter column payment_type drop default;
update pix_accounts set payment_type = null;
alter table pix_accounts add constraint pix_accounts_payment_type_check
  check (payment_type is null or payment_type in ('pix', 'hybrid', 'boleto', 'card'));
