// Checagem de "verificação manual" (Etapa 63) — não olha saldo nem status de
// pagamento: é um lembrete que o usuário agenda por conta, não importa o tipo
// (pré-paga, híbrida, pós-paga ou loja própria). Duas formas de agendar:
//   - 'weekday': um ou mais dias fixos da semana (0 = domingo … 6 = sábado) —
//     desde a Etapa 67, dá pra marcar mais de um dia (ex.: segunda E quinta),
//     não só um único dia.
//   - 'interval': "daqui X dias" a partir de quando foi configurado/verificado.
// manual_check_next_at (data, fuso America/Sao_Paulo) é o que decide se a
// conta está "pendente" agora — sempre que a data já chegou, a conta some do
// quadro de OK e some da lista até o usuário clicar em "Marcar como
// verificado" (ver /api/alerts/manual-check/verify). Mesmo padrão de
// cooldown de 24h dos outros alertas pra não reenviar WhatsApp toda hora.

import type { createClient } from "@/lib/supabase/server";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";

type Db = Awaited<ReturnType<typeof createClient>>;

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function todaySP(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

// 0 (domingo) a 6 (sábado), calculado no fuso America/Sao_Paulo — não dá pra
// usar Date.getDay() puro porque isso usa o fuso do servidor (UTC na Vercel),
// que já pode ter virado o dia em relação a Brasília.
function weekdaySP(dateStr: string): number {
  // dateStr é YYYY-MM-DD; meio-dia UTC evita qualquer problema de borda de
  // fuso na conversão de volta pro dia da semana.
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.getUTCDay();
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return todaySP(d);
}

export interface ManualCheckConfig {
  mode: "weekday" | "interval" | null;
  weekdays: number[] | null; // 0-6, um ou mais, só quando mode = 'weekday'
  intervalDays: number | null; // só quando mode = 'interval'
}

// Calcula a próxima data de lembrete a partir de `fromDateStr` (YYYY-MM-DD,
// já em horário de Brasília). `includeFrom` decide se o próprio dia inicial
// pode ser o lembrete: true na 1ª configuração (se hoje já é sexta e a
// conta foi marcada pra toda sexta, o lembrete já vale hoje); false ao
// reagendar depois de uma verificação (o próximo lembrete é sempre no
// futuro, nunca no mesmo dia que acabou de ser verificado).
export function computeManualCheckNextAt(
  config: ManualCheckConfig,
  fromDateStr: string,
  includeFrom: boolean,
): string | null {
  if (config.mode === "weekday") {
    if (!config.weekdays || config.weekdays.length === 0) return null;
    const wanted = new Set(config.weekdays);
    let candidate = includeFrom ? fromDateStr : addDays(fromDateStr, 1);
    for (let i = 0; i < 7; i++) {
      if (wanted.has(weekdaySP(candidate))) return candidate;
      candidate = addDays(candidate, 1);
    }
    return candidate; // inalcançável (loop cobre os 7 dias), só pra satisfazer o TS
  }
  if (config.mode === "interval") {
    if (!config.intervalDays || config.intervalDays <= 0) return null;
    // "Daqui X dias" sempre conta a partir de hoje/da verificação, não
    // importa se é a 1ª configuração ou um reagendamento — por isso
    // `includeFrom` não entra aqui (só faz diferença no modo 'weekday').
    return addDays(fromDateStr, config.intervalDays);
  }
  return null;
}

export interface ManualCheckStatus {
  ad_account_id: string;
  client_name: string;
  next_at: string;
  due: boolean;
  alerted: boolean;
}

export interface CheckManualReviewsResult {
  statuses: ManualCheckStatus[];
  sendError: string | null;
}

export async function checkManualReviews(
  db: Db,
  userId: string,
  opts: { send: boolean; bypassCooldown?: boolean } = { send: false },
): Promise<CheckManualReviewsResult> {
  const { data: pixRows, error: pixErr } = await db
    .from("pix_accounts")
    .select("ad_account_id, manual_check_mode, manual_check_next_at, manual_check_alert_sent_at")
    .eq("user_id", userId)
    .not("manual_check_mode", "is", null)
    .not("manual_check_next_at", "is", null);
  if (pixErr) throw pixErr;
  if (!pixRows || pixRows.length === 0) return { statuses: [], sendError: null };

  const { data: bindings } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name")
    .eq("user_id", userId);
  const clientNameById = new Map((bindings ?? []).map((b) => [b.ad_account_id as string, b.client_name as string]));

  const today = todaySP();
  const statuses: ManualCheckStatus[] = [];
  const toAlert: ManualCheckStatus[] = [];

  for (const p of pixRows) {
    const nextAt = p.manual_check_next_at as string;
    const due = nextAt <= today;
    const clientName = clientNameById.get(p.ad_account_id as string) || p.ad_account_id;
    const withinCooldown =
      !opts.bypassCooldown &&
      !!p.manual_check_alert_sent_at &&
      Date.now() - new Date(p.manual_check_alert_sent_at as string).getTime() < COOLDOWN_MS;

    const status: ManualCheckStatus = {
      ad_account_id: p.ad_account_id as string,
      client_name: clientName,
      next_at: nextAt,
      due,
      alerted: false,
    };
    statuses.push(status);
    if (due && !withinCooldown) toAlert.push(status);
  }

  let sendError: string | null = null;
  if (opts.send && toAlert.length > 0) {
    try {
      const instance = await requireWhatsappInstance(db, userId);
      if (!instance.alerts_group_id) {
        throw new Error("Cadastre o grupo de avisos em Configurações → WhatsApp antes de verificar.");
      }
      const lines = toAlert.map((s) => `🗓️ ${s.client_name}: verificação manual pendente`);
      const message = `Aviso de verificação manual\n\n${lines.join("\n")}`;
      await sendText({ api_url: instance.api_url, token: instance.token }, instance.alerts_group_id, message);
      const now = new Date().toISOString();
      for (const s of toAlert) {
        s.alerted = true;
        await db
          .from("pix_accounts")
          .update({ manual_check_alert_sent_at: now })
          .eq("user_id", userId)
          .eq("ad_account_id", s.ad_account_id);
      }
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { statuses, sendError };
}
