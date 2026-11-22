import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { calendarSP } from "@/lib/estrategia/calc";
import { loadCarteira } from "@/lib/estrategia/auditorias/run";
import { addDaysYmd, weekdayOf } from "@/lib/estrategia/demandas";
import { lerAgendados } from "@/lib/feedbacks/agendados";

// Etapa 340: aba Feedback (substituiu o calendário de Demandas). Devolve a carteira, os feedbacks enviados nesta semana
// (segunda a domingo, horário de Brasília) e os feedbacks com envio programado. As colunas (Pendentes / Enviados /
// Programados) e a meta da semana são calculadas na tela, com a prioridade e a marcação de sensível de agora.
const norm = (id: string) => String(id ?? "").replace(/^act_/, "").trim();

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const hoje = calendarSP().today;
    const wd = weekdayOf(hoje); // 0 = domingo
    const segunda = addDaysYmd(hoje, -((wd + 6) % 7));
    // Brasília é UTC-3 o ano todo: segunda 00:00 em Brasília = segunda 03:00 UTC
    const desde = `${segunda}T03:00:00.000Z`;

    const [carteira, sensRow, enviados, agendados] = await Promise.all([
      loadCarteira(supabase, user.id),
      supabase.from("user_ui_prefs").select("pref_value").eq("user_id", user.id).eq("pref_key", "contas_sensiveis").maybeSingle(),
      supabase.from("client_feedbacks").select("id, ad_account_id, sent_at").eq("user_id", user.id).eq("status", "enviado").gte("sent_at", desde).limit(3000),
      lerAgendados(supabase as never, user.id),
    ]);
    if (enviados.error) throw enviados.error;
    const sens = (sensRow.data?.pref_value && typeof sensRow.data.pref_value === "object" ? sensRow.data.pref_value : {}) as Record<string, boolean>;

    // programados: só os que ainda não saíram
    let programados: Array<{ id: string; ad_account_id: string; quando: string }> = [];
    if (agendados.length) {
      const { data } = await supabase
        .from("client_feedbacks")
        .select("id, ad_account_id, status")
        .eq("user_id", user.id)
        .in(
          "id",
          agendados.map((a) => a.id),
        );
      const byId = new Map((data ?? []).map((f) => [f.id as string, f]));
      programados = agendados
        .filter((a) => byId.get(a.id) && byId.get(a.id)?.status !== "enviado")
        .map((a) => ({ id: a.id, ad_account_id: norm(byId.get(a.id)?.ad_account_id as string), quando: a.quando }));
    }

    return NextResponse.json({
      hoje,
      segunda,
      clientes: carteira.map((a) => ({
        id: a.id,
        name: a.name,
        responsible: a.responsible,
        priority: a.priority,
        sensivel: !!(sens[a.id] || sens[`act_${a.id}`]),
      })),
      enviados: (enviados.data ?? []).map((f) => ({ id: f.id as string, ad_account_id: norm(f.ad_account_id as string), sent_at: f.sent_at as string })),
      programados,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
