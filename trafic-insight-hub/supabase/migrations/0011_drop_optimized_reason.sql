-- Etapa 37: a coluna "Otimizado" virou um seletor simples (Otimizado/Não
-- otimizado, sem motivo) — optimized_reason (criada na 0010) não é mais
-- usada em lugar nenhum do código, então sai do banco também.
alter table account_bindings drop column if exists optimized_reason;
