import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { hojeDaConta } from "@/lib/estrategia/hoje-conta";
import { readStoredDaysMany, normAccountId } from "@/lib/meta/daily-store";
import { addDaysYmd, todayBrt } from "@/lib/meta/daily-range";
import type { DailyCpaPoint } from "@/lib/meta/daily-cpa";
import { withLiveCache, liveMaxAge } from "@/lib/meta/live-cache";

// Etapa 309: botão "Atualizar" do Acompanhamento = só as métricas de HOJE.
//   - dias fechados: do backup no Supabase (nenhum pedido à Meta)
//   - hoje: 1 pedido à Meta por conta (insights de hoje por conjunto, já com o objetivo da campanha — sem buscar a lista de campanhas)
// Antes o Atualizar fazia ~11 pedidos por conta (lista de campanhas, dias que faltavam, orçamento, alertas, nomenclatura).
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json().catch(() => ({}))) as { accountIds?: unknown; days?: unknown; force?: unknown };
    const ids = (Array.isArray(body.accountIds) ? body.accountIds : []).map((x) => normAccountId(String(x))).filter(Boolean).slice(0, 15);
    const days = Math.max(1, Math.min(62, Number(body.days) || 1));
    const today = todayBrt();
    const since = addDaysYmd(today, -(days - 1));
    const yesterday = addDaysYmd(today, -1);

    const stored = since <= yesterday ? await readStoredDaysMany(ids, since, yesterday) : new Map();
    const maxAge = liveMaxAge(body.force);
    type Dia = { spend: number; results: number };
    // Etapa 350: hoje sai do guardado compartilhado (Supabase) quando é recente; só vai à Meta a conta com número velho.
    const runPool = async (list: string[], fn: (id: string) => Promise<Dia>) => {
      const out = new Map<string, Dia>();
      const failed: string[] = [];
      let next = 0;
      const worker = async () => {
        while (next < list.length) {
          const id = list[next++];
          try {
            out.set(id, await fn(id));
          } catch (e) {
            failed.push(id);
            console.error("hoje err", id, (e as Error).message);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(5, list.length) }, worker));
      return { data: out, failed };
    };
    const live = await withLiveCache<Dia>(supabase, user.id, "hoje", ids, maxAge, (miss) => runPool(miss, (id) => hojeDaConta(token, id)));
    const hoje = live.data;
    const failed: string[] = [...live.failed];
    // Etapa 317: backup ainda sem ontem (rotina da noite não terminou) → busca ontem na Meta também (também guardado)
    const semOntem = since <= yesterday ? ids.filter((id) => !stored.get(id)?.has(yesterday)) : [];
    const ontemLive = semOntem.length
      ? await withLiveCache<Dia>(supabase, user.id, "ontem", semOntem, maxAge, (miss) =>
          runPool(miss, (id) => hojeDaConta(token, id, yesterday)),
        )
      : null;
    const ontemVivo = ontemLive?.data ?? new Map<string, Dia>();
    const ats = [...live.at.values()];

    const daily: Record<string, DailyCpaPoint[]> = {};
    for (const id of ids) {
      const guardados = stored.get(id);
      const pts: DailyCpaPoint[] = [];
      for (let d = since; d <= yesterday; d = addDaysYmd(d, 1)) {
        const v = guardados?.get(d) ?? (d === yesterday ? ontemVivo.get(id) : undefined);
        pts.push({ date: d, spend: v?.spend ?? 0, results: v?.results ?? 0, cpa: v && v.results > 0 && v.spend > 0 ? v.spend / v.results : null });
      }
      const h = hoje.get(id) ?? { spend: 0, results: 0 };
      pts.push({ date: today, spend: h.spend, results: h.results, cpa: h.results > 0 && h.spend > 0 ? h.spend / h.results : null });
      daily[id] = pts;
    }
    return NextResponse.json({ daily, failed, oldestAt: ats.length ? Math.min(...ats) : Date.now(), fetched: live.fetched });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
