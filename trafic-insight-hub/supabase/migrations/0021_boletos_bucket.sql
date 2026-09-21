-- Etapa 71: bucket "boletos" no Supabase Storage — precisa ser público
-- porque o n8n baixa o PDF pela URL antes de anexar no e-mail (mesmo motivo
-- do bucket whatsapp-media, migração 0006). Upload/remoção só pelo dono,
-- guardado numa pasta com o próprio user_id.

insert into storage.buckets (id, name, public)
values ('boletos', 'boletos', true)
on conflict (id) do nothing;

create policy "owner_insert_boletos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'boletos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "owner_delete_boletos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'boletos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "public_read_boletos" on storage.objects
  for select to public
  using (bucket_id = 'boletos');
