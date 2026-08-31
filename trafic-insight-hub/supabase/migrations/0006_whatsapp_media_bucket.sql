-- Etapa 10: anexos de mídia em Mensagens > Envio. Cria o bucket público
-- (uazapi busca o arquivo por URL, então precisa ser público pra leitura)
-- e restringe upload/remoção ao dono, guardando cada arquivo numa pasta
-- com o próprio user_id (mesmo sendo instância única, é o padrão correto
-- do Supabase Storage e já deixa pronto se um dia precisar de mais de um
-- usuário).

insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', true)
on conflict (id) do nothing;

create policy "owner_insert_whatsapp_media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'whatsapp-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner_delete_whatsapp_media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'whatsapp-media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "public_read_whatsapp_media" on storage.objects
  for select to public
  using (bucket_id = 'whatsapp-media');
