// Etapa 112: central de notificações. Toda verificação automática chama publishAlert():
//   1) grava a notificação na tabela alert_notifications (aba "Alertas" do Painel);
//   2) manda pro grupo do WhatsApp SÓ se o tipo estiver em GROUP_KINDS (os urgentes).
// A notificação some sozinha em 72h (expires_at) ou quando o usuário clica em OK.
//
// Pra mudar o que vai pro grupo, edite só GROUP_KINDS.

import type { createClient } from "@/lib/supabase/server";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";

type Db = Awaited<ReturnType<typeof createClient>>;

export const ALERT_TTL_HOURS = 72;

export type AlertKind =
  | "creatives-pause" // criativos pausados (CPA acima da meta, ontem + hoje)
  | "creatives-no-result" // criativos sem resultado pausados
  | "adsets-paused" // conjuntos pausados
  | "adsets-cut" // orçamento do conjunto reduzido em R$10
  | "adsets-cut-failed" // conjunto que pedia corte, mas não deu pra cortar
  | "low-budget" // Invest. diário em 80% ou menos do Ritmo
  | "low-investment" // Investimento baixo (banda de R$10)
  | "cpa-yesterday" // CPA acima da meta ontem
  | "bulk-status" // Status em massa
  | "balance-low" // Saldo baixo
  | "balance-friday" // Saldo de sexta
  | "balance-evening" // Saldo das 19h: saldo − Ritmo de amanhã abaixo do limite (Etapa 156)
  | "payment-error" // Erro no pagamento
  | "morning-summary" // Resumo das 7h: contas que precisam de atenção (Etapa 137)
  | "no-delivery" // Conta sem anúncio ativo / sem entrega (Etapa 138)
  | "budget-increase" // Aumento de investimento aplicado às 6h (Etapa 139)
  | "naming-fix" // Ajuste automático de idade/data nos nomes dos conjuntos (Etapa 140)
  | "adsets-no-spend" // Conjunto sem anúncio ativo e sem gasto: só avisa, não pausa (Etapa 158)
  | "pause-backup" // Backup: conjuntos/criativos reativados porque melhoraram (Etapa 158)
  | "weekend-standby"; // Fim de semana: conjuntos em standby (R$10) e a volta de segunda (Etapa 158)

// Os únicos tipos que também vão pro grupo do WhatsApp (os mais urgentes).
export const GROUP_KINDS: ReadonlySet<AlertKind> = new Set<AlertKind>([
  "cpa-yesterday",
  "low-budget",
  "balance-low",
  "balance-friday",
  "balance-evening",
  "payment-error",
  "morning-summary",
  "no-delivery",
]);

// Avisos que se repetem a cada rodada enquanto o problema durar: em vez de empilhar uma
// linha nova toda vez, a linha aberta mais recente do mesmo tipo é atualizada.
const REPLACE_KINDS: ReadonlySet<AlertKind> = new Set<AlertKind>(["low-budget", "low-investment"]);

export interface PublishAlertInput {
  kind: AlertKind;
  title: string; // primeira linha (ex.: "🔴 CPA acima da meta ontem (3 contas)")
  body: string; // linhas da lista
  count?: number; // quantos itens (contas/anúncios/conjuntos)
  // Texto do grupo, quando precisa ser diferente de "título + linha em branco + corpo".
  groupText?: string;
}

export function isGroupKind(kind: AlertKind): boolean {
  return GROUP_KINDS.has(kind);
}

function expiryIso(): string {
  return new Date(Date.now() + ALERT_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

// Apaga as notificações vencidas (72h). Barato: usa o índice de expires_at.
export async function purgeExpiredAlerts(db: Db, userId: string): Promise<void> {
  await db.from("alert_notifications").delete().eq("user_id", userId).lt("expires_at", new Date().toISOString());
}

async function recordAlert(db: Db, userId: string, input: PublishAlertInput, sentToGroup: boolean): Promise<void> {
  const nowIso = new Date().toISOString();
  const count = input.count ?? 1;

  // Já existe uma linha aberta igual (mesmo tipo e mesmo texto, ex.: reenvio depois de falha no
  // grupo) ou, nos tipos "replace", qualquer linha aberta do tipo: atualiza em vez de duplicar.
  let query = db
    .from("alert_notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", input.kind)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1);
  if (!REPLACE_KINDS.has(input.kind)) query = query.eq("title", input.title).eq("body", input.body);
  const { data: existing, error: findErr } = await query;
  if (findErr) throw new Error(`Não consegui gravar o alerta na aba Alertas: ${findErr.message}`);

  const row = existing?.[0];
  if (row) {
    const { error } = await db
      .from("alert_notifications")
      .update({
        title: input.title,
        body: input.body,
        item_count: count,
        sent_to_group: sentToGroup,
        updated_at: nowIso,
        expires_at: expiryIso(),
      })
      .eq("id", row.id as string)
      .eq("user_id", userId);
    if (error) throw new Error(`Não consegui atualizar o alerta na aba Alertas: ${error.message}`);
    return;
  }

  const { error } = await db.from("alert_notifications").insert({
    user_id: userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    item_count: count,
    sent_to_group: sentToGroup,
    expires_at: expiryIso(),
  });
  if (error) throw new Error(`Não consegui gravar o alerta na aba Alertas: ${error.message}`);
}

// Publica um alerta. Lança erro (quem chama já trata e devolve em `sendError`):
//   - tipo urgente: erro de grupo/WhatsApp (ex.: grupo de avisos não cadastrado). O alerta
//     já ficou na aba Alertas mesmo assim, então nada se perde.
//   - tipo não urgente: erro ao gravar na aba (ex.: SQL 0028 ainda não rodado).
export async function publishAlert(db: Db, userId: string, input: PublishAlertInput): Promise<void> {
  const toGroup = isGroupKind(input.kind);

  if (!toGroup) {
    await recordAlert(db, userId, input, false);
    await purgeExpiredAlerts(db, userId).catch(() => undefined);
    return;
  }

  // Urgente: grava na aba sem deixar uma falha daqui derrubar o aviso do grupo.
  await recordAlert(db, userId, input, true).catch(() => undefined);
  await purgeExpiredAlerts(db, userId).catch(() => undefined);

  const instance = await requireWhatsappInstance(db, userId);
  if (!instance.alerts_group_id) {
    throw new Error("Cadastre o grupo de avisos em Configurações → WhatsApp antes de verificar.");
  }
  await sendText(
    { api_url: instance.api_url, token: instance.token },
    instance.alerts_group_id,
    input.groupText ?? `${input.title}\n\n${input.body}`,
  );
}
