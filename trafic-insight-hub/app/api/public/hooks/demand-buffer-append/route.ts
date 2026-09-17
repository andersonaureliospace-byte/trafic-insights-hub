import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveUserByDemandsGroup } from "@/lib/demands/ingest";

// Etapa 68 (workflow com buffer): chamado pelo n8n a CADA mensagem recebida
// no grupo de Demandas (uma por vez, sem esperar nada) — só guarda a
// mensagem na fila do remetente e devolve o horário exato que ficou
// registrado (receivedAt). O n8n usa esse valor depois de esperar ~15s pra
// conferir, via demand-buffer-latest, se chegou mensagem mais nova nesse
// meio tempo (se sim, quem processa é a outra execução, mais recente).
export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  }
  if (request.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const groupId = String(body.groupId ?? "").trim();
    const sender = String(body.sender ?? "").trim();
    const type = body.type === "audio" ? "audio" : "text";
    if (!groupId) throw new Error("groupId é obrigatório.");
    if (!sender) throw new Error("sender é obrigatório (quem mandou a mensagem, pra separar o buffer por pessoa).");

    const userId = await resolveUserByDemandsGroup(groupId);
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("demand_message_buffer")
      .insert({
        user_id: userId,
        sender,
        type,
        content: type === "text" ? String(body.text ?? "") : "",
        media_url: type === "audio" ? String(body.mediaUrl ?? "") : null,
        mime_type: type === "audio" ? String(body.mimeType ?? "audio/ogg") : null,
      })
      .select("received_at")
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, receivedAt: data.received_at });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
