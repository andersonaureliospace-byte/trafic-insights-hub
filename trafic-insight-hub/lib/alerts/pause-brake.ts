// Etapa 136 — Freio de segurança das pausas automáticas (lógica pura, sem Meta nem banco).
//
// Regra (pedido do Anderson): se uma rodada fosse pausar MAIS DE 70% dos itens ativos de um grupo, pausa só os
// PIORES até chegar nos 70% e mantém os menos ruins ativos (a rodada seguinte reavalia). Até 70% pausa tudo normalmente
// (ex.: 6 conjuntos e 3 pra pausar = 50% → pausa os 3).
//  - Grupo dos criativos = os anúncios ativos do MESMO conjunto. Grupo dos conjuntos = os conjuntos ativos da conta.
//  - Grupo com menos de 2 itens não tem freio (pausar o único item é uma decisão normal; o conjunto sem anúncio
//    ativo cai na regra própria dele).
//  - Ficam FORA do freio (sempre pausam, mesmo passando dos 70%): conjunto sem anúncio ativo e criativo que passou
//    de 3x a Meta CPA (custo por conversa — ou o gasto, se não teve conversa — de 3x a meta ou mais). Eles contam
//    como pausados no cálculo dos 70%, então o espaço que sobra pros outros diminui.

export const BRAKE_MAX_SHARE = 0.7;
// Criativo/conjunto "queimando verba": passou de 3x a Meta CPA.
export const BRAKE_EXEMPT_MULTIPLIER = 3;

export interface BrakeCandidate {
  id: string;
  // Quanto pior, maior (ex.: custo por conversa ÷ Meta CPA). Usado só pra ordenar quem pausa primeiro.
  severity: number;
  // true = nunca é segurado pelo freio.
  exempt: boolean;
}

export interface BrakeResult {
  pause: string[]; // ids que podem ser pausados agora (os piores primeiro)
  held: string[]; // ids segurados pelo freio (continuam ativos até a próxima rodada)
}

export function maxPausable(totalActive: number): number {
  return Math.floor(totalActive * BRAKE_MAX_SHARE + 1e-9);
}

export function applyPauseBrake(candidates: BrakeCandidate[], totalActive: number): BrakeResult {
  const exempt = candidates.filter((c) => c.exempt);
  const regular = candidates.filter((c) => !c.exempt).sort((a, b) => b.severity - a.severity);
  if (totalActive < 2) return { pause: [...exempt, ...regular].map((c) => c.id), held: [] };
  const limit = maxPausable(totalActive);
  if (candidates.length <= limit) return { pause: [...exempt, ...regular].map((c) => c.id), held: [] };
  const room = Math.max(0, limit - exempt.length);
  return {
    pause: [...exempt, ...regular.slice(0, room)].map((c) => c.id),
    held: regular.slice(room).map((c) => c.id),
  };
}

// Severidade "quanto acima da meta": custo por conversa (ou o gasto, quando não teve conversa) ÷ Meta CPA.
export function severityOf(
  m: { spend: number; conversations: number | null; cost_per_conversation: number | null },
  cpaTarget: number,
): number {
  const value = m.conversations && m.conversations > 0 && m.cost_per_conversation != null ? m.cost_per_conversation : m.spend;
  return cpaTarget > 0 ? value / cpaTarget : value;
}

// Passou de 3x a Meta CPA (fora do freio).
export function isTripleOverTarget(
  m: { spend: number; conversations: number | null; cost_per_conversation: number | null },
  cpaTarget: number,
): boolean {
  return severityOf(m, cpaTarget) >= BRAKE_EXEMPT_MULTIPLIER;
}
