import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText, sendMedia, mediaTypeFromMime } from "@/lib/whatsapp/client";

// Envio manual e imediato de uma mensagem — usado pela aba Mensagens →
// Envio, um POST por destinatário selecionado (o cliente intercala com uma
// pequena espera entre os envios). Se "media" vier preenchido, envia o
// anexo (com o texto como legenda); senão, envia texto puro. Anexos só são
// suportados aqui, no envio imediato — não no disparo agendado.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const inst = await requireWhatsappInstance(supabase, user.id);
    const body = await request.json();
    const groupId = String(body.groupId ?? "").trim();
    const text = String(body.text ?? "");
    const media = body.media as { url: string; mime: string; fileName?: string } | undefined;
    if (!groupId) throw new Error("groupId obrigatório.");
    if (!media && !text.trim()) throw new Error("Mensagem vazia.");
    if (text.length > 4096) throw new Error("Mensagem muito longa.");

    if (media?.url) {
      await sendMedia(inst, groupId, {
        url: media.url,
        type: mediaTypeFromMime(media.mime || ""),
        caption: text,
        fileName: media.fileName,
      });
    } else {
      await sendText(inst, groupId, text);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
