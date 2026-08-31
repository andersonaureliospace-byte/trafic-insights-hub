import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkLowBalances } from "@/lib/alerts/balance";

// Endpoint público chamado pelo n8n (ex.: a cada 3-6 horas — saldo não
// muda de minuto a minuto) pra checar saldo baixo em todas as contas
// pré-paga/híbrida com limite definido, e avisar o grupo de WhatsApp
// configurado em Configurações > WhatsApp. Respeita o cooldown de 24h por
// conta (ao contrário do "Verificar agora" manual da tela de Avisos).
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

  const results: Array<{ userId: string; alerted?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const statuses = await checkLowBalances(supabase, userId, token, { send: true });
      results.push({ userId, alerted: statuses.filter((s) => s.alerted).length });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
