-- Etapa 73: envio de PIX por WhatsApp direto do Controle de Saldo — mesma
-- ideia do boleto por e-mail (Etapa 71), só que aqui é WhatsApp, reaproveita
-- a instância uazapi que já existe e o sistema de agendamento que já existe
-- (whatsapp_scheduled_dispatches + hook whatsapp-dispatch-tick, o mesmo do
-- Mensagens > Envio), estendido pra suportar uma SEQUÊNCIA de mensagens
-- (texto + texto + texto + imagem) em vez de só um texto único.

-- Destino do PIX por conta: "grupo" reaproveita wa_group_id/wa_group_name já
-- cadastrados em account_bindings; "numero" usa um número de WhatsApp fixo
-- (DDI+DDD+número, ex.: 5547999998888) configurado aqui. Raramente muda, por
-- isso mora em Personalizar Alertas (pix_accounts), junto dos outros campos
-- "configura uma vez, deixa quieto".
alter table pix_accounts add column if not exists pix_target_type text not null default 'grupo'
  check (pix_target_type in ('grupo', 'numero'));
alter table pix_accounts add column if not exists pix_target_number text;

-- Sequência de partes de um disparo (texto/imagem, nessa ordem) — quando
-- preenchida, o hook manda cada parte em sequência pra cada target, em vez
-- do texto único de `message` (comportamento antigo, inalterado quando
-- `parts` for null/vazio). Formato: [{type: "greeting"}, {type: "text",
-- text: "..."}, {type: "image", url, mime, fileName}]. "greeting" é
-- resolvido na hora do disparo (bom dia/boa tarde/boa noite conforme o
-- horário real do envio, não o horário em que foi agendado).
alter table whatsapp_scheduled_dispatches add column if not exists parts jsonb;

-- Bug pré-existente corrigido de brinde: o hook whatsapp-dispatch-tick já
-- gravava last_run_at/last_error desde sempre (e a rota GET de
-- /api/whatsapp/scheduled-dispatches já os selecionava), mas essas colunas
-- nunca existiram na tabela — o UPDATE final de cada disparo vinha
-- silenciosamente falhando (o código não checava o erro desse update).
alter table whatsapp_scheduled_dispatches add column if not exists last_run_at timestamptz;
alter table whatsapp_scheduled_dispatches add column if not exists last_error text;

-- Histórico de envios de PIX (pra listinha em Controle de Saldo, igual ao
-- boleto_sends da Etapa 71) — cobre tanto o envio imediato quanto o
-- resultado final de um agendado (o agendado também aparece aqui só depois
-- de rodar, via o próprio hook).
create table pix_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  client_name text not null default '',
  target_type text not null check (target_type in ('grupo', 'numero')),
  target_label text not null default '',
  pix_text text not null default '',
  image_url text not null default '',
  image_file_name text not null default '',
  scheduled_at timestamptz,
  dispatch_id uuid references whatsapp_scheduled_dispatches(id) on delete set null,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now()
);

create index pix_sends_user_id_idx on pix_sends (user_id, created_at desc);

alter table pix_sends enable row level security;
create policy "owner_all_pix_sends" on pix_sends
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
