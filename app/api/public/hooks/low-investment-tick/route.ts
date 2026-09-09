import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkLowInvestment } from "@/lib/alerts/low-investment";

// Endpoint público chamado pelo n8n, de segunda a sexta (07h/09h15/13h
// sugeridos, Etapa 53) — só avisa (nunca pausa nem muda nada) o grupo de
// WhatsApp configurado com as contas cujo orçamento diário já configurado
// está MENOR que o Ritmo necessário pra bater a meta do mês — qualquer
// diferença, sem banda de tolerância (Etapa 54). Protegido pelo mesmo
// segredo compartilhado dos outros hooks internos (WHATSAPP_DISPATCH_SECRET).
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

  const results: Array<{ userId: string; low?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const { statuses, sendError } = await checkLowInvestment(supabase, userId, token, { send: true });
      results.push({ userId, low: statuses.filter((s) => s.low).length, ...(sendError ? { error: sendError } : {}) });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
