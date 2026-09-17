import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveUserByDemandsGroup } from "@/lib/demands/ingest";

// Etapa 68 (workflow com buffer): "espiada" chamada pelo n8n depois de
// esperar ~15s — devolve o horário da mensagem mais recente ainda no
// buffer desse remetente. O n8n compara com o receivedAt que guardou antes
// de esperar: se for igual, ninguém mandou mensagem nova nesse meio tempo e
// é hora de processar (demand-buffer-flush); se for diferente (ou null,
// buffer já vazio), essa execução para aqui — quem processa é a mensagem
// mais nova, na sua própria espera.
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
    const { data, error } = await supabase
      .from("demand_message_buffer")
      .select("received_at")
      .eq("user_id", userId)
      .eq("sender", sender)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({ latestReceivedAt: data?.received_at ?? null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
