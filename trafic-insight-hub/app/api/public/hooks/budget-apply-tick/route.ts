import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { applyBudgetIncreases } from "@/lib/alerts/budget-increase";
import { hourBrt } from "@/lib/alerts/no-delivery-rule";

// Etapa 139: aplica o plano de aumento de investimento a partir das 6h (BRT), em fila (um conjunto de cada vez).
// Cada chamada tem ~50s; se sobrar conjunto na fila, a próxima chamada continua (n8n sugerido: 06:00, 06:02, 06:04, 06:06, 06:08, 06:10).
// Fora de 6h–9h59 não faz nada (aumento só de manhã). Protegido por WHATSAPP_DISPATCH_SECRET.
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  if (request.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const hour = hourBrt();
  if (hour < 6 || hour >= 10) return NextResponse.json({ processed: 0, skippedOutsideHours: true });

  const supabase = createServiceClient();
  const { data: creds, error: credsErr } = await supabase.from("user_meta_credentials").select("user_id, access_token").not("access_token", "is", null);
  if (credsErr) return NextResponse.json({ error: credsErr.message }, { status: 500 });

  const deadline = Date.now() + 50_000;
  const results: Array<Record<string, unknown>> = [];
  for (const cred of creds ?? []) {
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const r = await applyBudgetIncreases(supabase, cred.user_id as string, token, { send: true, deadlineMs: deadline });
      results.push({ userId: cred.user_id, ...r });
    } catch (e) {
      results.push({ userId: cred.user_id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}
