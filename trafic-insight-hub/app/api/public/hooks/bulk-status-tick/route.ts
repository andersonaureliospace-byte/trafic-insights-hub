import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkAndUpdateBulkStatus } from "@/lib/alerts/bulk-status-update";

// Endpoint público chamado pelo n8n, segunda e quinta às 01h (Etapa 55) —
// reclassifica o status de toda "Conta exibida" com o CPA dos últimos 3 dias
// (sem contar hoje), mesma lógica do botão manual "Atualizar status em massa"
// de Acompanhamento, escreve o novo status em account_bindings.priority
// quando muda, reordena o quadro inteiro (status mais crítico primeiro, CPA
// decrescente dentro de cada status) e avisa o grupo de WhatsApp configurado
// com "cliente: status" de TODO cliente classificado nessa rodada — mudou
// ou não, sem dizer qual dos dois casos é (sem comentário nenhum; só fica
// de fora quem foi pulado: inauguração, sem meta de CPA ou sem gasto no
// período). Protegido pelo mesmo segredo compartilhado dos outros hooks
// internos (WHATSAPP_DISPATCH_SECRET).
export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  }
  if (request.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: creds, error: credsErr } = await supabase
    .from("user_meta_credentials")
    .select("user_id, access_token")
    .not("access_token", "is", null);
  if (credsErr) return NextResponse.json({ error: credsErr.message }, { status: 500 });

  const results: Array<{ userId: string; updated?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const { results: statusResults, sendError } = await checkAndUpdateBulkStatus(supabase, userId, token, {
        send: true,
      });
      results.push({
        userId,
        updated: statusResults.filter((r) => r.outcome === "updated").length,
        ...(sendError ? { error: sendError } : {}),
      });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
