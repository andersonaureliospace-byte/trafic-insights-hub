import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("public_dashboards")
      .select("ad_account_id, account_name, public_token")
      .eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ dashboards: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// Gera (ou retorna, se já existir) o token público /d/:token da conta.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const ad_account_id = String(body.ad_account_id ?? "").trim();
    const account_name = body.account_name ? String(body.account_name) : null;
    if (!ad_account_id) throw new Error("ad_account_id é obrigatório.");

    const { data: existing } = await supabase
      .from("public_dashboards")
      .select("public_token")
      .eq("user_id", user.id)
      .eq("ad_account_id", ad_account_id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ public_token: existing.public_token });
    }

    const { data, error } = await supabase
      .from("public_dashboards")
      .insert({ user_id: user.id, ad_account_id, account_name })
      .select("public_token")
      .single();
    if (error) throw error;
    return NextResponse.json({ public_token: data.public_token });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const { searchParams } = new URL(request.url);
    const ad_account_id = searchParams.get("ad_account_id");
    if (!ad_account_id) throw new Error("ad_account_id é obrigatório.");
    const { error } = await supabase
      .from("public_dashboards")
      .delete()
      .eq("user_id", user.id)
      .eq("ad_account_id", ad_account_id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
