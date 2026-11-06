// Etapa 238 (Hub estratégico) — parte sem servidor (usada também pela tela Automações): liga/pausa de cada automação do n8n, sem mexer no n8n.
// O fluxo "Pausas e avisos automáticos" continua chamando os hooks no horário de sempre; quando a automação está
// pausada aqui, o hook responde { paused: true } e não faz nada (nem grava no Registro das automações).
// Guardado em user_ui_prefs (chave "automation_switches") como { chave: true/false } — só guarda o que o usuário mudou;
// o resto segue o padrão abaixo. Chaves = id do withRunLog ("balance-alert", "audit"...) e, pro aviso de CPA, uma chave
// por rodada ("cpa-alert:yesterday" / "cpa-alert:midday" / "cpa-alert:evening").


import { OPERATIONAL_STANDBY } from "@/lib/estrategia/auditorias/config";

export const SWITCHES_PREF_KEY = "automation_switches";

// Etapa 257: Hub operacional em standby — as automações antigas ficam TODAS pausadas (o que importa agora roda pelas
// Auditorias do Hub estratégico, numa agenda só que cabe no limite da Meta). Continuam só as que alimentam o Hub:
// backup das métricas (telas e verba mensal), saldo por fundos (saldo), ofertas e descrições do Asana (sem Meta).
export const STANDBY_KEEP = new Set<string>(["metrics-sync", "funds-balance", "offers", "asana-descriptions"]);

// Pausadas por padrão: tudo que é operação da conta (o estrategista não mexe mais nas contas) e avisos que o Hub
// estratégico já mostra na tela. Ficam LIGADAS por padrão: saldo/pagamento, verificação de localização/expansão de
// público e erros (alimentam os Alertas), CPA acima de R$ 20 ao meio-dia, e os retratos que o Hub usa
// (backup das métricas, saldo por fundos, ofertas, descrições do Asana).
export const DEFAULT_PAUSED = new Set<string>([
  "pause-backup",
  "creatives-pause",
  "creatives-pause-queue",
  "creatives-no-result",
  "adsets-pause",
  "budget-plan",
  "budget-apply",
  "bulk-status",
  "weekend-standby",
  "weekend-release",
  "naming-fix",
  "exam-check",
  "no-delivery",
  "morning-summary",
  "low-budget",
  "low-investment",
  "videos",
  "audience",
  "cpa-board-cache",
  "cpa-alert:yesterday",
  "cpa-alert:evening",
]);

export type Switches = Record<string, boolean>; // true = ligada

export function isEnabled(saved: Switches, key: string): boolean {
  if (OPERATIONAL_STANDBY && !STANDBY_KEEP.has(key)) return false;
  if (key in saved) return saved[key] !== false;
  return !DEFAULT_PAUSED.has(key);
}
