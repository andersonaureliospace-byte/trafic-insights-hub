-- Etapa 163: "essa conta precisa ter EXAME?" (Análise → Exame). null = padrão (contas IVS precisam, as outras não);
-- true/false = escolha manual na tela. A verificação automática só avisa das contas que precisam e estão sem conjunto de EXAME ativo.
alter table account_bindings add column if not exists needs_exam boolean;
