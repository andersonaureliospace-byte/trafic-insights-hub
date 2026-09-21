-- Etapa 71: envio de boleto por e-mail direto do sistema (Controle de
-- Saldo). O usuário sobe o PDF, escolhe a conta (define o nome da loja no
-- assunto) e a data de vencimento — o texto do e-mail é fixo, só troca
-- loja/data/anexo. O app não manda e-mail sozinho: sobe o PDF pro bucket
-- "boletos" e faz um POST pra um webhook do n8n (BOLETO_WEBHOOK_URL), que
-- manda de verdade pelo nó nativo do Gmail (mesmo padrão de
-- lib/crm/sale-webhook.ts + crm_sale_webhook_deliveries, só que aqui é uma
-- tabela de histórico próprio em vez de amarrada a um lead).
create table boleto_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  client_name text not null default '',
  due_date date not null,
  pdf_url text not null,
  pdf_file_name text not null default '',
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now()
);

create index boleto_sends_user_id_idx on boleto_sends (user_id, created_at desc);

alter table boleto_sends enable row level security;
create policy "owner_all_boleto_sends" on boleto_sends
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
