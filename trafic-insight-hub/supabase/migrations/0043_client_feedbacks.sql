-- Etapa 249: Clientes → Feedbacks. Vídeos gravados pela extensão "Gravador de Tela" do Chrome.
-- Fluxo: a extensão sobe o vídeo (e um áudio pequeno, só pra transcrição) direto pro Storage → o Hub transcreve e resume
-- com o Gemini → fica "Aguardando revisão" → você confere/edita o resumo e clica Enviar → vai o vídeo no grupo do cliente
-- e, em seguida, o resumo numa mensagem separada. Pode ser rodado mais de uma vez.

create table if not exists client_feedbacks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  client_name text not null default '',
  titulo text not null default '',
  status text not null default 'enviando' check (status in ('enviando', 'processando', 'revisao', 'enviado')),
  video_path text,
  video_mime text,
  video_bytes bigint,
  audio_path text,
  audio_mime text,
  duracao_seg integer,
  transcricao text,
  resumo text,
  ai_error text,
  wa_group_id text,
  wa_group_name text,
  sent_at timestamptz,
  send_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_feedbacks_user_created on client_feedbacks (user_id, created_at desc);
alter table client_feedbacks enable row level security;
drop policy if exists "owner_all_client_feedbacks" on client_feedbacks;
create policy "owner_all_client_feedbacks" on client_feedbacks for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Bucket público pra leitura (a Uazapi busca o vídeo pela URL pra mandar no WhatsApp, e o Hub toca o vídeo na revisão).
-- O upload é feito pela extensão com URL assinada gerada no servidor, então não precisa de política de escrita.
-- 50 MB por arquivo = limite do Supabase gratuito.
insert into storage.buckets (id, name, public, file_size_limit)
values ('feedbacks', 'feedbacks', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;
