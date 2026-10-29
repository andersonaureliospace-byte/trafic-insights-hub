// Etapa 224: períodos do filtro de "Conjuntos da conta" (Análise). Arquivo sem dependência de servidor — usado na tela e nas rotas.
export type AnalysisPeriod = "hoje" | "ontem" | "ontem_hoje" | "7d" | "15d" | "30d" | "mes";

export const ANALYSIS_PERIODS: { id: AnalysisPeriod; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "ontem", label: "Ontem" },
  { id: "ontem_hoje", label: "Ontem + hoje" },
  { id: "7d", label: "Últimos 7 dias" },
  { id: "15d", label: "Últimos 15 dias" },
  { id: "30d", label: "Últimos 30 dias" },
  { id: "mes", label: "Este mês" },
];

export const isAnalysisPeriod = (v: unknown): v is AnalysisPeriod => ANALYSIS_PERIODS.some((p) => p.id === v);

function brDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Intervalo (horário de Brasília). Os "últimos N dias" contam hoje.
export function analysisRange(p: AnalysisPeriod, now = new Date()): { since: string; until: string } {
  const day = (n: number) => brDate(new Date(now.getTime() - n * 86_400_000));
  const today = day(0);
  switch (p) {
    case "hoje":
      return { since: today, until: today };
    case "ontem":
      return { since: day(1), until: day(1) };
    case "ontem_hoje":
      return { since: day(1), until: today };
    case "7d":
      return { since: day(6), until: today };
    case "15d":
      return { since: day(14), until: today };
    case "30d":
      return { since: day(29), until: today };
    case "mes":
      return { since: `${today.slice(0, 8)}01`, until: today };
  }
}
