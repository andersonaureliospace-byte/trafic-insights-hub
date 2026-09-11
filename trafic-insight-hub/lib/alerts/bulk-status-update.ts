// Atualização de status em massa, automática (Etapa 55) — pensada pra rodar
// segunda e quinta às 01h, sempre com o CPA dos últimos 3 dias SEM contar
// hoje (getAccountsDailyCpa com includeToday=false). MESMA lógica de
// classificação do botão manual "Atualizar status em massa" de Acompanhamento
// (components/painel/bulk-status-dialog.tsx: classify()) — duplicada aqui de
// propósito, já que aquele arquivo é "use client" e não dá pra importar num
// endpoint de servidor.
//
// Universo de contas: user_selected_accounts ("Contas exibidas" do Painel
// inteiro) — não o `rows` filtrado de nenhuma tela específica, já que essa
// automação não tem estado de filtro nenhum pra respeitar.
//
// Além de reclassificar (e escrever o novo status em account_bindings.priority
// quando muda), essa automação também reordena o quadro inteiro de
// Acompanhamento (account_bindings.sort_order) — pedido à parte do Anderson:
// agrupar por status (da situação mais crítica pra menos crítica) e, dentro
// de cada status, ordenar do maior CPA pro menor. Isso NÃO é replicado no
// diálogo manual (que trabalha só com o subconjunto filtrado da tela, onde um
// reordenar do quadro inteiro poderia bagunçar linhas que nem entraram na
// avaliação) — só a automação reordena.
//
// Sem cooldown — quem controla a frequência é o agendamento do n8n; rodar de
// novo com os mesmos dados simplesmente reclassifica pro mesmo status
// (next === priority atual → "unchanged", nada é escrito nem avisado).

import type { createClient } from "@/lib/supabase/server";
import { getAccountsDailyCpa } from "@/lib/meta/daily-cpa";
import { getPriorityOptions } from "@/lib/priority-labels";
import { isInauguracao } from "@/lib/format";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";

type Db = Awaited<ReturnType<typeof createClient>>;

// Mesma função de components/painel/bulk-status-dialog.tsx — mantenha as
// duas em sincronia se o critério mudar de novo.
function classify(cpa: number, target: number): string {
  const diff = cpa - target;
  if (diff < 0) return "baixa";
  if (diff <= 2) return "media";
  if (diff <= 3) return "alta";
  return "critica";
}

// Da situação mais crítica (maior número) pra menos crítica — usado só pra
// ordenar o quadro. Inauguração fica no fundo (abaixo até de "baixa"), e uma
// conta sem status nenhum cadastrado fica no fundo de tudo.
const SEVERITY_RANK: Record<string, number> = {
  critica: 4,
  alta: 3,
  media: 2,
  baixa: 1,
  inauguracao: 0,
};
function severityRank(priority: string | null): number {
  if (priority == null) return -1;
  return SEVERITY_RANK[priority] ?? -1;
}

export interface BulkStatusResult {
  accountId: string;
  clientName: string;
  outcome: "updated" | "unchanged" | "skipped";
  from?: string | null;
  to?: string | null;
  reason?: string;
}

export interface CheckBulkStatusResult {
  results: BulkStatusResult[];
  sendError: string | null;
}

