import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkCpaAlerts } from "@/lib/alerts/cpa";

// Endpoint público chamado pelo n8n, uma vez por dia às 07h (Etapa 48) —
// avisa o grupo de WhatsApp configurado, numa única mensagem, com todas as
// contas cujo CPA de ONTEM ficou mais de R$2 acima do CPA ideal cadastrado,
// da mais crítica pra menos crítica. Conta com CPA na média ou abaixo não
// entra na mensagem. Protegido pelo mesmo segredo compartilhado dos outros
// hooks internos (WHATSAPP_DISPATCH_SECRET).
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

  const results: Array<{ userId: string; critical?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const { statuses, sendError } = await checkCpaAlerts(supabase, userId, token, { send: true });
      results.push({ userId, critical: statuses.filter((s) => s.critical).length, ...(sendError ? { error: sendError } : {}) });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
