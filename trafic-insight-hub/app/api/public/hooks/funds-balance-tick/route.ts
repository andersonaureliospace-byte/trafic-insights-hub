import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refreshFundsBalance } from "@/lib/meta/funds-balance";

// Etapa 81: endpoint público (chamado pelo n8n, ex.: a cada poucas horas —
// mesmo padrão de balance-alert-tick) que atualiza o "Saldo por fundos" de
// toda conta com funds_balance_enabled = true. Só soma o que aconteceu
// desde o funds_balance_watermark salvo (ver lib/meta/funds-balance.ts) —
// nunca reprocessa o histórico inteiro, só o que é novo desde a última
// rodada ou desde que o usuário definiu/corrigiu o saldo inicial.
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
    updated: number;
    errors: Array<{ ad_account_id: string; error: string }>;
  }> = [];

  for (const cred of creds ?? []) {
    const userId = cred.user_id as string;
    const token = cred.access_token as string;
    if (!token) continue;

    const entry = { userId, updated: 0, errors: [] as Array<{ ad_account_id: string; error: string }> };

    const { data: enabledAccounts, error: accErr } = await supabase
      .from("pix_accounts")
      .select("ad_account_id, funds_balance_amount, funds_balance_watermark")
      .eq("user_id", userId)
      .eq("funds_balance_enabled", true);
    if (accErr) {
      entry.errors.push({ ad_account_id: "*", error: accErr.message });
      results.push(entry);
      continue;
    }

    for (const acc of enabledAccounts ?? []) {
      const adAccountId = acc.ad_account_id as string;
      try {
        const { deltaCents, currency, newWatermark } = await refreshFundsBalance(
          token,
          adAccountId,
          (acc.funds_balance_watermark as string | null) ?? null,
        );
        if (deltaCents === 0 && newWatermark === acc.funds_balance_watermark) continue; // nada novo

        const currentAmount = Number(acc.funds_balance_amount ?? 0);
        const { error: updateErr } = await supabase
          .from("pix_accounts")
          .update({
            funds_balance_amount: currentAmount + deltaCents / 100,
            ...(currency ? { funds_balance_currency: currency } : {}),
            funds_balance_watermark: newWatermark,
            funds_balance_updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId)
          .eq("ad_account_id", adAccountId);
        if (updateErr) throw updateErr;
        entry.updated++;
      } catch (e) {
        entry.errors.push({ ad_account_id: adAccountId, error: (e as Error).message });
      }
    }

    results.push(entry);
  }

  return NextResponse.json({ processed: results.length, results });
}
