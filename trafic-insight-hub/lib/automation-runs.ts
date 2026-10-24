// Etapa 190: registro de TODAS as rodadas das automações (tabela automation_runs).
// Cada hook do n8n (app/api/public/hooks/*-tick) é embrulhado com withRunLog("nome", handler):
// depois que o hook termina, grava uma linha por usuário — inclusive quando verificou e não mexeu em nada.
//   - "changed":   a rodada gerou/atualizou alerta (os títulos vão em details.alerts);
//   - "no-change": verificou e não precisou mexer em nada;
//   - "error":     a rodada (ou parte dela) deu erro.
// O registro nunca derruba o hook: qualquer falha aqui é engolida.
// Aparece em Auditoria → Alertas → "Registro das automações".

import { createServiceClient } from "@/lib/supabase/server";
export { AUTOMATION_LABELS } from "@/lib/automation-labels";

export const RUN_TTL_DAYS = 30;

// Tipos de alerta que cada automação publica — usado pra saber se a rodada "mexeu em algo"
// sem confundir com alerta de outra automação rodando ao mesmo tempo.
const AUTOMATION_KINDS: Record<string, string[]> = {
  "creatives-pause": ["creatives-pause", "adsets-cut"],
  "creatives-no-result": ["creatives-no-result", "adsets-cut"],
  "adsets-pause": ["adsets-paused", "adsets-cut", "adsets-cut-failed", "adsets-no-spend"],
  "pause-backup": ["pause-backup"],
  "low-budget": ["low-budget"],
  "low-investment": ["low-investment"],
  "cpa-alert": ["cpa-yesterday", "cpa-today"],
  "bulk-status": ["bulk-status"],
  "balance-alert": ["balance-low", "balance-friday", "payment-error"],
  "balance-evening": ["balance-evening"],
  "morning-summary": ["morning-summary"],
  "no-delivery": ["no-delivery"],
  "budget-plan": ["budget-increase"],
  "budget-apply": ["budget-increase", "no-delivery"],
  "naming-fix": ["naming-fix"],
  "weekend-standby": ["weekend-standby"],
  "weekend-release": ["weekend-standby"],
  "exam-check": ["exam-missing"],
  audit: ["audit-location", "audit-errors"],
};

// Rótulos dos números que os hooks devolvem (o resto aparece com o nome original).
const FIELD_LABELS: Record<string, string> = {
  paused: "pausados",
  held: "segurados",
  alerted: "avisados",
  fixed: "ajustados",
  failed: "falhas",
  checkedAccounts: "contas verificadas",
  processed: "processados",
  updated: "atualizados",
  applied: "aplicados",
  cut: "cortados",
  reactivated: "reativados",
  sent: "enviados",
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

// Junta os erros do resultado (no topo ou dentro de blocos, ex.: { balance: { error } }).
function collectErrors(entry: Json): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(entry)) {
    if (k === "error" && typeof v === "string" && v) out.push(v);
    else if (isObj(v) && typeof v.error === "string" && v.error) out.push(`${k}: ${v.error}`);
  }
  return out;
}

// "pausados 2 · segurados 0 · balance avisados 1" — só números (contagens) do resultado.
function numbersLine(entry: Json): string {
  const parts: string[] = [];
  const push = (prefix: string, k: string, v: unknown) => {
    const n = typeof v === "number" ? v : Array.isArray(v) ? v.length : null;
    if (n == null) return;
    parts.push(`${prefix}${FIELD_LABELS[k] ?? k} ${n}`);
  };
  for (const [k, v] of Object.entries(entry)) {
    if (k === "userId" || k === "error") continue;
    if (isObj(v)) for (const [k2, v2] of Object.entries(v)) push(`${k} `, k2, v2);
    else push("", k, v);
  }
  return parts.join(" · ");
}

async function logRuns(automation: string, startedAt: Date, res: Response): Promise<void> {
  const finishedAt = new Date();
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const db = createServiceClient();

  let entries: Json[];
  const results = isObj(body) && Array.isArray(body.results) ? (body.results as unknown[]).filter(isObj) : null;
  if (results) {
    entries = results.filter((r) => typeof r.userId === "string");
  } else {
    // Falhou antes de rodar por usuário (ex.: erro de banco): registra o erro pra cada usuário com token.
    const { data } = await db.from("user_meta_credentials").select("user_id").not("access_token", "is", null);
    const msg = isObj(body) && typeof body.error === "string" ? body.error : `Resposta HTTP ${res.status}`;
    entries = (data ?? []).map((c) => ({ userId: c.user_id as string, error: msg }));
  }
  const extra = isObj(body) && typeof body.mode === "string" ? { mode: body.mode } : {};

  for (const entry of entries) {
    const userId = entry.userId as string;
    const kinds = AUTOMATION_KINDS[automation] ?? [];
    let alerts: Array<{ kind: string; title: string; count: number }> = [];
    if (kinds.length) {
      const { data } = await db
        .from("alert_notifications")
        .select("kind, title, item_count")
        .eq("user_id", userId)
        .in("kind", kinds)
        .gte("updated_at", startedAt.toISOString())
        .lte("updated_at", new Date(finishedAt.getTime() + 1000).toISOString());
      alerts = (data ?? []).map((a) => ({ kind: a.kind as string, title: a.title as string, count: (a.item_count as number) ?? 1 }));
    }
    const errors = collectErrors(entry);
    const status = errors.length ? "error" : alerts.length ? "changed" : "no-change";
    const nums = numbersLine(entry);
    const summary =
      status === "error"
        ? errors.join(" | ")
        : status === "changed"
          ? alerts.map((a) => a.title).join(" | ")
          : `Verificou — nenhuma alteração${nums ? ` (${nums})` : ""}`;

    await db.from("automation_runs").insert({
      user_id: userId,
      automation,
      status,
      summary: summary.slice(0, 2000),
      details: { ...extra, result: entry, alerts, numbers: nums },
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
    });
  }

  // Limpa o que passou de 30 dias.
  await db
    .from("automation_runs")
    .delete()
    .lt("started_at", new Date(Date.now() - RUN_TTL_DAYS * 86_400_000).toISOString());
}

// Embrulha o POST de um hook: roda normalmente e, no fim, grava a rodada no registro.
export function withRunLog(automation: string, handler: (request: Request) => Promise<Response>) {
  return async function POST(request: Request): Promise<Response> {
    const startedAt = new Date();
    const res = await handler(request);
    if (res.status === 401) return res; // chamada sem o segredo: não é rodada de verdade
    try {
      await logRuns(automation, startedAt, res.clone());
    } catch {
      // o registro nunca derruba a automação
    }
    return res;
  };
}
