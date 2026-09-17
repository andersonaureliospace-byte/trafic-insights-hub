import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Reordenação manual (arrastar-e-soltar) da lista de Demandas — mesmo padrão
// de account-bindings/reorder: grava sort_order pelo índice de cada demanda
// na lista recebida. Antes da 1ª vez que isso roda, a ordem padrão é
// requested_at crescente (mais antiga primeiro) — ver demandas-tab.tsx.
export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const order: unknown = body.order;
    if (!Array.isArray(order) || order.length === 0) throw new Error("order é obrigatório.");

    for (let index = 0; index < order.length; index++) {
      const { error } = await supabase
        .from("demands")
        .update({ sort_order: index })
        .eq("id", String(order[index]))
        .eq("user_id", user.id);
      if (error) throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
