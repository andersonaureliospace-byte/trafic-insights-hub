import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { activitiesForAccounts, type ActivityItem } from "@/lib/estrategia/activities";
import { withLiveCache, liveMaxAge, toObj } from "@/lib/meta/live-cache";

// Etapa 324: só o histórico de otimizações (última mudança do gestor por conta) — vai junto do botão Atualizar e de abrir
// a aba Ontem × hoje. Normalmente 1 pedido por conta (últimas 24h; sem otimização nelas, olha 7 dias).
// Etapa 350: com o guardado compartilhado — só vai à Meta a conta com histórico velho (15 min automático / 3 min no botão).
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json().catch(() => ({}))) as { accountIds?: unknown; force?: unknown };
    const norm = (id: string) => id.replace(/^act_/, "");
    const ids = (Array.isArray(body.accountIds) ? body.accountIds : []).map((x) => norm(String(x))).filter(Boolean).slice(0, 60);
    const live = await withLiveCache<ActivityItem[]>(supabase, user.id, "otim", ids, liveMaxAge(body.force), async (miss) => {
      const acts = await activitiesForAccounts(token, miss);
      return { data: new Map(Object.entries(acts.byAccount).map(([k, v]) => [norm(k), v])), failed: acts.failed.map(norm) };
    });
    return NextResponse.json({ activities: toObj(live.data), failed: live.failed, fetched: live.fetched });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
