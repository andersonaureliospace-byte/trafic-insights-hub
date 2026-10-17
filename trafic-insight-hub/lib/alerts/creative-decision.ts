// Decisão da pausa automática de Criativos (Etapa 104) — lógica pura, sem Meta nem banco,
// pra poder ser testada com cenários. Quem aplica (busca na Meta e pausa) é
// lib/alerts/creatives-pause.ts.
//
// Regras (pedido do usuário, mais agressivo):
//  1. Período de avaliação: ONTEM + HOJE. Criativo ativo com custo por conversa (ou gasto, se
//     não teve conversa) R$4 ou mais acima da Meta CPA nesse período → candidato a pausa.
//  2. Criativo SEM histórico bom (CPA dos últimos 7 dias não está abaixo do ideal, ou sem
//     conversa nos 7 dias) → pausa direto.
//  3. Criativo COM histórico bom (CPA dos últimos 7 dias estritamente abaixo do ideal — a
//     "linha verde" de Análise) → só pausa se TAMBÉM estiver R$4+ acima da Meta CPA nos
//     últimos dois dias + hoje (anteontem, ontem e hoje juntos).
//  4. Se a busca dos 7 dias (ou dos 2 dias + hoje) falhar, não decide no escuro: pula.
//  5. (Etapas 133/134) Criativo NOVO (criado há menos de 48h): se HOJE (só hoje) ele já tem conversa e o
//     custo por conversa de hoje está dentro da Meta CPA, NÃO pausa nesta rodada — o acumulado de ontem +
//     hoje ainda está pesado por um dia ruim, mas a tendência é boa; espera a próxima rodada (que
//     reavalia tudo: se hoje continuar bom o acumulado melhora sozinho, se piorar, pausa).
//     Teto: se o custo por conversa do acumulado (ontem + hoje) passar de 3x a Meta CPA, pausa mesmo
//     assim. Criativo com 48h ou mais não tem essa espera. Ver `holdBecauseTodayIsGood`.

import { isCreativeFlaggedAbove } from "@/lib/meta/analysis-thresholds";

export interface CreativeMetrics {
  spend: number;
  conversations: number | null;
  cost_per_conversation: number | null;
}

export type CreativeDecision =
  | { action: "none"; reason: string }
  | { action: "skip"; reason: "no_7d_data" | "no_3d_data" }
  | { action: "pause"; reason: string; goodHistory: boolean };

// Etapas 133/134: espera da pausa de criativo NOVO. Segura a pausa (adia pra próxima rodada) só quando:
//  - o anúncio foi criado há menos de 48h (NEW_CREATIVE_HOURS) — sem data de criação, não segura;
//  - o custo por conversa do acumulado ontem + hoje NÃO passou de 3x a Meta CPA (teto, MAX_MULTIPLIER);
//  - HOJE (só hoje) já tem pelo menos 1 conversa e o custo por conversa de hoje está igual ou abaixo da Meta CPA.
export const NEW_CREATIVE_HOURS = 48;
export const NEW_CREATIVE_MAX_MULTIPLIER = 3;

export function isNewCreative(createdTime: string | null | undefined, now: Date): boolean {
  if (!createdTime) return false;
  const t = new Date(createdTime).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t < NEW_CREATIVE_HOURS * 3_600_000;
}

export function holdBecauseTodayIsGood(input: {
  cpaTarget: number;
  createdTime: string | null | undefined;
  now: Date;
  m2: CreativeMetrics; // ontem + hoje (acumulado)
  mToday: CreativeMetrics | undefined; // só hoje
}): boolean {
  const { cpaTarget, createdTime, now, m2, mToday } = input;
  if (!isNewCreative(createdTime, now)) return false;
  // Teto de 3x: custo por conversa do acumulado (sem conversa, o próprio gasto) acima disso → não segura.
  const cumulative = m2.conversations && m2.conversations > 0 && m2.cost_per_conversation != null ? m2.cost_per_conversation : m2.spend;
  if (cumulative > cpaTarget * NEW_CREATIVE_MAX_MULTIPLIER) return false;
  return (
    !!mToday &&
    !!mToday.conversations &&
    mToday.conversations > 0 &&
    mToday.cost_per_conversation != null &&
    mToday.cost_per_conversation <= cpaTarget
  );
}

// "Linha verde" de Análise: CPA dos últimos 7 dias estritamente abaixo do ideal; sem conversa
// nos 7 dias não conta como histórico bom.
export function hasGoodHistory7d(m7: CreativeMetrics | undefined, cpaTarget: number): boolean {
  return !!m7 && !!m7.conversations && m7.conversations > 0 && m7.cost_per_conversation != null && m7.cost_per_conversation < cpaTarget;
}

export function decideCreativePause(input: {
  cpaTarget: number;
  m2: CreativeMetrics; // ontem + hoje
  m7: CreativeMetrics | undefined; // últimos 7 dias (undefined = sem dado nos 7 dias)
  sevenDayFetched: boolean; // false = a busca de 7 dias falhou
  m3: CreativeMetrics | undefined; // anteontem + ontem + hoje (só quando precisou)
  threeDayFetched: boolean; // false = a busca dos 2 dias + hoje falhou
}): CreativeDecision {
  const { cpaTarget, m2, m7, sevenDayFetched, m3, threeDayFetched } = input;
  if (!isCreativeFlaggedAbove(m2 as Parameters<typeof isCreativeFlaggedAbove>[0], cpaTarget)) {
    return { action: "none", reason: "dentro do limite ontem + hoje" };
  }
  if (!sevenDayFetched) return { action: "skip", reason: "no_7d_data" };
  if (!hasGoodHistory7d(m7, cpaTarget)) {
    return { action: "pause", reason: "R$4+ acima da meta ontem + hoje, sem histórico bom nos 7 dias", goodHistory: false };
  }
  if (!threeDayFetched) return { action: "skip", reason: "no_3d_data" };
  if (m3 && isCreativeFlaggedAbove(m3 as Parameters<typeof isCreativeFlaggedAbove>[0], cpaTarget)) {
    return { action: "pause", reason: "histórico bom nos 7 dias, mas R$4+ acima da meta nos últimos 2 dias + hoje", goodHistory: true };
  }
  return { action: "none", reason: "histórico bom nos 7 dias e dentro do limite nos últimos 2 dias + hoje" };
}
