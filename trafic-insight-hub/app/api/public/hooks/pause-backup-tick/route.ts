import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { reviewPausedAndReactivate } from "@/lib/alerts/pause-backup";
import { withRunLog } from "@/lib/automation-runs";

// Endpoint público chamado pelo n8n no começo de cada rodada de pausas (Etapa 158) — "backup": revisa os conjuntos e criativos pausados
// pelo sistema nas últimas 6h e reativa quem ganhou conversa e voltou pra dentro do limite. Protegido pelo segredo dos outros
// hooks (WHATSAPP_DISPATCH_SECRET).
export const maxDuration = 60;

export const POST = withRunLog("pause-backup", async (request: Request) => {
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

  const results: Array<{ userId: string; reviewed?: number; reactivated?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const r = await reviewPausedAndReactivate(supabase, userId, token, { send: true });
      results.push({ userId, reviewed: r.reviewed, reactivated: r.reactivated.length, ...(r.sendError ? { error: r.sendError } : {}) });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
});
