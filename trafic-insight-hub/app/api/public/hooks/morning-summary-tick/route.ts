import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { buildMorningSummary } from "@/lib/alerts/morning-summary";
import { withRunLog } from "@/lib/automation-runs";

// Endpoint público chamado pelo n8n todo dia às 07h (Etapa 137) — monta o "Contas que precisam de atenção" (pontuação por
// status, CPA, Ritmo, saldo e pagamento) e manda pro grupo de WhatsApp + aba Alertas. Só lê da Meta, não altera nada.
// Protegido pelo mesmo segredo compartilhado dos outros hooks internos (WHATSAPP_DISPATCH_SECRET).
export const maxDuration = 60;

export const POST = withRunLog("morning-summary", async (request: Request) => {
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

  const results: Array<{ userId: string; accounts?: number; failedSignals?: string[]; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const { ranked, failedSignals, sendError } = await buildMorningSummary(supabase, userId, token, { send: true });
      results.push({
        userId,
        accounts: ranked.length,
        ...(failedSignals.length > 0 ? { failedSignals } : {}),
        ...(sendError ? { error: sendError } : {}),
      });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
});
