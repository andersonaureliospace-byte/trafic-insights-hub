import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkEveningBalances } from "@/lib/alerts/balance-evening";
import { withRunLog } from "@/lib/automation-runs";

// Endpoint público chamado pelo n8n às 19h, de segunda a sexta (Etapa 156) — "Saldo para amanhã": avisa as contas Pix/Híbrida cujo
// saldo menos o Ritmo de amanhã fica abaixo do limite de alerta, pra dar tempo de programar o Pix. Só lê da Meta e avisa
// (grupo de WhatsApp + aba Alertas), não envia Pix. Protegido pelo mesmo segredo dos outros hooks (WHATSAPP_DISPATCH_SECRET).
export const maxDuration = 60;

export const POST = withRunLog("balance-evening", async (request: Request) => {
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

  const results: Array<{ userId: string; checked?: number; alerted?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const { statuses, sendError } = await checkEveningBalances(supabase, userId, token, { send: true });
      results.push({
        userId,
        checked: statuses.length,
        alerted: statuses.filter((s) => s.low && !s.alreadyHandled).length,
        ...(sendError ? { error: sendError } : {}),
      });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
});
