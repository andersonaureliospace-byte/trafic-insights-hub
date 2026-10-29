-- Notificações push do app no celular (Etapa 221).
-- Cada aparelho que ativou as notificações no app guarda aqui a inscrição (endpoint + chaves). Os avisos urgentes
-- (os mesmos que vão pro grupo do WhatsApp) são mandados pra todas as inscrições do usuário. Inscrição que a Apple/Google
-- diz que não existe mais é apagada sozinha.
--
-- Pode ser rodado mais de uma vez (idempotente).
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;
drop policy if exists "owner_all_push_subscriptions" on push_subscriptions;
create policy "owner_all_push_subscriptions" on push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
