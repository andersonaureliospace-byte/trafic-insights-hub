import { NextResponse } from "next/server";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import { createServiceClient } from "@/lib/supabase/server";
import { syncAccounts } from "@/lib/meta/daily-store";

// Endpoint público chamado pelo n8n de madrugada (Etapa 125, sugerido 03h00 e de novo 03h25 pra terminar o
// que sobrar) — refaz no Supabase (tabela meta_daily_metrics) o gasto e os resultados de cada conta, dia a dia,
// dos últimos 37 dias. Refazer tudo (e não só ontem) é de propósito: pega as conversas que a Meta atribui
// depois. No fim apaga o que ficou mais velho que 37 dias — janela móvel, é o "reset" da virada do mês.
// As contas são as "Contas exibidas" + as que têm cadastro (account_bindings) de cada usuário com token Meta.
// Corpo opcional: { "force": true } refaz mesmo as contas já refeitas nas últimas 6 horas.
// Protegido pelo mesmo segredo compartilhado dos outros hooks internos (WHATSAPP_DISPATCH_SECRET).
// Varre muitas contas na Meta: pede o tempo máximo de função (evita corte silencioso).
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  }
  if (request.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { force?: boolean };
  const deadlineMs = Date.now() + 48_000;

  const supabase = createServiceClient();
  const { data: creds, error: credsErr } = await supabase
    .from("user_meta_credentials")
    .select("user_id, access_token")
    .not("access_token", "is", null);
  if (credsErr) return NextResponse.json({ error: credsErr.message }, { status: 500 });

  const results: Array<Record<string, unknown>> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const [{ data: selected, error: e1 }, { data: bindings, error: e2 }] = await Promise.all([
        supabase.from("user_selected_accounts").select("ad_account_id").eq("user_id", userId),
        supabase.from("account_bindings").select("ad_account_id").eq("user_id", userId),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const off = await inactiveAccountIds(supabase, userId);
      const ids = [
        ...new Set([...(selected ?? []), ...(bindings ?? [])].map((r) => r.ad_account_id as string).filter(Boolean)),
      ].filter((id) => !off.has(id));
      const report = await syncAccounts(token, ids, { force: body.force === true, deadlineMs });
      results.push({
        userId,
        accounts: ids.length,
        synced: report.synced.length,
        skipped: report.skipped.length,
        failed: report.failed,
        pending: report.pending.length,
        pruned: report.pruned,
      });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}
