import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { checkAndUpdateBulkStatus } from "@/lib/alerts/bulk-status-update";

// Sem GET/preview de propósito — mesmo motivo de creatives-pause/adsets-pause/
// budget-increase: o check já escreve o novo status (e reordena o quadro) de
// verdade, só o botão manual (POST) existe. Não confundir com o diálogo
// "Atualizar status em massa" de Acompanhamento (components/painel/bulk-
// status-dialog.tsx) — aquele trabalha só com as contas filtradas na tela e
// não reordena o quadro; esse aqui roda com TODAS as "Contas exibidas" e
// também mexe no sort_order.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    // Etapa 305: { until: "2026-11-08" } refaz com os 3 dias que terminam nessa data (ex.: rodada de segunda).
    const body = (await request.json().catch(() => ({}))) as { until?: string };
    const { results, sendError, asana } = await checkAndUpdateBulkStatus(supabase, user.id, token, { send: true, until: body.until });
    return NextResponse.json({ results, sendError, asana });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
