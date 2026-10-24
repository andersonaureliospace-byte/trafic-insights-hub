import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkCpaAlerts, cpaWindowByHour, type CpaWindow } from "@/lib/alerts/cpa";
import { withRunLog } from "@/lib/automation-runs";

// Etapa 202: o n8n chama 3x ao dia (06h = CPA de ontem > R$4; 12h = hoje > R$20; 18h30 = hoje > R$10). A rodada vem do
// corpo { "window": "yesterday" | "midday" | "evening" } ou, sem corpo, do horário de Brasília (lib/alerts/cpa.ts).
// Texto original (Etapa 48): chamado pelo n8n uma vez por dia às 07h —
// avisa o grupo de WhatsApp configurado, numa única mensagem, com todas as
// contas cujo CPA de ONTEM ficou mais de R$2 acima do CPA ideal cadastrado,
// da mais crítica pra menos crítica. Conta com CPA na média ou abaixo não
// entra na mensagem. Protegido pelo mesmo segredo compartilhado dos outros
// hooks internos (WHATSAPP_DISPATCH_SECRET).
// Varre muitas contas na Meta: pede o tempo máximo de função (evita corte silencioso).
export const maxDuration = 60;

export const POST = withRunLog("cpa-alert", async (request: Request) => {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  }
  if (request.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let window: CpaWindow = cpaWindowByHour();
  try {
    const body = (await request.json()) as { window?: string };
    if (body?.window === "yesterday" || body?.window === "midday" || body?.window === "evening") window = body.window;
  } catch {
    // sem corpo: usa o horário
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
      const { statuses, sendError } = await checkCpaAlerts(supabase, userId, token, { send: true, window });
      results.push({ userId, critical: statuses.filter((s) => s.critical).length, ...(sendError ? { error: sendError } : {}) });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ mode: window, processed: results.length, results });
});
