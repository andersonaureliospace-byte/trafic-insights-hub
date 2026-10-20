// Junta os números de cada conta numa visão por VÍDEO (Etapa 160) — código puro, sem Meta, testável.
// Situações (limites ajustáveis nas constantes abaixo):
//  - "alta": bom desempenho (CPA do mês ou dos 7 dias abaixo da meta da conta, com conversas suficientes) em pelo menos uma conta e
//    NENHUM anúncio ativo dele em conta nenhuma — ou seja, é um vídeo bom parado;
//  - "parado": último anúncio criado há mais de RECENT_DAYS dias (ou nunca usado);
//  - "pouco": usado, mas com pouco gasto/conversas nos últimos 30 dias (sem evidência de que seja bom ou ruim);
//  - "repetido": ativo em mais de um conjunto na MESMA conta (em Geral você evita repetir o vídeo);
//  Anúncios "GERAL | …" que não estão no banco de vídeos são IGNORADOS.
//  Visão por conta (summarizeAccounts, Etapa 162): mesmas ideias olhando UMA conta por vez — ver AccountVideoTag.

import { VIDEO_BANK_GERAL, matchVideo, type VideoMatch } from "./video-bank";
import type { AccountVideoStat, Period } from "./video-map";

export const RECENT_DAYS = 14;
export const LOW_SPEND_30D = 30; // R$
export const LOW_CONV_30D = 5;
export const GOOD_MIN_CONV = 3; // conversas mínimas pra considerar o CPA

export const CARO_MARGEM = 4; // R$ acima da meta (mesma folga da pausa de criativos) pra marcar o vídeo como caro na conta

export type VideoTag = "alta" | "parado" | "pouco" | "repetido";

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

// ---------- Visão por CONTA (Etapa 162) ----------
// Pra cada conta, cada vídeo do banco ganha etiquetas olhando só aquela conta:
//  - "reativar": bom na conta (CPA 7 dias ou do mês abaixo da meta, 3+ conversas) e SEM anúncio ativo nela;
//  - "caro": gasto com CPA (mês, ou 30 dias se o mês não tem conversas suficientes) R$ CARO_MARGEM+ acima da meta — evitar trazer de volta;
//  - "nunca": nunca usado nessa conta (candidato a teste);
//  - "parado": já usado, sem anúncio ativo e último anúncio criado há mais de RECENT_DAYS dias;
//  - "pouco": usado, mas com pouco gasto/conversas nos últimos 30 dias na conta;
//  - "repetido": ativo em 2+ conjuntos da conta.
export type AccountVideoTag = "reativar" | "caro" | "nunca" | "parado" | "pouco" | "repetido";

export interface AccountVideoItem {
  key: string;
  label: string;
  state: "ativo" | "pausado" | "nunca";
  activeAds: number;
  activeAdsets: number;
  cpa7d: number | null;
  cpaMonth: number | null;
  cpa30: number | null;
  spend30: number;
  conv30: number;
  daysSinceCreated: number | null;
  tags: AccountVideoTag[];
}

export interface AccountSummary {
  accountId: string;
  clientName: string;
  cpaTarget: number;
  items: AccountVideoItem[];
  counts: Record<AccountVideoTag, number>;
  activeVideos: number; // vídeos diferentes com anúncio ativo
}

const ACCOUNT_ORDER: AccountVideoTag[] = ["reativar", "repetido", "parado", "pouco", "caro", "nunca"]; // "nunca" por último: são muitos

export function summarizeAccounts(inputs: AccountVideoInput[], now: Date = new Date()): AccountSummary[] {
  const bank = new Map<string, VideoMatch>();
  for (const label of VIDEO_BANK_GERAL) {
    const m = matchVideo(label);
    if (m) bank.set(m.key, m);
  }
  const out: AccountSummary[] = [];
  for (const a of inputs) {
    const items: AccountVideoItem[] = [];
    for (const m of bank.values()) {
      const s = a.stats.find((x) => x.key === m.key);
      const c7 = s ? cpa(s.d7) : null;
      const cm = s ? cpa(s.month) : null;
      const c30 = s ? cpa(s.d30) : null;
      const state: AccountVideoItem["state"] = !s || s.totalAds === 0 ? "nunca" : s.activeAds > 0 ? "ativo" : "pausado";
      const good = !!s && ((c7 != null && s.d7.conv >= GOOD_MIN_CONV && c7 < a.cpaTarget) || (cm != null && s.month.conv >= GOOD_MIN_CONV && cm < a.cpaTarget));
      const costRef = !s ? null : s.month.conv >= GOOD_MIN_CONV ? cm : s.d30.conv >= GOOD_MIN_CONV ? c30 : null;
      const days = s ? daysSince(s.lastCreated, now) : null;
      const tags: AccountVideoTag[] = [];
      if (good && state !== "ativo") tags.push("reativar");
      if (!good && costRef != null && costRef >= a.cpaTarget + CARO_MARGEM) tags.push("caro");
      if (state === "nunca") tags.push("nunca");
      if (state === "pausado" && (days == null || days > RECENT_DAYS)) tags.push("parado");
      if (s && state !== "nunca" && (s.d30.spend < LOW_SPEND_30D || s.d30.conv < LOW_CONV_30D)) tags.push("pouco");
      if (s && s.activeAdsets >= 2) tags.push("repetido");
      items.push({
        key: m.key,
        label: m.label,
        state,
        activeAds: s?.activeAds ?? 0,
        activeAdsets: s?.activeAdsets ?? 0,
        cpa7d: c7,
        cpaMonth: cm,
        cpa30: c30,
        spend30: s?.d30.spend ?? 0,
        conv30: s?.d30.conv ?? 0,
        daysSinceCreated: days,
        tags,
      });
    }
    const rank = (i: AccountVideoItem) => {
      const idx = ACCOUNT_ORDER.findIndex((t) => i.tags.includes(t));
      return idx === -1 ? 9 : idx;
    };
    items.sort((x, y) => rank(x) - rank(y) || (x.cpa7d ?? 9999) - (y.cpa7d ?? 9999) || x.label.localeCompare(y.label, "pt-BR"));
    const counts: Record<AccountVideoTag, number> = { reativar: 0, caro: 0, nunca: 0, parado: 0, pouco: 0, repetido: 0 };
    for (const i of items) for (const t of i.tags) counts[t]++;
    out.push({
      accountId: a.accountId,
      clientName: a.clientName,
      cpaTarget: a.cpaTarget,
      items,
      counts,
      activeVideos: items.filter((i) => i.state === "ativo").length,
    });
  }
  return out.sort((x, y) => x.clientName.localeCompare(y.clientName, "pt-BR"));
}
