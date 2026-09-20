import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Histórico de gerações — sempre filtrado por cliente (pedido explícito:
// "quer histórico de copies agrupado por cliente").
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const { searchParams } = new URL(request.url);
    const ad_account_id = (searchParams.get("ad_account_id") ?? "").trim();
    if (!ad_account_id) throw new Error("ad_account_id é obrigatório.");

    const { data, error } = await supabase
      .from("copy_generations")
      .select("*")
      .eq("user_id", user.id)
      .eq("ad_account_id", ad_account_id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    return NextResponse.json({ generations: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
