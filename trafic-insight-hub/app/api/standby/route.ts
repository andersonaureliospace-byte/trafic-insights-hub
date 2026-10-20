import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Etapa 158: lista dos conjuntos em standby (orçamento reduzido no fim de semana, voltam pra R$15 na segunda 05h).
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("weekend_standby")
      .select("adset_id, ad_account_id, client_name, adset_name, kind, reason, from_budget, to_budget, started_at")
      .eq("user_id", user.id)
      .is("released_at", null)
      .order("client_name", { ascending: true })
      .order("started_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: `${error.message} — rode a migration 0034_pause_backup_and_standby.sql no Supabase.` }, { status: 400 });
    }
    return NextResponse.json({ items: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
