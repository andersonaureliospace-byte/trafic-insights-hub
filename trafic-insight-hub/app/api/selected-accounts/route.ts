import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("user_selected_accounts")
      .select("ad_account_id, sort_order")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ accountIds: (data ?? []).map((r) => r.ad_account_id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const accountIds = (body.accountIds ?? []) as string[];

    // Substitui a lista inteira — mais simples que fazer diff.
    const { error: delErr } = await supabase.from("user_selected_accounts").delete().eq("user_id", user.id);
    if (delErr) throw delErr;

    if (accountIds.length > 0) {
      const rows = accountIds.map((ad_account_id, i) => ({
        user_id: user.id,
        ad_account_id,
        sort_order: i,
      }));
      const { error: insErr } = await supabase.from("user_selected_accounts").insert(rows);
      if (insErr) throw insErr;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
