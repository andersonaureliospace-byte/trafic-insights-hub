-- Etapa 81: "Saldo por fundos" — pra contas onde o payment_type (Pix/
-- Híbrida/Boleto/Cartão) não reflete sozinho como a Meta cobra de verdade
-- (ex.: conta classificada como Boleto mas que também recebe pagamento
-- manual/PIX avulso e tem cobrança automática por trás, um setup híbrido
-- na prática). Independente do Tipo de conta, essa opção liga um cálculo
-- à parte: soma de "Quantia adicionada ao saldo" (evento
-- funding_event_successful) menos soma de "Conta cobrada" (evento
-- ad_account_billing_charge), reconstruído a partir do histórico de
-- atividades da conta na Graph API (não existe campo pronto pra isso).
--
-- A Meta só guarda ~90 dias de histórico de atividade (testado e
-- confirmado — buscar desde 2015 voltou exatamente os mesmos eventos que
-- buscar só os últimos 90 dias), então não dá pra reconstruir "desde
-- sempre" em conta mais antiga que isso. Por isso o valor começa com um
-- saldo inicial informado manualmente (o usuário já sabe esse número
-- olhando o Ads Manager) e, a partir do momento que é definido, só soma
-- entrada (funding_event_successful) e subtrai cobrança
-- (ad_account_billing_charge) que aparecerem dali em diante — nunca
-- reprocessa pra trás.
--
-- funds_balance_amount: valor atual (em reais, igual base_amount/
-- alert_threshold), atualizado incrementalmente.
-- funds_balance_watermark: event_time do último evento já somado, pra só
-- buscar o que é mais novo que isso na próxima rodada. É resetado pra
-- "agora" toda vez que o usuário define/corrige o saldo inicial
-- manualmente, pra nunca somar de novo uma transação de antes da correção.
alter table pix_accounts add column funds_balance_enabled boolean not null default false;
alter table pix_accounts add column funds_balance_amount numeric;
alter table pix_accounts add column funds_balance_currency text;
alter table pix_accounts add column funds_balance_watermark timestamptz;
alter table pix_accounts add column funds_balance_updated_at timestamptz;
