import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("account_bindings")
      .select("*")
      .eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ bindings: data ?? [] });
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

    const { error } = await supabase.from("account_bindings").upsert(patch, { onConflict: "user_id,ad_account_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
