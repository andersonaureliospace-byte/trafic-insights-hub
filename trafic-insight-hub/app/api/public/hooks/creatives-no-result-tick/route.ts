import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkAndPauseCreatives } from "@/lib/alerts/creatives-pause";

// Endpoint público chamado pelo n8n, DE HORA EM HORA (Etapa 105) — pausa só os criativos
// ATIVOS SEM RESULTADO: gastaram R$4+ acima da Meta CPA ontem + hoje sem nenhuma conversa
// iniciada (mesmas regras de histórico dos 7 dias de creatives-pause-tick). Roda com mais
// frequência que creatives-pause-tick, que também pausa o criativo "ruim" (com conversa,
// mas caro) — esse ainda pode reverter, então é avaliado só de 3 em 3 horas. Avisa o grupo
// de WhatsApp configurado. Protegido pelo mesmo segredo compartilhado dos outros hooks
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

  const results: Array<{ userId: string; paused?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const { paused, sendError } = await checkAndPauseCreatives(supabase, userId, token, { send: true, onlyNoResult: true });
      results.push({ userId, paused: paused.filter((p) => p.ok).length, ...(sendError ? { error: sendError } : {}) });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
