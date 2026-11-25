import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { ASANA_CONFIG_KEY, loadAsanaScope } from "@/lib/asana/scope";

// Etapa 353: Asana de cada estrategista — token (Personal Access Token) + nome que aparece nas seções dele.
// O token nunca volta pro navegador; só "configurado" e os 4 últimos caracteres.
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data } = await supabase.from("user_ui_prefs").select("pref_value").eq("user_id", user.id).eq("pref_key", ASANA_CONFIG_KEY).maybeSingle();
    const v = (data?.pref_value ?? {}) as { token?: string; secao?: string };
    const scope = await loadAsanaScope(supabase as never, user.id);
    return NextResponse.json({
      secao: v.secao ?? "",
      tokenFim: v.token ? v.token.slice(-4) : null,
      usandoVercel: !v.token && scope.isMaster && !!scope.token,
      isMaster: scope.isMaster,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { token?: string; secao?: string; limparToken?: boolean };
    const { data } = await supabase.from("user_ui_prefs").select("pref_value").eq("user_id", user.id).eq("pref_key", ASANA_CONFIG_KEY).maybeSingle();
    const atual = (data?.pref_value ?? {}) as { token?: string; secao?: string };
    const next = {
      token: body.limparToken ? "" : typeof body.token === "string" && body.token.trim() ? body.token.trim() : (atual.token ?? ""),
      secao: typeof body.secao === "string" ? body.secao.trim().slice(0, 60) : (atual.secao ?? ""),
    };
    const { error } = await supabase
      .from("user_ui_prefs")
      .upsert({ user_id: user.id, pref_key: ASANA_CONFIG_KEY, pref_value: next }, { onConflict: "user_id,pref_key" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
