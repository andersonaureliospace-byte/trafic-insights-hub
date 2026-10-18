import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { buildMorningSummary, summaryAccountIds } from "@/lib/alerts/morning-summary";
import { MIN_POINTS } from "@/lib/alerts/priority-score";
import { readAttentionSnapshot } from "@/lib/alerts/attention-snapshot";

// Etapa 137: prévia do Resumo das 7h pela sessão do usuário. GET = só mostra o texto (não envia nada);
// POST = monta e envia agora pro grupo + aba Alertas (igual ao hook das 7h).
export const maxDuration = 60;
const BATCH = 12; // contas por lote ao recalcular a lista de pontos

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const params = new URL(request.url).searchParams;
    // ?todas=1 → lista simples (texto) com os pontos das contas, pra analisar onde colocar o corte. Lê a última lista guardada
    // (instantâneo, sem buscar na Meta). Com &recalcular=1&lote=1 (2, 3…) refaz na Meta, 12 contas por vez.
    if (params.get("todas") && !params.get("recalcular")) {
      const snap = await readAttentionSnapshot(supabase, user.id);
      const list = Object.entries(snap.accounts).sort((a, b) => b[1].points - a[1].points);
      const names = await clientNames(supabase, user.id);
      const when = snap.at ? new Date(snap.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "nunca";
      const lines = list.map(([id, v]) => `${String(v.points).padStart(2, " ")} pts | ${names.get(id) ?? id} | ${v.reasons.join(", ") || "—"}`);
      const head = `Última lista guardada (${when}): ${list.length} contas com pontos; mínimo atual ${MIN_POINTS} pts → ${list.filter(([, v]) => v.points >= MIN_POINTS).length} contas`;
      return new Response(`${head}\n\n${lines.join("\n")}\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const token = await getUserMetaToken(supabase, user.id);
    // &recalcular=1 → busca na Meta em lotes de 12 contas (?lote=1, 2, 3…), guardando cada lote; assim não passa dos 60 s.
    if (params.get("todas") && params.get("recalcular")) {
      const ids = await summaryAccountIds(supabase, user.id);
      const total = Math.max(1, Math.ceil(ids.length / BATCH));
      const lote = Math.min(total, Math.max(1, Number(params.get("lote")) || 1));
      const only = ids.slice((lote - 1) * BATCH, lote * BATCH);
      const r = await buildMorningSummary(supabase, user.id, token, { send: false, only });
      const lines = r.all.map((a) => `${String(a.points).padStart(2, " ")} pts | ${a.name} | ${a.reasons.join(", ") || "—"}`);
      const next =
        lote < total
          ? `Próximo: troque no endereço lote=${lote} por lote=${lote + 1}`
          : `Último lote. Agora abra o endereço sem "&recalcular=1&lote=${lote}" (só ?todas=1) pra ver a lista completa.`;
      const fail = r.failedSignals.length ? ` — não carregou: ${r.failedSignals.join(", ")} (lote não guardado; tente de novo)` : "";
      return new Response(`Lote ${lote} de ${total} (${only.length} contas) guardado${fail}\n${next}\n\n${lines.join("\n")}\n`, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const { text, ranked, all, failedSignals } = await buildMorningSummary(supabase, user.id, token, { send: false });
    if (params.get("todas")) {
      const lines = all.map((a) => `${String(a.points).padStart(2, " ")} pts | ${a.name} | ${a.reasons.join(", ") || "—"}`);
      const head = `Pontos de ${all.length} contas (mínimo atual: ${MIN_POINTS} pts → ${ranked.length} contas)${failedSignals.length ? ` — não carregou: ${failedSignals.join(", ")}` : ""}`;
      return new Response(`${head}\n\n${lines.join("\n")}\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return NextResponse.json({ text, accounts: ranked.length, failedSignals });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// id da conta (sem "act_") → nome do cliente
async function clientNames(db: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string) {
  const { data } = await db.from("account_bindings").select("ad_account_id, client_name").eq("user_id", userId);
  return new Map((data ?? []).map((b) => [String(b.ad_account_id).replace(/^act_/, ""), (b.client_name as string | null) ?? ""]));
}

export async function POST() {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const { text, ranked, failedSignals, sendError } = await buildMorningSummary(supabase, user.id, token, { send: true });
    return NextResponse.json({ text, accounts: ranked.length, failedSignals, sendError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
