import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Lista as demandas do usuário — ordenação de verdade acontece no cliente
// (sort_order manual quando existe, senão requested_at crescente/mais
// antiga primeiro), igual ao padrão de rowSortKey de Acompanhamento.
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("demands").select("*").eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ demands: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
