import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkAndPauseCreatives } from "@/lib/alerts/creatives-pause";
import { withRunLog } from "@/lib/automation-runs";

// Endpoint público chamado pelo n8n (Etapa 124: 01h10/04h10/07h10/11h10/13h40/16h10/19h10/22h10,
// FORA dos horários de pico 08h-11h e 14h-16h; logo em seguida o mesmo fluxo chama adsets-pause-tick) — pausa sozinho todo criativo ATIVO com CPA R$4+
// acima da meta (mesmo limite de Análise > Criativos) e avisa o grupo de
// WhatsApp configurado quais criativos foram pausados. Protegido pelo mesmo
// segredo compartilhado dos outros hooks internos (WHATSAPP_DISPATCH_SECRET).
// Varre muitas contas na Meta: pede o tempo máximo de função (evita corte silencioso).
export const maxDuration = 60;

export const POST = withRunLog("creatives-pause", async (request: Request) => {
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

  const results: Array<{ userId: string; paused?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const { paused, sendError } = await checkAndPauseCreatives(supabase, userId, token, { send: true });
      results.push({ userId, paused: paused.filter((p) => p.ok).length, ...(sendError ? { error: sendError } : {}) });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
});
