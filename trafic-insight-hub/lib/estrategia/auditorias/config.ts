// Etapa 257: Auditorias do Hub estratégico — parte sem servidor (usada pela tela e pelo hook). Aqui fica o que cada
// conferência faz, a agenda (horário de Brasília, em "batidas" de 15 min) e a configuração que a tela salva.
//
// Como cabe no limite da Meta com 50 contas: o n8n chama o hook estr-tick a cada 15 min e cada batida roda só um
// pedaço (lote) das contas. As conferências por conta (1+ pedido por conta) são divididas em lotes; as que dão pra
// fazer com 1 pedido pra todas as contas (saldo) ou só com o backup do banco (verba mensal) rodam inteiras.
// Pico estimado com 50 contas: ~104 pedidos/hora (12h, 14h–16h, 19h); 984 pedidos no dia.

export type CheckId =
  | "expansao"
  | "whatsapp"
  | "custo"
  | "cpa_dia"
  | "saldo"
  | "verba_mensal"
  | "verba_diaria"
  | "sem_entrega"
  | "erros"
  | "prioridade";

export interface CheckInfo {
  id: CheckId;
  name: string;
  what: string;
  when: string;
  calls: string; // pedidos à Meta por rodada
}

export const CHECKS: CheckInfo[] = [
  {
    id: "expansao",
    name: "Expansão de localização (conjuntos novos)",
    what: "Conjunto criado/alterado com a expansão de público ligada: desliga a caixa (o conjunto segue ativo). Brasil inteiro: pausa.",
    when: "06h, 08h30, 10h30, 13h, 15h e 20h — cada rodada olha o que mudou desde a anterior",
    calls: "1 por conta",
  },
  {
    id: "whatsapp",
    name: "WhatsApp dos conjuntos novos",
    what: "O número de WhatsApp do conjunto é diferente do WhatsApp da ficha do cliente. Só avisa.",
    when: "Junto da expansão (mesmo pedido, sem custo extra)",
    calls: "0 (vem junto)",
  },
  {
    id: "custo",
    name: "Custo alto — conjuntos e criativos (2 dias + hoje)",
    what: "Acima de 2x o CPA ideal: avisa (1x por dia). Acima de 3x, ou gastou 3x o ideal sem conversa: PAUSA na hora e avisa.",
    when: "07h, 12h e 19h",
    calls: "1 por conta",
  },
  {
    id: "cpa_dia",
    name: "CPA alto no dia",
    what: "CPA de hoje acima do ideal: meio-dia (+R$ 20) e à tarde (+R$ 10). Gastou isso sem conversa também entra.",
    when: "11h30 e 15h30",
    calls: "1 por conta",
  },
  {
    id: "saldo",
    name: "Saldo e pagamento",
    what: "Contas Pix/Híbrida com saldo abaixo do limite e contas com erro de pagamento.",
    when: "04h30 (vai no resumo das 08h) e 15h45 (vai no das 17h)",
    calls: "1–2 pra todas",
  },
  {
    id: "verba_mensal",
    name: "Investimento mensal (ritmo)",
    what: "Do dia 01 até ontem: quanto devia ter gastado (meta do mês ÷ dias do mês × dias que passaram) contra o que gastou. Diferença de R$ 10 ou mais, pra baixo ou pra cima, avisa.",
    when: "04h (com o backup da madrugada) — vai no resumo da manhã",
    calls: "0 (só o backup)",
  },
  {
    id: "verba_diaria",
    name: "Investimento diário baixo",
    what: "Orçamento diário ligado em 55% ou menos do Ritmo.",
    when: "16h–16h30",
    calls: "2 por conta",
  },
  {
    id: "sem_entrega",
    name: "Conta sem entrega",
    what: "Conta sem nenhum anúncio ativo, ou com anúncio ativo e sem gasto hoje.",
    when: "09h30 e 14h",
    calls: "2 por conta",
  },
  {
    id: "erros",
    name: "Erros de veiculação",
    what: "Anúncio reprovado, com problema ou pendência de cobrança (cada erro 1x por dia).",
    when: "12h e 19h (junto do custo alto)",
    calls: "1 por conta",
  },
  {
    id: "prioridade",
    name: "Prioridade no Asana",
    what: "Reclassifica a prioridade de cada cliente pelo CPA dos últimos 3 dias (sem hoje), reordena o quadro e atualiza o campo Prioridade no Asana. No resumo vão só as que mudaram e o que não achou no Asana.",
    when: "Segunda e quinta, 04h15 (depois do backup da madrugada)",
    calls: "0 (só o backup)",
  },
];

export const CHECK_BY_ID: Record<CheckId, CheckInfo> = Object.fromEntries(CHECKS.map((c) => [c.id, c])) as Record<CheckId, CheckInfo>;

// ---------- Agenda (minutos desde 00h00 de Brasília, sempre múltiplo de 15) ----------

