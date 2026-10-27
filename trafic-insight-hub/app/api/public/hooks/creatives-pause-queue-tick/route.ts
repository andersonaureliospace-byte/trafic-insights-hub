import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { processCreativePauseQueue } from "@/lib/alerts/creatives-pause";
import { withRunLog } from "@/lib/automation-runs";

// Etapa 209: 2ª etapa da pausa de criativos — o n8n chama logo depois de creatives-pause-tick com { "step": "analyze" }.
// Lê a fila (creative_pause_queue) e pausa um por um, 1s entre cada, até ~50s. O que sobrar fica pendente e a próxima
// chamada continua de onde parou. Avisa no grupo/aba Alertas o que foi pausado. Protegido por WHATSAPP_DISPATCH_SECRET.
export const maxDuration = 60;

export const POST = withRunLog("creatives-pause-queue", async (request: Request) => {
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

  const results: Array<{ userId: string; paused?: number; remaining?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const { paused, remaining, sendError } = await processCreativePauseQueue(supabase, userId, token, { send: true });
      const failed = paused.filter((p) => !p.ok);
      const why = [...new Set(failed.map((p) => p.error ?? "erro"))].slice(0, 2).join(" / ");
      const errText = [
        sendError,
        failed.length ? `${failed.length} criativo(s) não pausado(s): ${why}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      results.push({ userId, paused: paused.filter((p) => p.ok).length, remaining, ...(errText ? { error: errText } : {}) });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
});
