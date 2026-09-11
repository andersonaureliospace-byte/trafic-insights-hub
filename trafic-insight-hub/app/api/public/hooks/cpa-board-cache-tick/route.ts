import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refreshCpaBoardCache } from "@/lib/meta/cpa-board-cache";

// Endpoint público chamado pelo n8n, uma vez por dia (Etapa 61, sugerido
// 07h10 — logo depois do cpa-alert-tick, mesmo motivo: dar tempo da Meta
// terminar de consolidar a atribuição de ontem). Recalcula o cache de
// "Ontem" e "Últimos 3 dias" do Monitor de CPA (Painel > Monitor de CPA)
// pra todas as contas com CPA ideal cadastrado — os únicos períodos que não
// mudam mais depois de fechado o dia. "Hoje" continua sempre ao vivo.
// Protegido pelo mesmo segredo compartilhado dos outros hooks internos
// (WHATSAPP_DISPATCH_SECRET).
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

  const results: Array<{ userId: string; accounts?: number; error?: string }> = [];
  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;
    try {
      const { data: bindings, error: bindingsErr } = await supabase
        .from("account_bindings")
        .select("ad_account_id")
        .eq("user_id", userId)
        .not("cpa_target", "is", null);
      if (bindingsErr) throw bindingsErr;
      const accountIds = (bindings ?? []).map((b) => b.ad_account_id as string);
      await refreshCpaBoardCache(supabase, userId, token, accountIds);
      results.push({ userId, accounts: accountIds.length });
    } catch (e) {
      results.push({ userId, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
