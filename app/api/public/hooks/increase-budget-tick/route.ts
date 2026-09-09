import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkAndIncreaseBudgets } from "@/lib/alerts/increase-budget-auto";

// Endpoint público chamado pelo n8n, 1x por dia de manhã (06h sugerido,
// Etapa 53) — aumenta sozinho em R$2,50 fixo o orçamento diário de todo
// conjunto ATIVO com CPA bom nos últimos 3 dias (mesmo limite de Análise >
// Conjuntos "abaixo da meta") e avisa o grupo de WhatsApp configurado quais
// conjuntos tiveram o orçamento aumentado. Protegido pelo mesmo segredo
// compartilhado dos outros hooks internos (WHATSAPP_DISPATCH_SECRET).
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

  const results: Array<{ userId: string; increased?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const { increased, sendError } = await checkAndIncreaseBudgets(supabase, userId, token, { send: true });
      results.push({ userId, increased: increased.filter((i) => i.ok).length, ...(sendError ? { error: sendError } : {}) });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
