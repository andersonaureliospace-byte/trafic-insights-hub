import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { SWITCHES_PREF_KEY } from "@/lib/automation-switches";
import { AUDIT_PREF_KEY } from "@/lib/estrategia/auditorias/config";

// Etapa 238: preferências do Hub estratégico, guardadas no Supabase (user_ui_prefs) pra valer igual em qualquer navegador.
//   estrategia_ui       = filtros da tela (responsável, período do CPA, ordenação)
//   gestores            = lista de responsáveis (nomes) usada na ficha do cliente e no filtro
//   automation_switches = liga/pausa das automações (lib/automation-switches.ts)
//   offer_flags         = por conta: { exame: bool, promo: bool } — se a conta anuncia EXAME / PROMO (Etapa 242/260)
//   estr_auditorias     = configuração das Auditorias (Etapa 257)
//   contas_sensiveis    = por conta: true — conta sensível, otimizar até as 09h (Etapa 261)
const KEYS = new Set(["estrategia_ui", "gestores", "offer_flags", SWITCHES_PREF_KEY, AUDIT_PREF_KEY, "contas_sensiveis"]);

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!KEYS.has(key)) throw new Error("Preferência desconhecida.");
    const { data, error } = await supabase
      .from("user_ui_prefs")
      .select("pref_value")
      .eq("user_id", user.id)
      .eq("pref_key", key)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ value: data?.pref_value ?? null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as { key?: string; value?: unknown };
    const key = body.key ?? "";
    if (!KEYS.has(key)) throw new Error("Preferência desconhecida.");
    const { error } = await supabase
      .from("user_ui_prefs")
      .upsert({ user_id: user.id, pref_key: key, pref_value: body.value ?? null }, { onConflict: "user_id,pref_key" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
