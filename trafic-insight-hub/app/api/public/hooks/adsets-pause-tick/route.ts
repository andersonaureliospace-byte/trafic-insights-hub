import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkAndPauseAdSets } from "@/lib/alerts/adsets-pause";

// Endpoint público chamado pelo n8n, várias vezes ao dia (05h05/09h05/13h05/
// 23h05 sugeridos, 5 minutos depois do check de Criativos, Etapa 53) — pausa
// sozinho todo conjunto ATIVO no dobro da Meta CPA + R$1 ou mais (mesmo
// limite de Análise > Conjuntos), incluindo conjunto sem anúncio ativo, e
// avisa o grupo de WhatsApp configurado quais conjuntos foram pausados.
// Protegido pelo mesmo segredo compartilhado dos outros hooks internos
// (WHATSAPP_DISPATCH_SECRET).
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

  const results: Array<{ userId: string; paused?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const { paused, sendError } = await checkAndPauseAdSets(supabase, userId, token, { send: true });
      results.push({ userId, paused: paused.filter((p) => p.ok).length, ...(sendError ? { error: sendError } : {}) });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
