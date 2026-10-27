import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Etapa 190: "Registro das automações" (Auditoria → Alertas). Lista as rodadas gravadas em
// automation_runs — inclusive as que verificaram e não mexeram em nada.
// Filtros opcionais: ?automation=creatives-pause&status=changed|no-change|error&from=ISO&to=ISO
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const p = new URL(request.url).searchParams;
    let q = supabase
      .from("automation_runs")
      .select("id, automation, status, summary, details, started_at, finished_at")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(Math.min(3000, Math.max(1, Number(p.get("limit")) || 500))); // Etapa 215: a visão "Automações" pede mais (última rodada de cada uma)
    const automation = p.get("automation");
    const status = p.get("status");
    const from = p.get("from");
    const to = p.get("to");
    if (automation) q = q.eq("automation", automation);
    if (status === "changed" || status === "no-change" || status === "error") q = q.eq("status", status);
    if (from) q = q.gte("started_at", from);
    if (to) q = q.lte("started_at", to);
    const { data, error } = await q;
    if (error) {
      if (/automation_runs/.test(error.message) && /does not exist|schema cache/i.test(error.message)) {
        throw new Error("Rode o SQL supabase/migrations/0037_automation_runs.sql no Supabase pra ativar o registro das automações.");
      }
      throw error;
    }
    return NextResponse.json({ runs: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
