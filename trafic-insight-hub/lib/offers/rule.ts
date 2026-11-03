// Ofertas ativas por cliente (Etapa 149) — regra pura (sem Meta, sem React), usada pela coluna "Ofertas ativas"
// da aba Descrição. Entra tudo que EXISTIU no mês (teve gasto no mês corrente ou está ligado agora); o nome do conjunto
// (padrão: TIPO | [OFERTA] | [CREDIARIO|BOLETO] | [VDO PROPRIO] | LOC | IDADE | … | AND | DD/MM) diz o que ele é.
//   GERAL  → ATIVO / INATIVO / INEXISTENTE
//   EXAME  → ATIVO - OFERTA / INATIVO - OFERTA / INEXISTENTE (só UMA oferta: a ligada de maior gasto; senão a de maior gasto)
//   PROMO  → todas as ofertas (inclusive as inativas), ou INEXISTENTE
//   BOLETO → ATIVO / INATIVO / INEXISTENTE (qualquer conjunto com a marca BOLETO ou CREDIARIO no nome — são a mesma coisa)
// Campanha [VAGA] fica fora.

import { extractTags, mapAdsetType, normName, splitParts, normalizeMoney } from "@/lib/naming/rules";

export type OfferStatus = "ATIVO" | "INATIVO" | "INEXISTENTE";

export interface OfferAdset {
  name: string;
  active: boolean; // ligado agora (ativo ou programado)
  spend: number; // gasto no mês corrente
}

export interface OffersSummary {
  geral: OfferStatus;
  exame: { status: OfferStatus; offer: string | null };
  promo: Array<{ offer: string; active: boolean }>;
  boleto: OfferStatus;
  // Etapa 238 (Hub estratégico): números por tipo de oferta. Opcional — retratos antigos (de antes da Etapa 238) não têm.
  metrics?: OffersMetrics;
}

export type OfferKind = "geral" | "exame" | "boleto" | "promo";
export interface OfferMetric {
  spend: number;
  results: number;
}
export interface OffersMetrics {
  last2d: Record<OfferKind, OfferMetric>; // os 2 últimos dias FECHADOS (anteontem + ontem)
  promoSpendMonth: number; // gasto em PROMO no mês corrente (até a hora do retrato)
  since: string; // período do last2d (YYYY-MM-DD)
  until: string;
}

// Tipo da oferta pelo nome do conjunto (mesma regra do summarizeOffers: marca BOLETO/CREDIARIO manda primeiro).
export function offerKindOf(name: string): OfferKind | null {
  const p = parseAdsetName(name);
  if (!p) return null;
  if (p.payment) return "boleto";
  return p.type === "GERAL" ? "geral" : p.type === "EXAME" ? "exame" : "promo";
}

const AGE_RE = /^\d{2}\s*-\s*\d{2}\+?$/;
const NOISE_RE = /^(INTERESSES?|AND|ANDERSON)$/;
const DATE_RE = /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/;

export type ParsedAdset = { type: "GERAL" | "EXAME" | "PROMO"; payment: "CREDIARIO" | "BOLETO" | null; offer: string | null };

// Lê o nome do conjunto. null = não é GERAL/EXAME/PROMO (nome fora do padrão).
export function parseAdsetName(name: string): ParsedAdset | null {
  const parts = splitParts(name);
  if (parts.length === 0) return null;
  const t = mapAdsetType(parts[0]);
  if (!t) return null;
  const payment = extractTags(parts.join(" ")).payment;
  // A OFERTA fica entre o TIPO e a IDADE. Quando há mais de uma parte nesse trecho, a última é a localização.
  // Etapa 251: com UMA parte só (nome sem localização, ex.: "PROMO | 200 DE DESCONTO | 25-64 | AND"), ela é a oferta —
  // antes era descartada como se fosse a cidade e a promo aparecia "sem oferta no nome". Sem idade no nome: tudo até o fim.
  const ageIdx = parts.findIndex((p, i) => i > 0 && AGE_RE.test(normName(p)));
  const between = parts.slice(1, ageIdx >= 0 ? ageIdx : parts.length);
  const offerParts = between.length >= 2 ? between.slice(0, -1) : between;
  const candidates: string[] = [];
  if (t.rest.trim()) candidates.push(t.rest.trim()); // "PROMO SETEMBRO" → SETEMBRO
  candidates.push(...offerParts.filter((p) => !/\b\d+\s*KM\b/.test(normName(p))));
  let offer: string | null = null;
  for (const c of candidates) {
    const rest = extractTags(c).rest;
    const n = normName(rest);
    if (!n || NOISE_RE.test(n) || DATE_RE.test(n) || /COBRIMOS\s+OFERTAS?/.test(n)) continue;
    offer = normalizeMoney(rest); // Etapa 251: "R$15" → "R$ 15,00" (mesma oferta escrita de jeitos diferentes vira uma só)
    break;
  }
  return { type: t.type, payment, offer };
}

function offerKey(o: string): string {
  return normName(o).replace(/\s+/g, "");
}

function statusOf(list: OfferAdset[]): OfferStatus {
  if (list.length === 0) return "INEXISTENTE";
  return list.some((a) => a.active) ? "ATIVO" : "INATIVO";
}

export function summarizeOffers(adsets: OfferAdset[]): OffersSummary {
  const geral: OfferAdset[] = [];
  const boleto: OfferAdset[] = [];
  const exame: Array<OfferAdset & { offer: string | null }> = [];
  const promo = new Map<string, { offer: string; active: boolean }>();
  for (const a of adsets) {
    const p = parseAdsetName(a.name);
    if (!p) continue;
    if (p.payment) {
      boleto.push(a);
      continue;
    }
    if (p.type === "GERAL") geral.push(a);
    else if (p.type === "EXAME") exame.push({ ...a, offer: p.offer });
    else {
      const label = p.offer ?? "sem oferta no nome";
      const k = offerKey(label);
      const cur = promo.get(k);
      promo.set(k, { offer: cur?.offer ?? label, active: (cur?.active ?? false) || a.active });
    }
  }

  // EXAME: uma oferta só — entre as ligadas, a de maior gasto; sem nenhuma ligada, a de maior gasto no mês.
  let examePick: { status: OfferStatus; offer: string | null } = { status: "INEXISTENTE", offer: null };
  if (exame.length > 0) {
    const group = new Map<string, { offer: string | null; active: boolean; spend: number }>();
    for (const e of exame) {
      const k = e.offer ? offerKey(e.offer) : "";
      const cur = group.get(k) ?? { offer: e.offer, active: false, spend: 0 };
      cur.active = cur.active || e.active;
      cur.spend += e.spend;
      group.set(k, cur);
    }
    const all = [...group.values()];
    const pool = all.some((g) => g.active) ? all.filter((g) => g.active) : all;
    pool.sort((a, b) => b.spend - a.spend);
    examePick = { status: pool[0].active ? "ATIVO" : "INATIVO", offer: pool[0].offer };
  }

  return {
    geral: statusOf(geral),
    exame: examePick,
    promo: [...promo.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.offer.localeCompare(b.offer, "pt-BR")),
    boleto: statusOf(boleto),
  };
}
