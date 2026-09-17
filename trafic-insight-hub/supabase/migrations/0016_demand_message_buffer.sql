-- Etapa 68 (workflow do n8n): tabela de buffer usada pra implementar o
-- "~15s de silêncio" — n8n não tem um jeito nativo de "esperar até parar de
-- chegar mensagem", então o workflow guarda cada mensagem recebida aqui
-- (hook demand-buffer-append), espera 15s, confere se ainda é a mensagem
-- mais recente desse remetente (hook demand-buffer-latest) e só então
-- processa e apaga o buffer (hook demand-buffer-flush). Isso resolve com só
-- nós nativos do n8n (Webhook, IF, Set, HTTP Request, Wait) — sem nó Code,
-- por preferência já registrada do usuário.
create table demand_message_buffer (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sender text not null,
  type text not null default 'text',
  content text not null default '',
  media_url text,
  mime_type text,
  received_at timestamptz not null default now()
);

create index demand_message_buffer_user_sender_idx on demand_message_buffer (user_id, sender);

alter table demand_message_buffer enable row level security;
create policy "owner_all_demand_message_buffer" on demand_message_buffer
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