export async function checkAndUpdateBulkStatus(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean } = { send: false },
): Promise<CheckBulkStatusResult> {
  const { data: selected, error: selectedErr } = await db
    .from("user_selected_accounts")
    .select("ad_account_id")
    .eq("user_id", userId);
  if (selectedErr) throw selectedErr;
  const accountIds = (selected ?? []).map((s) => s.ad_account_id as string);
  if (accountIds.length === 0) return { results: [], sendError: null };

  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target, priority")
    .eq("user_id", userId)
    .in("ad_account_id", accountIds);
  if (bindingsErr) throw bindingsErr;
  const bindingByAccount = new Map((bindings ?? []).map((b) => [b.ad_account_id as string, b]));

  // Últimos 3 dias, sem contar hoje — igual ao diálogo manual (days=3, sem
  // includeToday), só que numa chamada só pra todas as contas de uma vez.
  const dailyCpa = await getAccountsDailyCpa(token, accountIds, 3, false);

  interface Entry {
    accountId: string;
    clientName: string;
    currentPriority: string | null;
    finalPriority: string | null;
    rawCpa: number | null;
    result: BulkStatusResult;
  }

  const entries: Entry[] = accountIds.map((accountId) => {
    const binding = bindingByAccount.get(accountId);
    const clientName = (binding?.client_name as string | null) || accountId;
    const currentPriority = (binding?.priority as string | null) ?? null;
    const cpaTarget = (binding?.cpa_target as number | null) ?? null;

    const points = dailyCpa[accountId] ?? [];
    const spend = points.reduce((s, p) => s + p.spend, 0);
    const totalResults = points.reduce((s, p) => s + p.results, 0);
    const rawCpa = spend > 0 ? (totalResults > 0 ? spend / totalResults : spend) : null;

    if (isInauguracao(currentPriority)) {
      return {
        accountId,
        clientName,
        currentPriority,
        finalPriority: currentPriority,
        rawCpa,
        result: { accountId, clientName, outcome: "skipped", reason: "Em inauguração" },
      };
    }
    if (!cpaTarget) {
      return {
        accountId,
        clientName,
        currentPriority,
        finalPriority: currentPriority,
        rawCpa,
        result: { accountId, clientName, outcome: "skipped", reason: "Sem meta de CPA" },
      };
    }
    if (spend <= 0) {
      return {
        accountId,
        clientName,
        currentPriority,
        finalPriority: currentPriority,
        rawCpa,
        result: { accountId, clientName, outcome: "skipped", reason: "Sem gasto nos últimos 3 dias" },
      };
    }

    const next = classify(rawCpa as number, cpaTarget);
    if (next === currentPriority) {
      return {
        accountId,
        clientName,
        currentPriority,
        finalPriority: currentPriority,
        rawCpa,
        result: { accountId, clientName, outcome: "unchanged", to: next },
      };
    }
    return {
      accountId,
      clientName,
      currentPriority,
      finalPriority: next,
      rawCpa,
      result: { accountId, clientName, outcome: "updated", from: currentPriority, to: next },
    };
  });

  // Reordena o quadro inteiro: por status (mais crítico primeiro) e, dentro
  // do mesmo status, pelo CPA dos últimos 3 dias (maior primeiro). Contas sem
  // CPA calculável (sem gasto) ficam por último dentro do próprio status,
  // desempatando por nome do cliente.
  const sorted = [...entries].sort((a, b) => {
    const rankDiff = severityRank(b.finalPriority) - severityRank(a.finalPriority);
    if (rankDiff !== 0) return rankDiff;
    if (a.rawCpa == null && b.rawCpa == null) return a.clientName.localeCompare(b.clientName, "pt-BR");
    if (a.rawCpa == null) return 1;
    if (b.rawCpa == null) return -1;
    if (b.rawCpa !== a.rawCpa) return b.rawCpa - a.rawCpa;
    return a.clientName.localeCompare(b.clientName, "pt-BR");
  });

  const upsertRows = sorted.map((e, i) => ({
    user_id: userId,
    ad_account_id: e.accountId,
    sort_order: i,
    updated_at: new Date().toISOString(),
    ...(e.result.outcome === "updated" ? { priority: e.finalPriority } : {}),
  }));
  const { error: upsertErr } = await db
    .from("account_bindings")
    .upsert(upsertRows, { onConflict: "user_id,ad_account_id" });
  if (upsertErr) throw upsertErr;

  const results = entries.map((e) => e.result);
  const updated = results.filter((r) => r.outcome === "updated");
  // Etapa 55 (ajuste): a mensagem agora leva o status de TODO cliente
  // classificado nessa rodada — mudou ou não —, sempre "cliente: status",
  // sem dizer se mudou ou se manteve (isso só aparece na tabela da tela
  // manual). Continua de fora quem foi pulado (inauguração, sem meta de
  // CPA ou sem gasto no período), já que esses não têm um status novo
  // calculado nessa rodada.
  const unchanged = results.filter((r) => r.outcome === "unchanged");
  const reportable = [...updated, ...unchanged];

  let sendError: string | null = null;
  if (opts.send && reportable.length > 0) {
    try {
      const instance = await requireWhatsappInstance(db, userId);
      if (!instance.alerts_group_id) {
        throw new Error("Cadastre o grupo de avisos em Configurações → WhatsApp antes de verificar.");
      }
      const priorityOptions = await getPriorityOptions(db, userId);
      const labelFor = (id?: string | null) => priorityOptions.find((p) => p.id === id)?.label ?? "—";
      const lines = [...reportable]
        .sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"))
        .map((r) => `${r.clientName}: ${labelFor(r.to)}`);
      // Sem cabeçalho, sem emoji, sem comentário, sem indicar se mudou ou
      // manteve — só "cliente: status", um por linha, como pedido.
      const message = lines.join("\n");
      await sendText({ api_url: instance.api_url, token: instance.token }, instance.alerts_group_id, message);
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { results, sendError };
}
