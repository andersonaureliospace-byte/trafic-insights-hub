-- Etapa 244: espelho do WhatsApp no Hub estratégico.
-- wa_mirror_chats: os grupos que aparecem no painel (atribuídos a uma ou mais contas, ou escolhidos à mão).
-- wa_messages: as mensagens desses grupos (só texto e dados da mensagem — a mídia fica na Uazapi enquanto ela tiver).
-- Histórico de 90 dias: o que passa disso é apagado sozinho. Pode ser rodado mais de uma vez.
create table if not exists wa_mirror_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_jid text not null,
  name text not null default '',
  ad_account_ids text[] not null default '{}',
  last_read_at timestamptz,
  last_message_at timestamptz,
  last_preview text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, chat_jid)
);
alter table wa_mirror_chats enable row level security;
drop policy if exists "owner_all_wa_mirror_chats" on wa_mirror_chats;
create policy "owner_all_wa_mirror_chats" on wa_mirror_chats for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists wa_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_jid text not null,
  message_id text not null,
  from_me boolean not null default false,
  sender text,
  sender_name text,
  msg_type text,
  body text,
  has_media boolean not null default false,
  quoted_id text,
  ts timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);
create index if not exists wa_messages_chat_ts on wa_messages (user_id, chat_jid, ts desc);
alter table wa_messages enable row level security;
drop policy if exists "owner_all_wa_messages" on wa_messages;
create policy "owner_all_wa_messages" on wa_messages for all using (user_id = auth.uid()) with check (user_id = auth.uid());
