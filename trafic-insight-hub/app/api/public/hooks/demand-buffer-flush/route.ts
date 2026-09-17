import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ingestDemand, resolveUserByDemandsGroup, type IngestMessage } from "@/lib/demands/ingest";

// Etapa 68 (workflow com buffer): chamado pelo n8n só quando a "espiada"
// (demand-buffer-latest) confirma que não chegou mensagem mais nova depois
// da espera de ~15s — ou seja, essa é de fato a última execução, a que deve
// processar o pacote inteiro. Pega tudo que está no buffer desse
// remetente, na ordem que chegou: a ÚLTIMA mensagem vira o nome do cliente
// (só quando for texto e houver mais de 1 mensagem no pacote — nome nunca
// vem em áudio, e pedido explícito: se não vier nome nenhum, a demanda
// entra sem cliente vinculado em vez de travar), o resto vira a
// solicitação. Processa (transcreve áudio, separa em itens, casa cliente,
// grava a demanda — tudo em lib/demands/ingest.ts) e limpa o buffer.
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
    if (!groupId || !sender) throw new Error("groupId e sender são obrigatórios.");

    const userId = await resolveUserByDemandsGroup(groupId);
    const supabase = createServiceClient();
    const { data: rows, error } = await supabase
      .from("demand_message_buffer")
      .select("id, type, content, media_url, mime_type, received_at")
      .eq("user_id", userId)
      .eq("sender", sender)
      .order("received_at", { ascending: true });
    if (error) throw error;

    if (!rows || rows.length === 0) {
      // Já foi processado por outra execução (ou o buffer nunca teve nada
      // pra esse remetente) — não é erro, só não tem o que fazer.
      return NextResponse.json({ ok: true, skipped: true });
    }

    const last = rows[rows.length - 1];
    const hasNameMessage = rows.length > 1 && last.type === "text";
    const messageRows = hasNameMessage ? rows.slice(0, -1) : rows;
    const clientNameRaw = hasNameMessage ? String(last.content ?? "").trim() : "";

    const messages: IngestMessage[] = messageRows.map((r) => ({
      type: r.type === "audio" ? "audio" : "text",
      text: r.content ?? undefined,
      mediaUrl: r.media_url ?? undefined,
      mimeType: r.mime_type ?? undefined,
    }));

    const result = await ingestDemand({
      userId,
      clientNameRaw,
      messages,
      requestedAt: rows[0].received_at,
    });

    await supabase
      .from("demand_message_buffer")
      .delete()
      .in(
        "id",
        rows.map((r) => r.id),
      );

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
