import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Etapa 71: últimos envios de boleto, pra mostrar uma listinha de histórico
// em Controle de Saldo (o que foi mandado, pra quem, quando e se deu certo).
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("boleto_sends")
      .select("id, ad_account_id, client_name, due_date, pdf_file_name, status, error, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(15);
    if (error) throw error;
    return NextResponse.json({ sends: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
