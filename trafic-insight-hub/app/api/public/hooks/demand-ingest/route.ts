import { NextResponse } from "next/server";
import { ingestDemand, resolveUserByDemandsGroup, type IngestMessage } from "@/lib/demands/ingest";

// Endpoint público chamado pelo n8n (Etapa 68) com um pacote JÁ MONTADO de
// mensagens (todas as mensagens da solicitação + o nome do cliente
// separado). Útil pra teste manual (Postman/curl) ou pra quem não quiser
// usar o buffer de ~15s de silêncio. O fluxo recomendado no README (com
// múltiplas mensagens soltas chegando com pausas variáveis) usa em vez
// disso demand-buffer-append/-latest/-flush, que montam esse mesmo pacote
// sozinhos a partir do buffer — ambos os caminhos terminam em ingestDemand
// (lib/demands/ingest.ts).
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
    // O nome do cliente é esperado como a última mensagem do pacote, mas
    // pode não vir (a pessoa esqueceu de mandar) — nesse caso a demanda
    // entra sem cliente vinculado ("em aberto"), nunca bloqueia a criação.
    const clientNameRaw = String(body.clientNameRaw ?? "").trim();
    const messages: IngestMessage[] = Array.isArray(body.messages) ? body.messages : [];
    if (!groupId) throw new Error("groupId é obrigatório.");
    if (messages.length === 0) throw new Error("messages é obrigatório (pelo menos 1 mensagem da solicitação).");

    const userId = await resolveUserByDemandsGroup(groupId);
    const result = await ingestDemand({ userId, clientNameRaw, messages, requestedAt: body.requestedAt });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
