// Mapeamento de vídeos de GERAL por conta (Etapa 160). Pra cada conta: quais vídeos do banco existem, em quantos anúncios/conjuntos
// estão ATIVOS agora, quando foi o último anúncio criado e o desempenho (gasto/conversas) no mês, nos últimos 7 e 30 dias.
// Só LÊ da Meta. A leitura é por conta; quem junta tudo (rede de contas, situação de cada vídeo) é lib/meta/video-summary.ts.

import { metaGetAll } from "./client";
import { addDaysYmd, todayBrt } from "./daily-range";
import { getCreativeCostAnalysis } from "./creative-analysis";
import { memoMeta, tokenTag } from "./memo";
import { matchVideo } from "./video-bank";

export interface Period {
  spend: number;
  conv: number;
}

export interface AccountVideoStat {
  key: string;
  label: string;
  inBank: boolean;
  totalAds: number; // anúncios com esse vídeo (qualquer status) — "já foi usado nesta conta"
  activeAds: number;
  activeAdsets: number;
  lastCreated: string | null; // ISO do anúncio mais novo
  month: Period;
  d7: Period;
  d30: Period;
}

interface AdRow {
  id?: string;
  name?: string;
  effective_status?: string;
  created_time?: string;
  adset_id?: string;
}

async function listGeralAds(token: string, id: string): Promise<AdRow[]> {
  return memoMeta(`video-ads:${tokenTag(token)}:${id}`, 120_000, async () => {
    const fields = "id,name,effective_status,created_time,adset_id";
    try {
      return await metaGetAll<AdRow>(
        token,
        `/${id}/ads`,
        { fields, limit: "500", filtering: JSON.stringify([{ field: "name", operator: "CONTAIN", value: "GERAL" }]) },
        10,
      );
    } catch {
      // Sem o filtro por nome (a Meta recusou): traz tudo e filtra aqui.
      return metaGetAll<AdRow>(token, `/${id}/ads`, { fields, limit: "500" }, 10);
    }
  });
}

// Os números vão até ONTEM (dia fechado) — os de hoje ainda estão mudando e não entram. Só o "ativo agora"/último uso é do momento do cálculo.
export function videoRanges(now: Date = new Date()) {
  const today = todayBrt(now);
  const yesterday = addDaysYmd(today, -1);
  const monthStart = `${today.slice(0, 8)}01`;
  return {
    yesterday,
    month: monthStart <= yesterday ? { since: monthStart, until: yesterday } : null, // dia 1º: ainda não há dia fechado no mês
    d7: { since: addDaysYmd(yesterday, -6), until: yesterday },
    d30: { since: addDaysYmd(yesterday, -29), until: yesterday },
  };
}

export async function getAccountVideoStats(token: string, accountId: string, now: Date = new Date()): Promise<AccountVideoStat[]> {
  const id = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const r = videoRanges(now);
  const [ads, month, d7, d30] = await Promise.all([
    listGeralAds(token, id),
    r.month ? getCreativeCostAnalysis(token, accountId, r.month) : Promise.resolve([]),
    getCreativeCostAnalysis(token, accountId, r.d7),
    getCreativeCostAnalysis(token, accountId, r.d30),
  ]);

  const map = new Map<string, AccountVideoStat & { _adsets: Set<string> }>();
  const get = (m: { key: string; label: string; inBank: boolean }) => {
    let s = map.get(m.key);
    if (!s) {
      s = {
        key: m.key,
        label: m.label,
        inBank: m.inBank,
        totalAds: 0,
        activeAds: 0,
        activeAdsets: 0,
        lastCreated: null,
        month: { spend: 0, conv: 0 },
        d7: { spend: 0, conv: 0 },
        d30: { spend: 0, conv: 0 },
        _adsets: new Set<string>(),
      };
      map.set(m.key, s);
    }
    return s;
  };

  for (const a of ads) {
    if (!a.name) continue;
    const m = matchVideo(a.name);
    if (!m || !m.inBank) continue; // fora do banco: ignorado
    const s = get(m);
    s.totalAds++;
    if ((a.effective_status ?? "").toUpperCase() === "ACTIVE") {
      s.activeAds++;
      if (a.adset_id) s._adsets.add(a.adset_id);
    }
    if (a.created_time && (!s.lastCreated || a.created_time > s.lastCreated)) s.lastCreated = a.created_time;
  }

  const addRows = (rows: Awaited<ReturnType<typeof getCreativeCostAnalysis>>, field: "month" | "d7" | "d30") => {
    for (const r of rows) {
      const m = matchVideo(r.name);
      if (!m || !m.inBank) continue;
      const s = get(m);
      s[field].spend += r.spend;
      s[field].conv += r.conversations ?? 0;
    }
  };
  addRows(month, "month");
  addRows(d7, "d7");
  addRows(d30, "d30");

  return [...map.values()].map(({ _adsets, ...s }) => ({ ...s, activeAdsets: _adsets.size }));
}
