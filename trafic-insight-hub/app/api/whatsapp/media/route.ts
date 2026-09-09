import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Upload de anexo pra Mensagens > Envio. Sobe pro bucket "whatsapp-media"
// (público, pra o uazapi conseguir buscar o arquivo por URL) dentro de uma
// pasta com o próprio user_id, e devolve a URL pública já pronta pra usar
// em POST /api/whatsapp/send.
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Arquivo obrigatório.");
    if (file.size === 0) throw new Error("Arquivo vazio.");
    if (file.size > MAX_BYTES) throw new Error("Arquivo maior que 15 MB.");

    const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext ? `.${ext}` : ""}`;

    const { error } = await supabase.storage.from("whatsapp-media").upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (error) throw new Error(error.message);

    const { data } = supabase.storage.from("whatsapp-media").getPublicUrl(path);
    return NextResponse.json({
      url: data.publicUrl,
      mime: file.type || "application/octet-stream",
      fileName: file.name,
      path,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase } = await requireUser();
    const body = await request.json();
    const path = String(body.path ?? "");
    if (!path) throw new Error("path obrigatório.");
    await supabase.storage.from("whatsapp-media").remove([path]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
