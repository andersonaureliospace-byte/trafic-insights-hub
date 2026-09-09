import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Reordenação em massa (drag-and-drop) da tabela de Acompanhamento — grava
// sort_order pelo índice de cada conta na lista recebida, sempre atrelado ao
// usuário logado no Supabase (nunca em localStorage/sessionStorage: precisa
// valer igual em qualquer navegador que o usuário abra).
export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const order: unknown = body.order;
    if (!Array.isArray(order) || order.length === 0) throw new Error("order é obrigatório.");

    const now = new Date().toISOString();
    const rows = order.map((ad_account_id, index) => ({
      user_id: user.id,
      ad_account_id: String(ad_account_id),
      sort_order: index,
      updated_at: now,
    }));

    const { error } = await supabase.from("account_bindings").upsert(rows, { onConflict: "user_id,ad_account_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
