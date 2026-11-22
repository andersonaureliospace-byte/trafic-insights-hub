// Etapa 341: tarefas do quadro Alertas (Acompanhamento → Alertas). Ficam na tabela estr_tarefas (tipo "alerta"), sem
// migration: o alerta que a tarefa resolve e o CPA de hoje na hora em que ela nasceu vão no origem_key:
//   at|<aleatório>|<chave do alerta>|<CPA de hoje: número, "inf" = gastou sem lead, vazio = sem gasto>
// Usado pela tela (cliente) e pela automação (estr-tick, a cada 30 min em horário comercial).

export const ORIGEM_PREFIX = "at|";

// alertas de CPA: a tarefa fecha sozinha quando o CPA de hoje cai em relação ao da hora em que ela foi criada
export const CPA_KEYS = new Set(["cpa_u3", "cpa_u2", "cpa_ontem", "cpa_muito_alto", "sem_lead_hoje"]);

export interface TarefaMeta {
  alerta: string; // "" = não ligada a nenhum alerta (só fecha na mão)
  cpaBase: number | null; // Infinity = gastou sem lead
}

export function origemKey(alerta: string, cpaBase: number | null): string {
  const rand = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const b = cpaBase == null || Number.isNaN(cpaBase) ? "" : cpaBase === Infinity ? "inf" : cpaBase.toFixed(2);
  return `${ORIGEM_PREFIX}${rand}|${alerta.replace(/\|/g, "")}|${b}`;
}

export function parseOrigem(k: string | null | undefined): TarefaMeta | null {
  if (!k || !k.startsWith(ORIGEM_PREFIX)) return null;
  const [, , alerta = "", base = ""] = k.split("|");
  return { alerta, cpaBase: base === "" ? null : base === "inf" ? Infinity : Number(base) };
}

// CPA de hoje caiu em relação ao CPA da criação? Precisa ter pelo menos 1 lead hoje.
export function cpaCaiu(base: number | null, hoje: { spend: number; results: number } | null | undefined): number | null {
  if (base == null || !hoje || hoje.results <= 0 || hoje.spend <= 0) return null;
  const atual = hoje.spend / hoje.results;
  if (base === Infinity || atual < base - 0.01) return atual;
  return null;
}
