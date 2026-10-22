import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { planBudgetIncreases } from "@/lib/alerts/budget-increase";
import { withRunLog } from "@/lib/automation-runs";

// Etapa 139: monta, de madrugada (n8n sugerido: 03h00), o PLANO de aumento de investimento do dia. Não mexe na Meta.
// Quem aplica é budget-apply-tick, às 6h. Protegido por WHATSAPP_DISPATCH_SECRET.
export const maxDuration = 60;

export const POST = withRunLog("budget-plan", async (request: Request) => {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  if (request.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: creds, error: credsErr } = await supabase.from("user_meta_credentials").select("user_id, access_token").not("access_token", "is", null);
  if (credsErr) return NextResponse.json({ error: credsErr.message }, { status: 500 });

  const results: Array<Record<string, unknown>> = [];
  for (const cred of creds ?? []) {
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const r = await planBudgetIncreases(supabase, cred.user_id as string, token);
      results.push({ userId: cred.user_id, planned: r.planned, failedAccounts: r.failedAccounts });
    } catch (e) {
      results.push({ userId: cred.user_id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ processed: results.length, results });
});
