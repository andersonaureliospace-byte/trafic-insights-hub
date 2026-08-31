import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("pix_accounts").select("*").eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ pixAccounts: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const ad_account_id = String(body.ad_account_id ?? "").trim();
    if (!ad_account_id) throw new Error("ad_account_id é obrigatório.");

    const patch: Record<string, unknown> = { user_id: user.id, ad_account_id, updated_at: new Date().toISOString() };
    for (const key of ["payment_type", "base_amount", "notes"]) {
      if (key in body) patch[key] = body[key];
    }

    const { error } = await supabase.from("pix_accounts").upsert(patch, { onConflict: "user_id,ad_account_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
