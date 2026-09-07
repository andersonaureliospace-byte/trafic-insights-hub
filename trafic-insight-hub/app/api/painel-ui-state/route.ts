import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Etapa 39: lembrar em qual aba do Painel (e com quais filtros) o usuário
// estava antes de dar F5 — hoje sempre volta pra Visão Geral, do zero.
// Reaproveita a mesma tabela genérica de preferências (user_ui_prefs) já
// usada por grupos de foco e rótulos de prioridade, com uma chave própria —
// nunca localStorage/sessionStorage, pra valer igual em qualquer navegador/
// computador que o usuário use (mesmo critério da reordenação por
// arrastar-e-soltar em Acompanhamento).
const PREF_KEY = "painel_ui_state";

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
    return NextResponse.json({ state: data?.pref_value ?? {} });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// Mescla só as chaves de topo (tab, acompanhamento, analise, visaoGeral) —
// cada uma delas é sempre mandada por inteiro por quem chama, então não
// precisa de merge profundo.
export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const patch = body.patch ?? {};

    const { data: current } = await supabase
      .from("user_ui_prefs")
      .select("pref_value")
      .eq("user_id", user.id)
      .eq("pref_key", PREF_KEY)
      .maybeSingle();

    const next = { ...(current?.pref_value ?? {}), ...patch };

    const { error } = await supabase.from("user_ui_prefs").upsert(
      {
        user_id: user.id,
        pref_key: PREF_KEY,
        pref_value: next,
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
