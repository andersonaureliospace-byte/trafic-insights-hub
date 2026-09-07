import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { spDate } from "@/lib/meta/client";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("account_bindings")
      .select("*")
      .eq("user_id", user.id);
    if (error) throw error;

    // Coluna "Otimizado" de Acompanhamento reseta sozinha à meia-noite (BRT):
    // uma marcação só vale "hoje" se optimized_date bater com o dia de hoje
    // em BRT — de um dia pro outro, a leitura já devolve pendente de novo
    // sem precisar apagar nada no banco.
    const todayBRT = spDate(new Date());
    const bindings = (data ?? []).map((b) =>
      b.optimized && b.optimized_date !== todayBRT ? { ...b, optimized: false, optimized_reason: null } : b,
    );
    return NextResponse.json({ bindings });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// Upsert de um binding (cliente/metas/whatsapp) por conta de anúncio.
export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const ad_account_id = String(body.ad_account_id ?? "").trim();
    if (!ad_account_id) throw new Error("ad_account_id é obrigatório.");

    const patch: Record<string, unknown> = { user_id: user.id, ad_account_id, updated_at: new Date().toISOString() };
    for (const key of [
      "client_name",
      "cpa_target",
      "monthly_investment",
      "daily_investment_target",
      "priority",
      "wa_group_id",
      "wa_group_name",
      "meta_leads",
      "whatsapp_contact",
      "address",
      "sort_order",
    ]) {
      if (key in body) patch[key] = body[key];
    }

    // "Otimizado" tem regra própria (não entra no loop genérico acima): pra
    // marcar precisa de motivo, e a data de referência é sempre calculada
    // aqui no servidor (nunca confia na data que o navegador mandaria) — é
    // ela que a leitura usa pra saber se a marcação ainda vale hoje.
    if ("optimized" in body) {
      if (body.optimized) {
        const reason = String(body.optimized_reason ?? "").trim();
        if (!reason) throw new Error("Informe o motivo pra marcar como otimizado.");
        patch.optimized = true;
        patch.optimized_reason = reason;
        patch.optimized_date = spDate(new Date());
      } else {
        patch.optimized = false;
        patch.optimized_reason = null;
        patch.optimized_date = null;
      }
    }

    const { error } = await supabase.from("account_bindings").upsert(patch, { onConflict: "user_id,ad_account_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
