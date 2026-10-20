// Junta os números de cada conta numa visão por VÍDEO (Etapa 160) — código puro, sem Meta, testável.
// Situações (limites ajustáveis nas constantes abaixo):
//  - "alta": bom desempenho (CPA do mês ou dos 7 dias abaixo da meta da conta, com conversas suficientes) em pelo menos uma conta e
//    NENHUM anúncio ativo dele em conta nenhuma — ou seja, é um vídeo bom parado;
//  - "parado": último anúncio criado há mais de RECENT_DAYS dias (ou nunca usado);
//  - "pouco": usado, mas com pouco gasto/conversas nos últimos 30 dias (sem evidência de que seja bom ou ruim);
//  - "repetido": ativo em mais de um conjunto na MESMA conta (em Geral você evita repetir o vídeo);
//  - "fora": nome "GERAL | …" que não está no banco de vídeos.

import { VIDEO_BANK_GERAL, matchVideo, type VideoMatch } from "./video-bank";
import type { AccountVideoStat, Period } from "./video-map";

export const RECENT_DAYS = 14;
export const LOW_SPEND_30D = 30; // R$
export const LOW_CONV_30D = 5;
export const GOOD_MIN_CONV = 3; // conversas mínimas pra considerar o CPA

export type VideoTag = "alta" | "parado" | "pouco" | "repetido" | "fora";

export interface AccountVideoInput {
  accountId: string;
  clientName: string;
  cpaTarget: number;
  stats: AccountVideoStat[];
}

export interface VideoAccountRow {
  accountId: string;
  clientName: string;
  cpaTarget: number;
  state: "ativo" | "pausado" | "nunca";
  activeAds: number;
  activeAdsets: number;
  cpaMonth: number | null;
  cpa7d: number | null;
  spend30: number;
  conv30: number;
  daysSinceCreated: number | null;
  good: boolean;
}

export interface VideoSummary {
  key: string;
  label: string;
  inBank: boolean;
  tags: VideoTag[];
  cpa7d: number | null; // da rede de contas
  cpaMonth: number | null;
  convMonth: number;
  spend30: number;
  conv30: number;
  activeAccounts: number;
  goodAccounts: number;
  usedAccounts: number;
  daysSinceLast: number | null; // null = nunca usado
  accounts: VideoAccountRow[];
}

const cpa = (p: Period): number | null => (p.conv > 0 ? p.spend / p.conv : null);

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / 86_400_000);
}

export function summarizeVideos(inputs: AccountVideoInput[], now: Date = new Date()): VideoSummary[] {
  const keys = new Map<string, VideoMatch>();
  for (const label of VIDEO_BANK_GERAL) {
    const m = matchVideo(label);
    if (m) keys.set(m.key, m);
  }
  for (const a of inputs) for (const s of a.stats) if (!keys.has(s.key)) keys.set(s.key, { key: s.key, label: s.label, inBank: s.inBank });

  const out: VideoSummary[] = [];
  for (const m of keys.values()) {
    const rows: VideoAccountRow[] = [];
    let spendMonth = 0, convMonth = 0, spend7 = 0, conv7 = 0, spend30 = 0, conv30 = 0;
    let lastCreated: string | null = null;
    let repeated = false;
    for (const a of inputs) {
      const s = a.stats.find((x) => x.key === m.key);
      if (!s) {
        rows.push({ accountId: a.accountId, clientName: a.clientName, cpaTarget: a.cpaTarget, state: "nunca", activeAds: 0, activeAdsets: 0, cpaMonth: null, cpa7d: null, spend30: 0, conv30: 0, daysSinceCreated: null, good: false });
        continue;
      }
      const cm = cpa(s.month);
      const c7 = cpa(s.d7);
      const good = (c7 != null && s.d7.conv >= GOOD_MIN_CONV && c7 < a.cpaTarget) || (cm != null && s.month.conv >= GOOD_MIN_CONV && cm < a.cpaTarget);
      if (s.activeAdsets >= 2) repeated = true;
      spendMonth += s.month.spend; convMonth += s.month.conv;
      spend7 += s.d7.spend; conv7 += s.d7.conv;
      spend30 += s.d30.spend; conv30 += s.d30.conv;
      if (s.lastCreated && (!lastCreated || s.lastCreated > lastCreated)) lastCreated = s.lastCreated;
      rows.push({
        accountId: a.accountId,
        clientName: a.clientName,
        cpaTarget: a.cpaTarget,
        state: s.activeAds > 0 ? "ativo" : s.totalAds > 0 ? "pausado" : "nunca",
        activeAds: s.activeAds,
        activeAdsets: s.activeAdsets,
        cpaMonth: cm,
        cpa7d: c7,
        spend30: s.d30.spend,
        conv30: s.d30.conv,
        daysSinceCreated: daysSince(s.lastCreated, now),
        good,
      });
    }
    const activeAccounts = rows.filter((r) => r.state === "ativo").length;
    const goodAccounts = rows.filter((r) => r.good).length;
    const usedAccounts = rows.filter((r) => r.state !== "nunca").length;
    const daysSinceLast = daysSince(lastCreated, now);
    const tags: VideoTag[] = [];
    if (goodAccounts >= 1 && activeAccounts === 0) tags.push("alta");
    if (m.inBank && (daysSinceLast == null || daysSinceLast > RECENT_DAYS)) tags.push("parado");
    if (usedAccounts > 0 && (spend30 < LOW_SPEND_30D || conv30 < LOW_CONV_30D)) tags.push("pouco");
    if (repeated) tags.push("repetido");
    if (!m.inBank) tags.push("fora");
    out.push({
      key: m.key,
      label: m.label,
      inBank: m.inBank,
      tags,
      cpa7d: conv7 > 0 ? spend7 / conv7 : null,
      cpaMonth: convMonth > 0 ? spendMonth / convMonth : null,
      convMonth,
      spend30,
      conv30,
      activeAccounts,
      goodAccounts,
      usedAccounts,
      daysSinceLast,
      accounts: rows,
    });
  }
  const weight = (v: VideoSummary) => (v.tags.includes("alta") ? 0 : v.tags.includes("parado") ? 1 : v.tags.includes("pouco") ? 2 : v.tags.includes("repetido") ? 3 : 4);
  return out.sort((a, b) => weight(a) - weight(b) || (a.cpa7d ?? 9999) - (b.cpa7d ?? 9999) || a.label.localeCompare(b.label, "pt-BR"));
}
