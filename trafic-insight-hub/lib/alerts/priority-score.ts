// Etapa 137 — pontuação das contas pro RESUMO DAS 7H (lógica pura, sem Meta nem banco).
// Quem tem mais pontos aparece primeiro. Os pontos NÃO aparecem na mensagem — só o nome da conta e um resumo do motivo.
//
// Pontos (definidos pelo Anderson):
//  Status da conta ........ Crítica 3 · Alta 2 · Média 1
//  CPA crítico ............ ontem 2 · ontem + anteontem juntos 3 (não soma: vale o maior)
//  Piora do status ........ +1 se o CPL de ontem caiu num nível PIOR que o status atual da conta
//                           (ex.: status Média, mas o CPL de ontem foi crítico). Manteve ou melhorou = 0.
//  Investimento (Invest. diário ÷ Ritmo) ... 70–80% 1 · 60–70% 2 · 50–60% 3 · abaixo de 50% 4
//  Saldo / pagamento ...... saldo acabando 1 · saldo acabou ou erro no pagamento 7 (não soma: vale o maior; 7 = já entra sozinho no resumo)
// Só entra no resumo (e ganha o 🚨 / filtro "Atenção" no Painel) conta com pelo menos MIN_POINTS pontos — sem limite de quantidade:
// se 3 contas estão realmente críticas aparecem 3; se 15 estão, aparecem 15. Pra ficar mais (ou menos) rígido é só mexer em MIN_POINTS.
// Com MIN_POINTS = 7 (definido olhando a lista real de 24 contas: 7 passaram, 3 delas com 8+): erro no pagamento ou saldo zerado (7, sozinhos);
// status Crítica + investimento abaixo de 40% do ritmo (3+4); status Crítica + CPA crítico ontem + investimento em 60% (3+2+2);
// status Média + CPA crítico ontem e anteontem + investimento muito baixo. Status Crítica + CPA crítico ontem (5) NÃO entra mais sozinho.

export const MIN_POINTS = 7;
const BLOCKING_POINTS = 7; // erro no pagamento / saldo zerado: a conta para de entregar — vale o mesmo que o mínimo, então entra sozinho (se subir MIN_POINTS, suba aqui junto)

export type StatusId = "baixa" | "media" | "alta" | "critica";

// Mesma classificação de Acompanhamento / status em massa (lib/alerts/bulk-status-update.ts).
export function classifyCpa(cpa: number, target: number): StatusId {
  const diff = cpa - target;
  if (diff < 0) return "baixa";
  if (diff <= 2) return "media";
  if (diff <= 3) return "alta";
  return "critica";
}

const LEVEL: Record<StatusId, number> = { baixa: 1, media: 2, alta: 3, critica: 4 };
const STATUS_POINTS: Record<StatusId, number> = { baixa: 0, media: 1, alta: 2, critica: 3 };
export const STATUS_LABEL: Record<StatusId, string> = { baixa: "Baixa", media: "Média", alta: "Alta", critica: "Crítica" };

function asStatus(v: string | null | undefined): StatusId | null {
  return v === "baixa" || v === "media" || v === "alta" || v === "critica" ? v : null; // inauguração / sem status: fora
}

export interface AccountSignals {
  id?: string; // id da conta (usado só pra marcar a conta no Painel)
  name: string;
  status: string | null; // account_bindings.priority
  cpaTarget: number | null;
  // CPA (ou, sem resultado, o gasto) de ontem e dos 2 dias (ontem + anteontem juntos). null = sem gasto no período.
  cpaYesterday: number | null;
  cpaTwoDays: number | null;
  ritmoPct: number | null; // Invest. diário ÷ Ritmo (0,6 = 60%); null = sem Ritmo
  balanceLow: boolean; // saldo acabando
  balanceEmpty: boolean; // saldo acabou
  paymentError: boolean;
}

export interface ScoredAccount {
  id?: string;
  name: string;
  points: number;
  reasons: string[];
}

export function ritmoPoints(pct: number | null): number {
  if (pct == null || !(pct <= 0.8)) return 0;
  if (pct < 0.5) return 4;
  if (pct < 0.6) return 3;
  if (pct < 0.7) return 2;
  return 1;
}

export function scoreAccount(s: AccountSignals): ScoredAccount {
  let points = 0;
  const reasons: { text: string; weight: number }[] = [];
  const add = (p: number, text: string) => {
    points += p;
    reasons.push({ text, weight: p });
  };

  // Saldo / pagamento (vale o maior: 5 ou 1)
  if (s.paymentError) add(BLOCKING_POINTS, "erro no pagamento");
  else if (s.balanceEmpty) add(BLOCKING_POINTS, "saldo acabou");
  else if (s.balanceLow) add(1, "saldo acabando");

  const target = s.cpaTarget && s.cpaTarget > 0 ? s.cpaTarget : null;
  const yLevel = target != null && s.cpaYesterday != null ? classifyCpa(s.cpaYesterday, target) : null;
  const twoCritical = target != null && s.cpaTwoDays != null && classifyCpa(s.cpaTwoDays, target) === "critica";
  if (twoCritical) add(3, "CPA crítico ontem e anteontem");
  else if (yLevel === "critica") add(2, "CPA crítico ontem");

  const rp = ritmoPoints(s.ritmoPct);
  if (rp > 0 && s.ritmoPct != null) add(rp, `investimento em ${Math.round(s.ritmoPct * 100)}% do ritmo`);

  const status = asStatus(s.status);
  if (status) {
    const sp = STATUS_POINTS[status];
    if (sp > 0) add(sp, `status ${STATUS_LABEL[status]}`);
    if (yLevel && LEVEL[yLevel] > LEVEL[status]) add(1, "CPL de ontem piorou");
  }

  reasons.sort((a, b) => b.weight - a.weight);
  return { id: s.id, name: s.name, points, reasons: reasons.map((r) => r.text) };
}

export function joinReasons(reasons: string[]): string {
  if (reasons.length <= 1) return reasons[0] ?? "";
  return `${reasons.slice(0, -1).join(", ")} e ${reasons[reasons.length - 1]}`;
}

// Todas as contas com pontuação, da maior pra menor (inclusive as abaixo do mínimo) — usado só na prévia "todas" pra analisar o corte.
export function scoreAll(accounts: AccountSignals[]): ScoredAccount[] {
  return accounts.map(scoreAccount).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, "pt-BR"));
}

export function rankAccounts(accounts: AccountSignals[]): ScoredAccount[] {
  return scoreAll(accounts).filter((a) => a.points >= MIN_POINTS);
}

// Texto do resumo (WhatsApp / aba Alertas): só nome + motivo, sem pontos.
export function formatMorningSummary(ranked: ScoredAccount[], dateLabel: string): { title: string; body: string; groupText: string } {
  if (ranked.length === 0) {
    const t = `☀️ Nenhuma conta em situação crítica hoje (${dateLabel})`;
    return { title: t, body: "", groupText: t };
  }
  const lines = ranked.map((a) => `• ${a.name}\nMotivo: ${capitalize(joinReasons(a.reasons))}`);
  const body = lines.join("\n\n");
  const title = `☀️ Contas que precisam de atenção (${dateLabel})`;
  return { title, body, groupText: `*Contas que precisam de atenção* — ${dateLabel}\n\n${body}` };
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
