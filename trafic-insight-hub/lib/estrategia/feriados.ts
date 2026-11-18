// Etapa 330: feriados nacionais (pro tom do feedback: véspera de feriado = acelerar os testes, igual à quarta).
// Datas fixas valem todo ano; as móveis (Carnaval, Sexta-feira Santa, Corpus Christi) estão até 2028.
const FIXOS: Record<string, string> = {
  "01-01": "Ano Novo",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "09-07": "Independência",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República",
  "11-20": "Consciência Negra",
  "12-25": "Natal",
};
const MOVEIS: Record<string, string> = {
  "2026-02-16": "Carnaval",
  "2026-02-17": "Carnaval",
  "2026-04-03": "Sexta-feira Santa",
  "2026-06-04": "Corpus Christi",
  "2027-02-08": "Carnaval",
  "2027-02-09": "Carnaval",
  "2027-03-26": "Sexta-feira Santa",
  "2027-05-27": "Corpus Christi",
  "2028-02-28": "Carnaval",
  "2028-02-29": "Carnaval",
  "2028-04-14": "Sexta-feira Santa",
  "2028-06-15": "Corpus Christi",
};

export function feriadoEm(ymd: string): string | null {
  return MOVEIS[ymd] ?? FIXOS[ymd.slice(5)] ?? null;
}

const addDias = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// Feriado nos próximos `dias` dias (amanhã = 1). null se não tiver.
export function proximoFeriado(hoje: string, dias = 2): { nome: string; emDias: number } | null {
  for (let i = 1; i <= dias; i++) {
    const nome = feriadoEm(addDias(hoje, i));
    if (nome) return { nome, emDias: i };
  }
  return null;
}
