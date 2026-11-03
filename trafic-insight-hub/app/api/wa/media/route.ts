import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { waFetch } from "@/lib/whatsapp/client";

// Etapa 244: abrir a mídia de uma mensagem (imagem, áudio, vídeo, documento). Não guarda nada: pede o arquivo à Uazapi
// na hora — funciona enquanto ela ainda tiver a mídia.
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const { messageid } = (await request.json()) as { messageid?: string };
    if (!messageid) throw new Error("Mensagem obrigatória.");
    const { data: own } = await supabase.from("wa_messages").select("message_id").eq("user_id", user.id).eq("message_id", messageid).maybeSingle();
    if (!own) throw new Error("Mensagem não encontrada.");
    const inst = await requireWhatsappInstance(supabase, user.id);
    const j = (await waFetch<Record<string, unknown>>(
      { api_url: inst.api_url, token: inst.token },
      "/message/download",
      { method: "POST", body: JSON.stringify({ id: messageid, return_link: true, generate_mp3: true }) },
    )) as Record<string, unknown>;
    const url = (j.fileURL ?? j.fileUrl ?? j.url ?? j.link) as string | undefined;
    const mime = (j.mimetype ?? j.mimeType ?? "") as string;
    if (!url) throw new Error("A Uazapi não tem mais essa mídia.");
    return NextResponse.json({ url, mime });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
