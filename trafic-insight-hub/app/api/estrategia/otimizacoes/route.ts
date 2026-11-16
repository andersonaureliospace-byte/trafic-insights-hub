import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { activitiesForAccounts } from "@/lib/estrategia/activities";

// Etapa 324: só o histórico de otimizações (última mudança do gestor por conta) — vai junto do botão Atualizar e de abrir
// a aba Ontem × hoje. Normalmente 1 pedido por conta (últimas 24h; sem otimização nelas, olha 7 dias).
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json().catch(() => ({}))) as { accountIds?: unknown };
    const norm = (id: string) => id.replace(/^act_/, "");
    const ids = (Array.isArray(body.accountIds) ? body.accountIds : []).map((x) => norm(String(x))).filter(Boolean).slice(0, 60);
    const acts = await activitiesForAccounts(token, ids);
    return NextResponse.json({
      activities: Object.fromEntries(Object.entries(acts.byAccount).map(([k, v]) => [norm(k), v])),
      failed: acts.failed.map(norm),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
