// Verificação de EXAME (Etapa 163). Pra cada conta que PRECISA de exame, olha só os anúncios ATIVOS na Meta (effective_status ACTIVE,
// o que já exige conjunto e campanha ligados) e confere, pelo NOME do conjunto, se algum é de EXAME. Sem nenhum → avisa em Alertas.
// Só LÊ da Meta (nunca altera nada). O resultado fica num retrato (meta_insights_cache, chave `exam_status:v1`) que a tela lê ao abrir.
// Sem repetir: a mesma conta só avisa UMA vez por dia (confere as linhas já gravadas hoje).

import type { createClient } from "@/lib/supabase/server";
import { metaGetAll } from "@/lib/meta/client";
import { todayBrt } from "@/lib/meta/daily-range";
import { publishAlert } from "@/lib/alerts/notifications";
import { hourBrt, isWatchHour } from "@/lib/alerts/no-delivery-rule";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import { examRequired, formatExamLine, isExamAdsetName } from "@/lib/exam/rule";

type Db = Awaited<ReturnType<typeof createClient>>;

const KEY = "exam_status:v1";
const CONCURRENCY = 4;
const VAGA_RE = /\bvaga\b/i;

export interface ExamAccount {
  accountId: string;
  clientName: string;
  explicit: boolean | null; // escolha manual (null = padrão)
  required: boolean;
}

export interface ExamStatus {
  accountId: string;
  examAdsets: string[]; // nomes dos conjuntos de EXAME ativos (sem repetir)
  checkedAt: string;
  error?: string;
}

export interface ExamSnapshot {
  accounts: Record<string, ExamStatus>;
}

export async function loadExamAccounts(db: Db, userId: string): Promise<ExamAccount[]> {
  const { data: selected, error } = await db.from("user_selected_accounts").select("ad_account_id").eq("user_id", userId);
  if (error) throw error;
  const off = await inactiveAccountIds(db, userId);
  const ids = (selected ?? []).map((s) => s.ad_account_id as string).filter((id) => !off.has(id));
  if (ids.length === 0) return [];
  // Tolerante: se a coluna needs_exam ainda não existe (SQL 0035 não rodado), segue só com o padrão.
  let rows: Array<{ ad_account_id: string; client_name: string | null; needs_exam?: boolean | null }> = [];
  const withCol = await db.from("account_bindings").select("ad_account_id, client_name, needs_exam").eq("user_id", userId).in("ad_account_id", ids);
  if (!withCol.error) rows = (withCol.data ?? []) as typeof rows;
  else {
    const plain = await db.from("account_bindings").select("ad_account_id, client_name").eq("user_id", userId).in("ad_account_id", ids);
    if (plain.error) throw plain.error;
    rows = (plain.data ?? []) as typeof rows;
  }
  return rows
    .map((b) => {
      const clientName = (b.client_name ?? "").trim() || b.ad_account_id;
      const explicit = typeof b.needs_exam === "boolean" ? b.needs_exam : null;
      return { accountId: b.ad_account_id, clientName, explicit, required: examRequired(explicit, clientName) };
    })
    .sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));
}

export async function readExamSnapshot(db: Db, userId: string): Promise<ExamSnapshot> {
  const { data, error } = await db.from("meta_insights_cache").select("payload").eq("user_id", userId).eq("cache_key", KEY).maybeSingle();
  if (error) throw error;
  return (data?.payload as ExamSnapshot | undefined) ?? { accounts: {} };
}

async function saveExamStatuses(db: Db, userId: string, list: ExamStatus[]): Promise<void> {
  if (list.length === 0) return;
  const cur = await readExamSnapshot(db, userId);
  for (const s of list) cur.accounts[s.accountId] = s;
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const { error } = await db
    .from("meta_insights_cache")
    .upsert({ user_id: userId, cache_key: KEY, payload: cur, expires_at: expiresAt }, { onConflict: "user_id,cache_key" });
  if (error) throw error;
}

interface ActiveAdRow {
  id: string;
  adset_id?: string;
  adset?: { name?: string };
  campaign?: { name?: string };
}

export async function examForAccount(token: string, accountId: string): Promise<string[]> {
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const ads = await metaGetAll<ActiveAdRow>(
    token,
    `/${act}/ads`,
    {
      fields: "id,adset_id,adset{name},campaign{name}",
      limit: "500",
      filtering: JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] }]),
    },
    6,
  );
  const names = new Map<string, string>();
  for (const a of ads) {
    const name = a.adset?.name ?? "";
    if (!name || VAGA_RE.test(a.campaign?.name ?? "")) continue;
    if (isExamAdsetName(name)) names.set(a.adset_id ?? name, name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

// Confere as contas pedidas e guarda no retrato. Conta com erro na Meta fica com `error` (não gera alerta falso).
export async function checkExamAccounts(db: Db, userId: string, token: string, accountIds: string[]): Promise<ExamStatus[]> {
  const out: ExamStatus[] = [];
  let next = 0;
  const worker = async () => {
    while (next < accountIds.length) {
      const id = accountIds[next++];
      const checkedAt = new Date().toISOString();
      try {
        out.push({ accountId: id, examAdsets: await examForAccount(token, id), checkedAt });
      } catch (e) {
        out.push({ accountId: id, examAdsets: [], checkedAt, error: (e as Error).message.slice(0, 200) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accountIds.length) }, worker));
  await saveExamStatuses(db, userId, out);
  return out;
}

export interface ExamCheckResult {
  checked: number;
  missing: string[]; // nomes das contas sem exame ativo
  newAlerts: number;
  failed: string[];
  skippedOutsideHours: boolean;
  sendError: string | null;
}

// Rotina do dia (hook exam-check-tick): só contas que precisam de exame. Fora de 8h–21h não faz nada (a menos de ignoreHours).
export async function runExamCheck(db: Db, userId: string, token: string, opts: { send: boolean; ignoreHours?: boolean }): Promise<ExamCheckResult> {
  if (!opts.ignoreHours && !isWatchHour(hourBrt())) {
    return { checked: 0, missing: [], newAlerts: 0, failed: [], skippedOutsideHours: true, sendError: null };
  }
  const accounts = (await loadExamAccounts(db, userId)).filter((a) => a.required);
  const statuses = await checkExamAccounts(db, userId, token, accounts.map((a) => a.accountId));
  const nameBy = new Map(accounts.map((a) => [a.accountId, a.clientName]));
  const failed = statuses.filter((s) => s.error).map((s) => nameBy.get(s.accountId) ?? s.accountId);
  const missingNames = statuses.filter((s) => !s.error && s.examAdsets.length === 0).map((s) => nameBy.get(s.accountId) ?? s.accountId).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const since = `${todayBrt()}T03:00:00.000Z`;
  const { data: prev } = await db.from("alert_notifications").select("body").eq("user_id", userId).eq("kind", "exam-missing").gte("created_at", since);
  const prevLines = new Set((prev ?? []).flatMap((r) => String(r.body ?? "").split("\n")));
  const fresh = missingNames.map(formatExamLine).filter((l) => !prevLines.has(l));

  let sendError: string | null = null;
  if (opts.send && fresh.length > 0) {
    try {
      await publishAlert(db, userId, {
        kind: "exam-missing",
        title: `🔎 Conta sem conjunto de EXAME ativo (${fresh.length} conta${fresh.length > 1 ? "s" : ""})`,
        body: fresh.join("\n"),
        count: fresh.length,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }
  return { checked: statuses.length, missing: missingNames, newAlerts: opts.send ? fresh.length : 0, failed, skippedOutsideHours: false, sendError };
}
