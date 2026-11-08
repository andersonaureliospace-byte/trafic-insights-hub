-- Etapa 286: quadro Demandas (Kanban por dia). Tarefas (manuais, de rotina, de alerta grave do Tráfego e de feedback) e
-- as rotinas que geram tarefas sozinhas. Pode ser rodado mais de uma vez.

create table if not exists estr_rotinas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  titulo text not null,
  descricao text not null default '',
  alvo text not null default 'todos' check (alvo in ('todos', 'cliente', 'nenhum')), -- todos os clientes / um cliente / sem cliente
  ad_account_id text,                   -- quando alvo = cliente
  responsavel text,                     -- quando alvo = nenhum (com cliente, vai pro gestor do cliente)
  frequencia text not null default 'semanal' check (frequencia in ('diaria', 'semanal', 'mensal')),
  dias_semana int[] not null default '{1}', -- 0 = domingo … 6 = sábado (semanal)
  dia_mes int not null default 1,           -- mensal
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists estr_rotinas_user_idx on estr_rotinas (user_id);

create table if not exists estr_tarefas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  titulo text not null,
  descricao text not null default '',
  tipo text not null default 'manual' check (tipo in ('manual', 'rotina', 'alerta', 'feedback')),
  ad_account_id text,
  client_name text,
  responsavel text,                     -- gestor (vem do cliente; sem cliente, o escolhido)
  data date not null,                   -- dia em que aparece no quadro
  ordem double precision not null default 0, -- posição dentro do dia (arrastar pra cima/baixo)
  status text not null default 'aberta' check (status in ('aberta', 'feita', 'excluida')),
  done_at timestamptz,
  rotina_id uuid references estr_rotinas(id) on delete set null,
  origem_key text,                      -- não deixa a mesma tarefa de rotina/alerta nascer duas vezes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists estr_tarefas_quadro_idx on estr_tarefas (user_id, data, status);
create unique index if not exists estr_tarefas_origem_idx on estr_tarefas (user_id, origem_key);

alter table estr_rotinas enable row level security;
alter table estr_tarefas enable row level security;
drop policy if exists "owner_all_estr_rotinas" on estr_rotinas;
create policy "owner_all_estr_rotinas" on estr_rotinas for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "owner_all_estr_tarefas" on estr_tarefas;
create policy "owner_all_estr_tarefas" on estr_tarefas for all using (user_id = auth.uid()) with check (user_id = auth.uid());
