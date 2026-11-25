-- Etapa 351 (nova era — vários acessos): quem é quem no Hub.
--   master       = Anderson (dono do sistema; único que mexe nas Automações e cria estrategistas)
--   estrategista = tem a própria carteira (contas, gestores, WhatsApp, token da Meta) — dono dos próprios dados
--   gestor       = vê só as contas em que é o "Responsável", dentro da carteira de um estrategista (owner_id)
-- Login sem linha aqui = estrategista dono dos próprios dados (compatível com o que já existe).
-- Pode ser rodado mais de uma vez.
create table if not exists hub_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade, -- dono da carteira (para master/estrategista = ele mesmo)
  role text not null check (role in ('master', 'estrategista', 'gestor')),
  email text not null,
  display_name text,          -- nome (estrategista) / nome do gestor igual ao usado em "Responsável"
  must_change_password boolean not null default true,
  disabled boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists hub_members_owner_idx on hub_members(owner_id);

alter table hub_members enable row level security;
drop policy if exists "hub_members_self_read" on hub_members;
create policy "hub_members_self_read" on hub_members for select using (user_id = auth.uid() or owner_id = auth.uid());
-- Escrita só pelo servidor (service role), nunca direto do navegador.

-- Anderson vira o master: o login que já tem o token da Meta cadastrado.
insert into hub_members (user_id, owner_id, role, email, display_name, must_change_password)
select c.user_id, c.user_id, 'master', coalesce(u.email, ''), 'Anderson', false
from user_meta_credentials c
join auth.users u on u.id = c.user_id
order by c.user_id
limit 1
on conflict (user_id) do nothing;
