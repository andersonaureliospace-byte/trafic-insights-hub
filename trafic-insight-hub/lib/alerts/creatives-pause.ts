// Pausa automática de Criativos acima da meta (Etapa 53) — pensada pra
// rodar de 3 em 3 horas (02h/05h/08h/11h/14h/17h/20h/23h, n8n; Etapa 104/105),
// pausando sozinho todo criativo ATIVO com custo por conversa (ou gasto, sem
// conversa) R$4+ acima da Meta CPA — e avisando no grupo de WhatsApp quais
// criativos foram pausados.
// Etapa 104 (mais agressivo): o período agora é ONTEM + HOJE (antes, últimos 3 dias
// + hoje). Criativo com histórico bom nos últimos 7 dias (CPA de 7 dias abaixo do
// ideal, a "linha verde" de Análise) só é pausado se também estiver R$4+ acima nos
// últimos dois dias + hoje. Regras puras em lib/alerts/creative-decision.ts.
// Etapa 105: existe também uma versão só dos criativos SEM resultado (opts.onlyNoResult),
// chamada de hora em hora por outro endpoint (creatives-no-result-tick).
// Sem cooldown: como o critério é "ainda ATIVO e acima do limite", um criativo já
// pausado nessa rodada simplesmente não aparece mais nas rodadas seguintes
// (deixou de ser ATIVO), então não tem re-pausa nem re-aviso do mesmo criativo.
// Etapa 56: as pausas na Meta agora saem uma de cada vez, com 3s de
// intervalo (setEntitiesStatusSequential), em vez de todas em paralelo —
// mesma pauta de segurança contra rate limit que os botões manuais de
// Análise já seguem (BULK_DELAY_MS).
//
// Etapa 76 (correção): universo de contas restrito a user_selected_accounts
// ("Contas exibidas" do Painel) — mesmo critério já usado em
// bulk-status-update.ts. Antes, essa automação varria TODO account_bindings
// com cpa_target preenchido, então uma conta desmarcada do Painel (mas ainda
// com meta de CPA cadastrada de antes) continuava tendo criativos pausados
// sozinha, sem aparecer em lugar nenhum da tela — bug relatado com a conta
// "Marcia Dantas".

import type { createClient } from "@/lib/supabase/server";
import { getCreativeCostAnalysis, type CreativeCostRow } from "@/lib/meta/creative-analysis";
import { decideCreativePause } from "@/lib/alerts/creative-decision";
import { spDate, type DateRangeInput } from "@/lib/meta/client";
import { setEntitiesStatusSequential } from "@/lib/meta/status";
import { publishAlert } from "@/lib/alerts/notifications";
import { fmtCurrency } from "@/lib/format";

import { inactiveAccountIds } from "@/lib/accounts/inactive";
type Db = Awaited<ReturnType<typeof createClient>>;
const DATE_PRESET = "today_yesterday" as const; // ontem + hoje
const DATE_PRESET_7D = "last_7d" as const;

// Anteontem + ontem + hoje (fuso de Brasília): "os últimos dois dias + hoje".
function twoDaysPlusToday(now: Date = new Date()): DateRangeInput {
  return { since: spDate(new Date(now.getTime() - 2 * 86_400_000)), until: spDate(now) };
}
const STATUSES = ["ACTIVE"];

export interface PausedCreative {
  ad_account_id: string;
  client_name: string;
  ad_id: string;
  ad_name: string;
  spend: number;
  cost_per_conversation: number | null;
  good_history?: boolean; // tinha histórico bom nos 7 dias e mesmo assim passou do limite nos 2 dias + hoje
  ok: boolean;
  error?: string;
}

export interface CheckCreativesPauseResult {
  paused: PausedCreative[];
  sendError: string | null;
}

