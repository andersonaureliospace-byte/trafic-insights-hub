-- Etapa 270: Disparos em massa rodando no servidor (segundo plano). O Hub guarda o disparo e a fila de grupos aqui e vai
-- mandando um grupo por vez, sozinho — dá pra trocar de tela, abrir outra aba ou fechar o Hub.
-- Pode ser rodado mais de uma vez.

create table if not exists estr_disparos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'rodando' check (status in ('rodando', 'pausado', 'parado', 'concluido')),
  parts jsonb not null default '[]'::jsonb,       -- [{kind, text, url, mime, fileName, bytes}]
  resumo text not null default '',                 -- começo do texto (pra lista)
  interval_min int not null default 10,            -- segundos entre um grupo e outro
  interval_max int not null default 20,
  total int not null default 0,
  ok int not null default 0,
  erro int not null default 0,
  next_at timestamptz not null default now(),      -- quando pode mandar o próximo grupo
  lock_until timestamptz,                          -- trava pra dois envios não rodarem juntos
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists estr_disparos_user_idx on estr_disparos (user_id, created_at desc);
create index if not exists estr_disparos_ativos_idx on estr_disparos (status) where status = 'rodando';

create table if not exists estr_disparo_itens (
  id bigserial primary key,
  disparo_id uuid not null references estr_disparos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ordem int not null default 0,
  group_id text not null,
  group_name text not null default '',
  cliente text not null default '',                -- o que entra no lugar de {cliente}
  status text not null default 'pendente' check (status in ('pendente', 'ok', 'erro')),
  parte int not null default 0,                    -- próximo bloco a mandar nesse grupo (continua de onde parou)
  error text,
  sent_at timestamptz
);
alter table estr_disparo_itens add column if not exists parte int not null default 0;
create index if not exists estr_disparo_itens_fila_idx on estr_disparo_itens (disparo_id, status, ordem);

alter table estr_disparos enable row level security;
alter table estr_disparo_itens enable row level security;
drop policy if exists "owner_all_estr_disparos" on estr_disparos;
create policy "owner_all_estr_disparos" on estr_disparos for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "owner_all_estr_disparo_itens" on estr_disparo_itens;
create policy "owner_all_estr_disparo_itens" on estr_disparo_itens for all using (user_id = auth.uid()) with check (user_id = auth.uid());
