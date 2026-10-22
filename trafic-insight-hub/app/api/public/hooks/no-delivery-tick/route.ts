import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkNoDelivery } from "@/lib/alerts/no-delivery";
import { withRunLog } from "@/lib/automation-runs";

// Etapa 138: alerta "conta sem anúncio ativo / sem entrega". Agendar de hora em hora (n8n); fora de 8h–21h (BRT) não faz nada.
// Só avisa (aba Alertas + grupo do WhatsApp) — nunca pausa nem muda nada. Protegido por WHATSAPP_DISPATCH_SECRET.
export const maxDuration = 60;

export const POST = withRunLog("no-delivery", async (request: Request) => {
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

  const results: Array<{ userId: string; alerted?: number; skippedOutsideHours?: boolean; failed?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const r = await checkNoDelivery(supabase, userId, token, { send: true });
      results.push({
        userId,
        alerted: r.items.filter((i) => !i.alreadyAlerted).length,
        skippedOutsideHours: r.skippedOutsideHours,
        failed: r.failedAccounts.length,
        ...(r.sendError ? { error: r.sendError } : {}),
      });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }
  return NextResponse.json({ processed: results.length, results });
});
