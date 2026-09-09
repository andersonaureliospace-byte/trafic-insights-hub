-- Etapa 56: limite de R$25,00 por conjunto no aumento automático de
-- orçamento (lib/alerts/increase-budget-auto.ts) — pedido explícito pra não
-- deixar a automação (R$2,50/dia, sem cooldown) subir o orçamento pra
-- sempre. Guarda quanto JÁ foi somado por essa automação em cada conjunto
-- (não é o orçamento em si, só o total acumulado que a própria automação
-- aplicou) — quando bate R$25,00, aquele conjunto para de ser aumentado
-- sozinho até alguém zerar/ajustar isso manualmente (sem reset automático
-- por enquanto). Aumentos feitos na mão (botão "Aumentar" de Análise) não
-- mexem aqui, só contam os automáticos.
create table auto_budget_increases (
  user_id uuid not null references auth.users(id) on delete cascade,
  adset_id text not null,
  total_increased_cents integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, adset_id)
);

alter table auto_budget_increases enable row level security;

create policy "owner_all_auto_budget_increases" on auto_budget_increases
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
