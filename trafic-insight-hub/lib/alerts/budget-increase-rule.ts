// Regra pura do aumento programado de investimento (Etapa 139).
// Base: CPA (custo por conversa) do conjunto nos ÚLTIMOS 3 DIAS, SEM hoje, comparado com a meta (CPA ideal) da conta.
//   • CPA até R$1 acima do ideal (ou abaixo dele) → +R$10
//   • CPA de R$1 a R$2 acima do ideal            → +R$5
//   • mais de R$2 acima                           → não aumenta
// Teto do orçamento diário do conjunto: R$30. Se o CPA dos últimos 7 dias estiver abaixo do ideal, o teto extremo é R$35.
// O aumento nunca passa do teto (ex.: está em R$25 → só +R$5 = R$30; com 7 dias bons, +R$10 = R$35).
// Segurança: precisa de pelo menos MIN_CONVERSATIONS conversas nos 3 dias (CPA com 1 conversa só é sorte, não tendência).

export const STEP_NEAR_CENTS = 1000; // +R$10
export const STEP_FAR_CENTS = 500; // +R$5
export const NEAR_EXTRA = 1; // até R$1 acima do ideal
export const FAR_EXTRA = 2; // até R$2 acima do ideal
export const CAP_BASE_CENTS = 3000; // R$30
export const CAP_EXTREME_CENTS = 3500; // R$35
export const MIN_CONVERSATIONS = 3;

// Valor do degrau pelo CPA dos 3 dias (0 = não aumenta).
export function stepForCpa(cpa3d: number, cpaTarget: number): number {
  if (cpa3d <= cpaTarget + NEAR_EXTRA) return STEP_NEAR_CENTS;
  if (cpa3d <= cpaTarget + FAR_EXTRA) return STEP_FAR_CENTS;
  return 0;
}

// Só vale buscar os 7 dias quando o teto extremo faria diferença (o aumento sozinho passaria de R$30 e ainda cabe em R$35).
export function needsSevenDayForCap(currentCents: number, stepCents: number): boolean {
  return stepCents > 0 && currentCents + stepCents > CAP_BASE_CENTS && currentCents < CAP_EXTREME_CENTS;
}

export type IncreaseDecision =
  | { action: "increase"; stepCents: number; capCents: number; newCents: number }
  | { action: "none"; reason: string };

export function decideIncrease(input: {
  cpa3d: number | null;
  conversations3d: number | null;
  cpaTarget: number;
  currentCents: number;
  cpa7d: number | null; // null = não buscado/sem dado
}): IncreaseDecision {
  const { cpa3d, conversations3d, cpaTarget, currentCents, cpa7d } = input;
  if (cpa3d == null || !conversations3d || conversations3d < MIN_CONVERSATIONS) {
    return { action: "none", reason: `menos de ${MIN_CONVERSATIONS} conversas nos últimos 3 dias` };
  }
  const step = stepForCpa(cpa3d, cpaTarget);
  if (step === 0) return { action: "none", reason: "CPA mais de R$2 acima do ideal" };
  const sevenGood = cpa7d != null && cpa7d < cpaTarget;
  const cap = sevenGood ? CAP_EXTREME_CENTS : CAP_BASE_CENTS;
  if (currentCents >= cap) return { action: "none", reason: `já está no teto de R$${cap / 100}` };
  const newCents = Math.min(currentCents + step, cap);
  return { action: "increase", stepCents: step, capCents: cap, newCents };
}