export interface Job {
  check: CheckId;
  lot: number; // 0-based
  lots: number; // em quantos lotes as contas daquela rodada foram divididas (1 = todas de uma vez)
  variant?: "midday" | "evening"; // CPA do dia
  days?: number[]; // dias da semana (0 = domingo); sem = todo dia
}

const hm = (h: number, m = 0) => h * 60 + m;

// Uma rodada = N batidas seguidas de 15 min, cada uma com um lote.
function round(check: CheckId, startH: number, startM: number, lots: number, variant?: Job["variant"]): Array<[number, Job]> {
  return Array.from({ length: lots }, (_, i) => [hm(startH, startM) + i * 15, { check, lot: i, lots, variant }] as [number, Job]);
}

// Etapa 258: agenda montada pelo usuário no Planejador de Auditorias (05/11/2026). Resumos às 08h, 13h e 17h.
const AGENDA: Array<[number, Job]> = [
  [hm(4), { check: "verba_mensal", lot: 0, lots: 1 }],
  [hm(4, 30), { check: "saldo", lot: 0, lots: 1 }],
  ...round("expansao", 6, 0, 4),
  ...round("custo", 7, 0, 4),
  ...round("expansao", 8, 30, 4),
  ...round("sem_entrega", 9, 30, 4),
  ...round("expansao", 10, 30, 4),
  ...round("cpa_dia", 11, 30, 2, "midday"),
  ...round("custo", 12, 0, 4),
  ...round("erros", 12, 0, 4),
  ...round("expansao", 13, 0, 4),
  ...round("sem_entrega", 14, 0, 4),
  ...round("expansao", 15, 0, 4),
  ...round("cpa_dia", 15, 30, 2, "evening"),
  [hm(15, 45), { check: "saldo", lot: 0, lots: 1 }],
  ...round("verba_diaria", 16, 0, 2),
  ...round("custo", 19, 0, 4),
  ...round("erros", 19, 0, 4),
  ...round("expansao", 20, 0, 4),
  [hm(4, 15), { check: "prioridade", lot: 0, lots: 1, days: [1, 4] }], // segunda e quinta
];

export function jobsAt(minuteOfDay: number, weekday?: number): Job[] {
  return AGENDA.filter(([t, j]) => t === minuteOfDay && (weekday == null || !j.days || j.days.includes(weekday))).map(([, j]) => j);
}

// O que a conferência de WhatsApp precisa é a mesma busca da expansão.
export function minuteToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function hhmmToMinute(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 1440 && v % 15 === 0 ? v : null;
}

// Pedidos à Meta estimados por hora com N contas (pra mostrar na tela).
const CALLS_PER_ACCOUNT: Record<CheckId, number> = {
  expansao: 1,
  whatsapp: 0,
  custo: 1,
  cpa_dia: 1,
  saldo: 0,
  verba_mensal: 0,
  verba_diaria: 2,
  sem_entrega: 2,
  erros: 1,
  prioridade: 0,
};
export function estimatedCallsByHour(accounts: number, enabled: (c: CheckId) => boolean): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (const [t, j] of AGENDA) {
    if (!enabled(j.check)) continue;
    const h = Math.floor(t / 60);
    out[h] += j.check === "saldo" ? 2 : Math.ceil(accounts / j.lots) * CALLS_PER_ACCOUNT[j.check];
  }
  return out;
}

// ---------- Configuração (user_ui_prefs, chave "estr_auditorias") ----------

export const AUDIT_PREF_KEY = "estr_auditorias";

export interface GroupRef {
  id: string;
  name: string;
}

export interface AuditConfig {
  checks: Partial<Record<CheckId, { on?: boolean; group?: GroupRef | null }>>;
  defaultGroup: GroupRef | null; // grupo padrão de quem não tem grupo próprio
  digestTimes: string[]; // "HH:MM" (múltiplos de 15 min)
}

export const DEFAULT_DIGEST_TIMES = ["08:00", "13:00", "17:00"];

export function normalizeConfig(raw: unknown): AuditConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AuditConfig>;
  const times = Array.isArray(r.digestTimes) ? r.digestTimes.filter((t) => typeof t === "string" && hhmmToMinute(t) != null) : DEFAULT_DIGEST_TIMES;
  return {
    checks: r.checks && typeof r.checks === "object" ? r.checks : {},
    defaultGroup: r.defaultGroup && typeof r.defaultGroup === "object" && r.defaultGroup.id ? r.defaultGroup : null,
    digestTimes: [...new Set(times)].sort(),
  };
}

export const isCheckOn = (cfg: AuditConfig, id: CheckId) => cfg.checks[id]?.on !== false; // ligada por padrão
export const groupFor = (cfg: AuditConfig, id: CheckId): GroupRef | null => cfg.checks[id]?.group ?? cfg.defaultGroup;

// Hub operacional em standby (Etapa 257): telas antigas redirecionam pro estratégico e as automações antigas ficam
// pausadas (menos as que alimentam o Hub). Pra reativar, troque pra false.
export const OPERATIONAL_STANDBY = true;
