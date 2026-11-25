import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { GRAVADOR_KEY_PREF } from "@/lib/feedbacks/gravador-auth";

// Etapa 353: chave pessoal do gravador (extensão do Chrome). Com ela, os feedbacks gravados vão pra carteira de quem gravou.
// GET → a chave atual (ou null) · POST → gera uma nova (a antiga para de funcionar)
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data } = await supabase.from("user_ui_prefs").select("pref_value").eq("user_id", user.id).eq("pref_key", GRAVADOR_KEY_PREF).maybeSingle();
    const key = (data?.pref_value as { key?: string } | null)?.key ?? null;
    return NextResponse.json({ key });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const key = `gk_${randomBytes(18).toString("base64url")}`;
    const { error } = await supabase
      .from("user_ui_prefs")
      .upsert({ user_id: user.id, pref_key: GRAVADOR_KEY_PREF, pref_value: { key } }, { onConflict: "user_id,pref_key" });
    if (error) throw error;
    return NextResponse.json({ key });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
