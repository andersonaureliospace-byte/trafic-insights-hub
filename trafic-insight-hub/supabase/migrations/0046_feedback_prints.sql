-- Etapa 271: Feedback por print. Além do vídeo gravado, um feedback pode ser: prints do resultado + pontos de atenção
-- (escritos e/ou falados) → a IA escreve a mensagem → você revisa e envia (prints no grupo + a mensagem em seguida).
-- Pode ser rodado mais de uma vez.

alter table client_feedbacks add column if not exists tipo text not null default 'video';
alter table client_feedbacks add column if not exists prints jsonb not null default '[]'::jsonb;   -- [{path, mime}]
alter table client_feedbacks add column if not exists pontos text;                                  -- pontos de atenção escritos
