import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runNamingAutoFix } from "@/lib/naming/scan";
import { withRunLog } from "@/lib/automation-runs";

// Etapa 140/192: ajuste automático (n8n: 6x ao dia) — tira o "Cópia" e acerta IDADE e DATA nos nomes ativos das contas IVS
// (os dados vêm da própria Meta), sem aprovação. O resto do nome que estiver fora do padrão fica na aba "Padrão de nomes"
// pra aprovação. Protegido por WHATSAPP_DISPATCH_SECRET.
export const maxDuration = 60;

export const POST = withRunLog("naming-fix", async (request: Request) => {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  if (request.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: creds, error: credsErr } = await supabase.from("user_meta_credentials").select("user_id, access_token").not("access_token", "is", null);
  if (credsErr) return NextResponse.json({ error: credsErr.message }, { status: 500 });

  const deadline = Date.now() + 52_000;
  const results: Array<Record<string, unknown>> = [];
  for (const cred of creds ?? []) {
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const r = await runNamingAutoFix(supabase, cred.user_id as string, token, { send: true, deadlineMs: deadline });
      results.push({ userId: cred.user_id, fixed: r.fixed.length, failed: r.failed.length, failedAccounts: r.failedAccounts, ...(r.sendError ? { error: r.sendError } : {}) });
    } catch (e) {
      results.push({ userId: cred.user_id, error: (e as Error).message });
    }
  }
  return NextResponse.json({ processed: results.length, results });
});
