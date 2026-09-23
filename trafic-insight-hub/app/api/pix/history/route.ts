import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Etapa 73: últimos envios de Pix por WhatsApp, pra listinha de histórico em
// Controle de Saldo — mesmo padrão de app/api/boletos/history/route.ts.
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("pix_sends")
      .select(
        "id, ad_account_id, client_name, target_type, target_label, scheduled_at, status, error, created_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(15);
    if (error) throw error;
    return NextResponse.json({ sends: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
