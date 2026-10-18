-- Padrão de nomes: itens "personalizados" (Etapa 140c).
--
-- Alguns nomes são personalizados de propósito (casos bem específicos). Quando você clica em "Manter personalizado"
-- (ou aceita um nome editado que continua fora da regra), o item entra aqui e a aba "Padrão de nomes" e o ajuste
-- automático de idade/data deixam de mexer nele. "Voltar ao padrão" apaga a linha.
create table if not exists naming_exceptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id text not null,
  entity text not null check (entity in ('campaign', 'adset', 'ad')),
  ad_account_id text,
  client_name text,
  name text,
  created_at timestamptz not null default now(),
  primary key (user_id, entity_id)
);

alter table naming_exceptions enable row level security;
create policy "owner_all_naming_exceptions" on naming_exceptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
