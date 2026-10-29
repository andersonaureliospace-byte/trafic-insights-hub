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
    // em BRT — de um dia pro outro, a leitura já devolve não-otimizado de
    // novo sem precisar apagar nada no banco.
    const todayBRT = spDate(new Date());
    // Etapa 83: a coluna Otimizado de Acompanhamento de metas tem a própria
    // marcação (tab_optimized), com a mesma regra de reset diário e sem nenhuma
    // ligação com a de Acompanhamento.
    const bindings = (data ?? []).map((b) => ({
      ...b,
      optimized: b.optimized && b.optimized_date === todayBRT,
      tab_optimized: !!b.tab_optimized && b.tab_optimized_date === todayBRT,
      // Etapa 226: "Otimizar" (não reseta à meia-noite). Se já está Otimizado hoje, vale o Otimizado.
      to_optimize: !!b.to_optimize && !(b.optimized && b.optimized_date === todayBRT),
    }));
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

    // Etapa 131: cliente ativo/desativado (padrão = ativo). Só booleano.
    if ("active" in body) patch.active = body.active !== false;

    // "Otimizado" tem regra própria (não entra no loop genérico acima): é só
    // um liga/desliga, sem motivo — a data de referência é sempre calculada
    // aqui no servidor (nunca confia na data que o navegador mandaria) — é
    // ela que a leitura usa pra saber se a marcação ainda vale hoje.
    if ("optimized" in body) {
      const optimized = !!body.optimized;
      patch.optimized = optimized;
      patch.optimized_date = optimized ? spDate(new Date()) : null;
    }

    // Etapa 226: 3º estado "Otimizar". Marcar Otimizar tira o Otimizado (e vice-versa, quem manda os dois é a tela).
    if ("to_optimize" in body) {
      patch.to_optimize = !!body.to_optimize;
      if (body.to_optimize) {
        patch.optimized = false;
        patch.optimized_date = null;
      }
    }

    // Etapa 83: marcação da coluna Otimizado de Acompanhamento de metas — mesma
    // regra, colunas próprias.
    if ("tab_optimized" in body) {
      const tabOptimized = !!body.tab_optimized;
      patch.tab_optimized = tabOptimized;
      patch.tab_optimized_date = tabOptimized ? spDate(new Date()) : null;
    }

    const { error } = await supabase.from("account_bindings").upsert(patch, { onConflict: "user_id,ad_account_id" });
    if (error) {
      if (/to_optimize/.test(error.message)) {
        throw new Error("Rode o SQL supabase/migrations/0040_to_optimize.sql no Supabase pra ativar o \"Otimizar\".");
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
