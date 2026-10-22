import { NextResponse } from "next/server";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import { createServiceClient } from "@/lib/supabase/server";
import { runLocationAudit, runErrorAudit } from "@/lib/audit/run";

// Endpoint público chamado pelo n8n (Etapa 124: de hora em hora no minuto 50, menos 08h/10h/14h — nos
// picos de uso roda só às 09h50 e 15h50) pra rodar as
// duas auditorias automaticamente, sem precisar clicar em "Verificar agora".
// Protegido pelo mesmo segredo compartilhado do disparo de WhatsApp — é o
// segredo geral dos hooks internos do sistema, não só do WhatsApp.
// Varre muitas contas na Meta: pede o tempo máximo de função (evita corte silencioso).
export const maxDuration = 60;

// Etapa 182 — corpo opcional (JSON): { "mode": "recent" | "errors" | "full", "windowMinutes": 45 }
//  - "recent": SÓ a auditoria de localização, e só nos conjuntos criados/alterados nos últimos `windowMinutes`
//              (padrão 45) — chamada leve, dá pra rodar a cada poucos minutos, inclusive nos picos;
//  - "location": só a auditoria de localização, varrendo TODOS os conjuntos ativos;
//  - "errors": só a auditoria de anúncios com erro;
//  - "full" (padrão, sem corpo = comportamento antigo): as duas, varrendo todos os conjuntos ativos.
export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  }
  if (request.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let mode: "recent" | "location" | "errors" | "full" = "full";
  let windowMinutes = 45;
  try {
    const body = (await request.json()) as { mode?: string; windowMinutes?: number };
    if (body?.mode === "recent" || body?.mode === "location" || body?.mode === "errors" || body?.mode === "full") mode = body.mode;
    if (typeof body?.windowMinutes === "number" && body.windowMinutes >= 5 && body.windowMinutes <= 1440) windowMinutes = body.windowMinutes;
  } catch {
    /* sem corpo: varredura completa */
  }
  const sinceMs = mode === "recent" ? Date.now() - windowMinutes * 60_000 : undefined;

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
      const off = await inactiveAccountIds(supabase, userId);
      // Etapa 187: só as "Contas exibidas" do Painel (user_selected_accounts).
      const { data: sel, error: selErr } = await supabase.from("user_selected_accounts").select("ad_account_id").eq("user_id", userId);
      if (selErr) throw selErr;
      const selected = new Set((sel ?? []).map((s) => s.ad_account_id as string));
      const list = ((bindings ?? []) as { ad_account_id: string; client_name: string | null }[]).filter((b) => !off.has(b.ad_account_id) && selected.has(b.ad_account_id));
      if (list.length === 0) {
        results.push({ userId, location: { checkedAccounts: 0 }, errors: { checkedAccounts: 0 } });
        continue;
      }

      const location = mode === "errors" ? null : await runLocationAudit(supabase, userId, token, list, { sinceMs });
      const errors = mode === "recent" || mode === "location" ? null : await runErrorAudit(supabase, userId, token, list);
      results.push({
        userId,
        location: location
          ? { pausedCount: location.pausedCount, fixedCount: location.fixedCount ?? 0, failedCount: location.failedCount, checkedAccounts: location.checkedAccounts }
          : undefined,
        errors: errors ? { pausedCount: errors.pausedCount, failedCount: errors.failedCount, checkedAccounts: errors.checkedAccounts } : undefined,
      });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ mode, processed: results.length, results });
}
