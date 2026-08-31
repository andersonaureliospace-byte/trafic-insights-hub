import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runLocationAudit, runErrorAudit } from "@/lib/audit/run";

// Endpoint público chamado pelo n8n (ex.: a cada 30-60 minutos) pra rodar as
// duas auditorias automaticamente, sem precisar clicar em "Verificar agora".
// Protegido pelo mesmo segredo compartilhado do disparo de WhatsApp — é o
// segredo geral dos hooks internos do sistema, não só do WhatsApp.
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

  const results: Array<{ userId: string; location?: unknown; errors?: unknown; error?: string }> = [];

  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const { data: bindings, error: bindErr } = await supabase
        .from("account_bindings")
        .select("ad_account_id, client_name")
        .eq("user_id", userId);
      if (bindErr) throw bindErr;
      const list = (bindings ?? []) as { ad_account_id: string; client_name: string | null }[];
      if (list.length === 0) {
        results.push({ userId, location: { checkedAccounts: 0 }, errors: { checkedAccounts: 0 } });
        continue;
      }

      const location = await runLocationAudit(supabase, userId, token, list);
      const errors = await runErrorAudit(supabase, userId, token, list);
      results.push({
        userId,
        location: { pausedCount: location.pausedCount, failedCount: location.failedCount, checkedAccounts: location.checkedAccounts },
        errors: { pausedCount: errors.pausedCount, failedCount: errors.failedCount, checkedAccounts: errors.checkedAccounts },
      });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
