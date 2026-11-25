import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { AUDIT_PREF_KEY, normalizeConfig, type GroupRef } from "@/lib/estrategia/auditorias/config";

// Etapa 353: destinos dos avisos automáticos do ESTRATEGISTA (as regras e horários são do master, em Automações):
// grupo padrão do WhatsApp e o WhatsApp dele. Grava só esses dois campos na configuração dele.
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data } = await supabase.from("user_ui_prefs").select("pref_value").eq("user_id", user.id).eq("pref_key", AUDIT_PREF_KEY).maybeSingle();
    const c = normalizeConfig(data?.pref_value);
    return NextResponse.json({ defaultGroup: c.defaultGroup, myWhatsapp: c.myWhatsapp ?? "" });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { defaultGroup?: GroupRef | null; myWhatsapp?: string };
    const { data } = await supabase.from("user_ui_prefs").select("pref_value").eq("user_id", user.id).eq("pref_key", AUDIT_PREF_KEY).maybeSingle();
    const atual = normalizeConfig(data?.pref_value);
    const g = body.defaultGroup;
    const next = {
      ...atual,
      defaultGroup: g && typeof g.id === "string" && g.id ? { id: g.id, name: String(g.name ?? "") } : null,
      myWhatsapp: String(body.myWhatsapp ?? "").replace(/\D/g, "") || null,
    };
    const { error } = await supabase
      .from("user_ui_prefs")
      .upsert({ user_id: user.id, pref_key: AUDIT_PREF_KEY, pref_value: next }, { onConflict: "user_id,pref_key" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
