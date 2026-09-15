import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkLowBalances, checkFridayLowBalances } from "@/lib/alerts/balance";
import { checkPaymentErrors } from "@/lib/alerts/payment";
import { checkManualReviews } from "@/lib/alerts/manual-check";

// Endpoint público chamado pelo n8n (ex.: a cada 3-6 horas — saldo não
// muda de minuto a minuto) pra checar saldo baixo em todas as contas
// pré-paga/híbrida com limite definido, e conta com erro no pagamento em
// TODAS as contas vinculadas, avisando o grupo de WhatsApp configurado em
// Configurações > WhatsApp. Respeita o cooldown de 24h por conta (ao
// contrário do "Verificar agora" manual da tela de Avisos). Etapa 38: as
// duas checagens (saldo e pagamento) ficam no mesmo hook de propósito, pra
// não exigir um segundo workflow no n8n. Etapa 63: entram mais duas — saldo
// de sexta-feira (2x/3x o limite, pré-paga/híbrida) e verificação manual
// pendente (qualquer tipo de conta) — pelo mesmo motivo.
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

  const results: Array<{
    userId: string;
    balance?: { alerted: number; error?: string };
    payment?: { alerted: number; error?: string };
    friday?: { alerted: number; error?: string };
    manualCheck?: { alerted: number; error?: string };
    error?: string;
  }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    const entry: (typeof results)[number] = { userId };

    try {
      const { statuses, sendError } = await checkLowBalances(supabase, userId, token, { send: true });
      entry.balance = { alerted: statuses.filter((s) => s.alerted).length, ...(sendError ? { error: sendError } : {}) };
    } catch (e) {
      entry.balance = { alerted: 0, error: (e as Error).message };
    }

    try {
      const { statuses, sendError } = await checkPaymentErrors(supabase, userId, token, { send: true });
      entry.payment = { alerted: statuses.filter((s) => s.alerted).length, ...(sendError ? { error: sendError } : {}) };
    } catch (e) {
      entry.payment = { alerted: 0, error: (e as Error).message };
    }

    try {
      const { statuses, sendError } = await checkFridayLowBalances(supabase, userId, token, { send: true });
      entry.friday = { alerted: statuses.filter((s) => s.alerted).length, ...(sendError ? { error: sendError } : {}) };
    } catch (e) {
      entry.friday = { alerted: 0, error: (e as Error).message };
    }

    try {
      const { statuses, sendError } = await checkManualReviews(supabase, userId, { send: true });
      entry.manualCheck = {
        alerted: statuses.filter((s) => s.alerted).length,
        ...(sendError ? { error: sendError } : {}),
      };
    } catch (e) {
      entry.manualCheck = { alerted: 0, error: (e as Error).message };
    }

    results.push(entry);
  }

  return NextResponse.json({ processed: results.length, results });
}
