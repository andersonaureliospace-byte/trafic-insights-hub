import { NextResponse } from "next/server";
import { getHubCtx, allowedIds } from "@/lib/hub-context";
import { getAccountsInsights } from "@/lib/meta/insights";
import { withLiveCache, liveMaxAge, toObj } from "@/lib/meta/live-cache";

// Etapa 350: investimento diário atual (orçamento do dia de tudo que está ligado) do Hub estratégico, com o guardado
// compartilhado: só vai à Meta a conta cujo orçamento guardado está velho (15 min automático / 3 min no botão).
// Antes a tela chamava /api/meta/insights direto, e cada tela aberta buscava tudo de novo.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const ctx = await getHubCtx(); // Etapa 352: gestor → só as contas dele
    const token = await ctx.token();
    const body = (await request.json().catch(() => ({}))) as { accountIds?: unknown; force?: unknown };
    const ids = allowedIds(ctx, (Array.isArray(body.accountIds) ? body.accountIds : []).map((x) => String(x))).slice(0, 15);
    const live = await withLiveCache<number>(ctx.db, ctx.ownerId, "orc", ids, liveMaxAge(body.force), async (miss) => {
      const ins = await getAccountsInsights(token, miss.map((id) => `act_${id}`), "today");
      const data = new Map<string, number>();
      const failed: string[] = [];
      for (const id of miss) {
        const x = ins[`act_${id}`];
        if (x && !x.budget_failed && typeof x.daily_budget === "number") data.set(id, x.daily_budget);
        else failed.push(id);
      }
      return { data, failed };
    });
    return NextResponse.json({ budgets: toObj(live.data), failed: live.failed, fetched: live.fetched });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
