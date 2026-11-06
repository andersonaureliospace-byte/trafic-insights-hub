import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createServiceClient } from "@/lib/supabase/server";
import { loadCarteira, runTick } from "@/lib/estrategia/auditorias/run";

// Etapa 257: tela Automações → Auditorias.
//   GET  → últimas rodadas, itens na fila (ainda não enviados) e quantas contas tem a carteira
//   POST { action: "digest-now" } → manda agora o que está na fila (sem rodar nenhuma conferência)
export const maxDuration = 60;

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const [runs, pending, carteira] = await Promise.all([
      supabase.from("estr_audit_runs").select("slot, check_id, lot, accounts, meta_calls, found, error, ran_at").eq("user_id", user.id).order("ran_at", { ascending: false }).limit(80),
      supabase.from("estr_digest_items").select("id, check_id, client_name, responsible, line, group_name, created_at").eq("user_id", user.id).is("sent_at", null).order("created_at", { ascending: false }).limit(300),
      loadCarteira(supabase as never, user.id),
    ]);
    if (runs.error) {
      if (/estr_audit_runs/.test(runs.error.message)) throw new Error("Rode o SQL supabase/migrations/0044_auditorias_estrategicas.sql no Supabase.");
      throw runs.error;
    }
    return NextResponse.json({ runs: runs.data ?? [], pending: pending.data ?? [], accounts: carteira.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "digest-now") throw new Error("Ação desconhecida.");
    // minute fora da agenda (-1): não roda conferência nenhuma, só o resumo.
    const report = await runTick(createServiceClient(), user.id, { minute: -1, forceDigest: true });
    return NextResponse.json({ ok: true, digest: report.digest });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
