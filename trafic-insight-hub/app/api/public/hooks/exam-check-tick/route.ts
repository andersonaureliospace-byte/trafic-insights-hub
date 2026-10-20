import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runExamCheck } from "@/lib/exam/check";

// Etapa 163: verificação de EXAME. n8n: 4 vezes ao dia (09h05, 12h05, 15h05, 18h05), nos intervalos das outras rotinas. Para cada conta que PRECISA de
// exame, olha os anúncios ativos e confere pelo nome do conjunto se há algum de EXAME; sem nenhum, avisa em Alertas (1x por dia por conta).
// Só avisa — nunca altera nada na Meta. Fora de 8h–21h (BRT) não faz nada. Protegido por WHATSAPP_DISPATCH_SECRET.
export const maxDuration = 60;

export async function POST(request: Request) {
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
      const r = await runExamCheck(supabase, cred.user_id as string, token, { send: true });
      results.push({ userId: cred.user_id, checked: r.checked, missing: r.missing.length, newAlerts: r.newAlerts, failed: r.failed.length, skippedOutsideHours: r.skippedOutsideHours, ...(r.sendError ? { error: r.sendError } : {}) });
    } catch (e) {
      results.push({ userId: cred.user_id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}