export async function checkAndPauseCreatives(
  db: Db,
  userId: string,
  token: string,
  // onlyNoResult (Etapa 105): só criativo SEM nenhuma conversa no período (gastou e não trouxe
  // resultado). Roda com mais frequência (de hora em hora) que a verificação completa, já que o
  // criativo ruim (com conversa, só caro) ainda pode reverter.
  opts: { send: boolean; onlyNoResult?: boolean } = { send: false },
): Promise<CheckCreativesPauseResult> {
  const { data: selected, error: selectedErr } = await db
    .from("user_selected_accounts")
    .select("ad_account_id")
    .eq("user_id", userId);
  if (selectedErr) throw selectedErr;
  const off = await inactiveAccountIds(db, userId);
  const accountIds = (selected ?? []).map((s) => s.ad_account_id as string).filter((id) => !off.has(id));
  if (accountIds.length === 0) return { paused: [], sendError: null };

  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target")
    .eq("user_id", userId)
    .in("ad_account_id", accountIds)
    .not("cpa_target", "is", null);
  if (bindingsErr) throw bindingsErr;
  if (!bindings || bindings.length === 0) return { paused: [], sendError: null };

  const flagged: { ad_account_id: string; client_name: string; ad_id: string; ad_name: string; spend: number; cost_per_conversation: number | null; good_history: boolean }[] = [];

  await Promise.all(
    bindings.map(async (b) => {
      const accountId = b.ad_account_id as string;
      const cpaTarget = b.cpa_target as number;
      const clientName = (b.client_name as string | null) || accountId;
      try {
        const rows = await getCreativeCostAnalysis(token, accountId, DATE_PRESET);
        const active = rows.filter(
          (r) =>
            STATUSES.includes((r.status ?? "").toUpperCase()) &&
            (!opts.onlyNoResult || !r.conversations || r.conversations <= 0),
        );
        // Só busca 7 dias / 2 dias + hoje se a conta tiver algum criativo acima do limite.
        const first = active.filter(
          (r) =>
            decideCreativePause({ cpaTarget, m2: r, m7: undefined, sevenDayFetched: false, m3: undefined, threeDayFetched: false })
              .action !== "none",
        );
        if (first.length === 0) return;
        let rows7: CreativeCostRow[] | null = null;
        try {
          rows7 = await getCreativeCostAnalysis(token, accountId, DATE_PRESET_7D);
        } catch (e) {
          console.error("creatives-pause 7d err (não decide sem o histórico)", accountId, e);
        }
        const by7 = new Map((rows7 ?? []).map((r) => [r.id, r]));
        const needs3 = rows7 !== null && first.some((r) => {
          const r7 = by7.get(r.id);
          return (
            decideCreativePause({ cpaTarget, m2: r, m7: r7, sevenDayFetched: true, m3: undefined, threeDayFetched: false }).action ===
            "skip"
          );
        });
        let rows3: CreativeCostRow[] | null = [];
        if (needs3) {
          try {
            rows3 = await getCreativeCostAnalysis(token, accountId, twoDaysPlusToday());
          } catch (e) {
            console.error("creatives-pause 2d+hoje err (não decide sem o histórico)", accountId, e);
            rows3 = null;
          }
        }
        const by3 = new Map((rows3 ?? []).map((r) => [r.id, r]));
        for (const r of first) {
          const decision = decideCreativePause({
            cpaTarget,
            m2: r,
            m7: by7.get(r.id),
            sevenDayFetched: rows7 !== null,
            m3: by3.get(r.id),
            threeDayFetched: rows3 !== null,
          });
          if (decision.action !== "pause") continue;
          flagged.push({
            ad_account_id: accountId,
            client_name: clientName,
            ad_id: r.id,
            ad_name: r.name,
            spend: r.spend,
            cost_per_conversation: r.cost_per_conversation,
            good_history: decision.goodHistory,
          });
        }
      } catch (e) {
        console.error("creatives-pause analysis err (non-fatal)", accountId, e);
      }
    }),
  );

  let paused: PausedCreative[] = [];
  if (flagged.length > 0) {
    const results = await setEntitiesStatusSequential(
      token,
      flagged.map((f) => ({ id: f.ad_id, type: "ad" as const })),
      "PAUSED",
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    paused = flagged.map((f) => {
      const r = byId.get(f.ad_id);
      return { ...f, ok: !!r?.ok, error: r?.ok ? undefined : (r?.error ?? "Erro desconhecido") };
    });
  }

  const pausedOk = paused.filter((p) => p.ok).sort((a, b) => b.spend - a.spend);

  let sendError: string | null = null;
  if (opts.send && pausedOk.length > 0) {
    try {
      const lines = pausedOk.map(
        (p, i) =>
          `${i + 1}. ${p.client_name} — ${p.ad_name}: ${
            p.cost_per_conversation != null
              ? `${fmtCurrency(p.cost_per_conversation)}/conversa`
              : `gasto ${fmtCurrency(p.spend)} sem conversa`
          }${p.good_history ? " · 7 dias bom, mas acima nos 2 dias + hoje" : ""}`,
      );
      await publishAlert(db, userId, {
        kind: opts.onlyNoResult ? "creatives-no-result" : "creatives-pause",
        title: `⏸️ ${
          opts.onlyNoResult ? "Criativos sem resultado pausados automaticamente (gasto acima da meta sem nenhuma conversa, ontem + hoje)" : "Criativos pausados automaticamente (CPA acima da meta ontem + hoje)"
        } — ${pausedOk.length} anúncio${pausedOk.length > 1 ? "s" : ""}`,
        body: lines.join("\n"),
        count: pausedOk.length,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { paused, sendError };
}
