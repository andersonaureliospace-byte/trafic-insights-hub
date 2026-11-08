-- SQL das etapas 270, 271 e 286 juntos: Disparos em segundo plano, Feedback por print e quadro Demandas.
-- Pode rodar inteiro de uma vez (e mais de uma vez) no Supabase: SQL Editor → cole tudo → Run.

-- ===================== 0045_disparos.sql =====================
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

-- ===================== 0046_feedback_prints.sql =====================
-- Etapa 271: Feedback por print. Além do vídeo gravado, um feedback pode ser: prints do resultado + pontos de atenção
-- (escritos e/ou falados) → a IA escreve a mensagem → você revisa e envia (prints no grupo + a mensagem em seguida).
-- Pode ser rodado mais de uma vez.

alter table client_feedbacks add column if not exists tipo text not null default 'video';
alter table client_feedbacks add column if not exists prints jsonb not null default '[]'::jsonb;   -- [{path, mime}]
alter table client_feedbacks add column if not exists pontos text;                                  -- pontos de atenção escritos

-- ===================== 0047_demandas.sql =====================
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

