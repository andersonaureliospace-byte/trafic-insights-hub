import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

const PREF_KEY = "focus_groups";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("user_ui_prefs")
      .select("pref_value")
      .eq("user_id", user.id)
      .eq("pref_key", PREF_KEY)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ groups: data?.pref_value ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// Substitui a lista inteira de grupos de foco — mais simples que diff.
export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const groups = body.groups ?? [];

    const { error } = await supabase.from("user_ui_prefs").upsert(
      {
        user_id: user.id,
        pref_key: PREF_KEY,
        pref_value: groups,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,pref_key" },
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
