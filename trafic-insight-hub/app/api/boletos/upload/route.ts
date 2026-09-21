import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Etapa 71: upload do boleto (PDF) pra Controle de Saldo > Enviar boleto por
// e-mail. Mesmo padrão de app/api/whatsapp/media/route.ts — sobe pro bucket
// "boletos" (público, pra o n8n conseguir baixar o arquivo pela URL antes de
// anexar no Gmail) numa pasta com o próprio user_id, e devolve a URL pública.
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Arquivo obrigatório.");
    if (file.size === 0) throw new Error("Arquivo vazio.");
    if (file.size > MAX_BYTES) throw new Error("Arquivo maior que 15 MB.");
    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      throw new Error("Envie um arquivo PDF.");
    }

    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;

    const { error } = await supabase.storage.from("boletos").upload(path, file, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (error) throw new Error(error.message);

    const { data } = supabase.storage.from("boletos").getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl, fileName: file.name, path });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
