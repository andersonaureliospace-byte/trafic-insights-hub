import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data } = await supabase
      .from("user_meta_credentials")
      .select("access_token, default_ad_account_id")
      .eq("user_id", user.id)
      .maybeSingle();
    return NextResponse.json({
      access_token: data?.access_token ?? "",
      default_ad_account_id: data?.default_ad_account_id ?? "",
    });
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const access_token = String(body.access_token ?? "").trim();
    const default_ad_account_id = String(body.default_ad_account_id ?? "").trim();

    const { error } = await supabase
      .from("user_meta_credentials")
      .upsert(
        { user_id: user.id, access_token, default_ad_account_id, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
