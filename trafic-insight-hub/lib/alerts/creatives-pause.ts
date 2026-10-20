// Pausa automática de Criativos acima da meta (Etapa 53) — pensada pra
// rodar de 3 em 3 horas (02h/05h/08h/11h/14h/17h/20h/23h, n8n; Etapa 104/105),
// pausando sozinho todo criativo ATIVO com custo por conversa (ou gasto, sem
// conversa) R$4+ acima da Meta CPA — e avisando no grupo de WhatsApp quais
// criativos foram pausados.
// Etapa 104 (mais agressivo): o período agora é ONTEM + HOJE (antes, últimos 3 dias
// + hoje). Criativo com histórico bom nos últimos 7 dias (CPA de 7 dias abaixo do
// ideal, a "linha verde" de Análise) só é pausado se também estiver R$4+ acima nos
// últimos dois dias + hoje. Regras puras em lib/alerts/creative-decision.ts.
// Etapas 133/134: criativo NOVO (< 48h) acima da meta no acumulado de ontem + hoje, mas com HOJE (só hoje) já
// dentro da meta (com conversa) e o acumulado ainda dentro de 3x a Meta CPA, não é pausado nesta rodada —
// espera a próxima (holdBecauseTodayIsGood).
// Etapa 136: FREIO DE SEGURANÇA — por conjunto, se a rodada fosse pausar mais de 70% dos criativos ativos dele, pausa só os
// piores até os 70% e mantém os menos ruins (a rodada seguinte reavalia). Criativo que passou de 3x a Meta CPA fica fora
// do freio (sempre pausa). Regras puras em lib/alerts/pause-brake.ts.
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
import { decideCreativePause, holdBecauseTodayIsGood } from "@/lib/alerts/creative-decision";
import { applyPauseBrake, isTripleOverTarget, severityOf, BRAKE_MAX_SHARE } from "@/lib/alerts/pause-brake";
import { spDate, type DateRangeInput } from "@/lib/meta/client";
import { setEntitiesStatusSequential } from "@/lib/meta/status";
import { publishAlert } from "@/lib/alerts/notifications";
import { isWeekendBR, loadStandby, putAdsetOnStandby, standbyStepDone, type StandbyRecord } from "@/lib/alerts/weekend";
import { logAutoPauses } from "@/lib/alerts/pause-log";
import { STANDBY_BUDGET_CENTS } from "@/lib/meta/budget";
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
  cpa_target?: number; // Meta CPA da conta na hora da pausa (aparece no alerta)
  age_hours?: number | null; // idade do anúncio na hora da pausa
  ok: boolean;
  error?: string;
}

// Etapa 136: criativo que passou do limite mas foi MANTIDO ativo pelo freio de segurança (70%).
export interface HeldCreative {
  ad_account_id: string;
  client_name: string;
  ad_id: string;
  ad_name: string;
  spend: number;
  cost_per_conversation: number | null;
  cpa_target: number;
}

export interface CheckCreativesPauseResult {
  paused: PausedCreative[];
  held: HeldCreative[];
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
  if (accountIds.length === 0) return { paused: [], held: [], sendError: null };

  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target")
    .eq("user_id", userId)
    .in("ad_account_id", accountIds)
    .not("cpa_target", "is", null);
  if (bindingsErr) throw bindingsErr;
  if (!bindings || bindings.length === 0) return { paused: [], held: [], sendError: null };

  const nowDate = new Date();
  // Etapa 158: no fim de semana a escada é 1º reduzir o orçamento do conjunto (R$10), 2º pausar o criativo (6h depois,
  // se não melhorou), 3º pausar o conjunto (lib/alerts/adsets-pause.ts). Sem a tabela do standby, não pausa criativo
  // por desempenho no fim de semana (não pula o passo 1).
  const weekend = isWeekendBR(nowDate);
  let standby = new Map<string, StandbyRecord>();
  let standbyOk = true;
  if (weekend) {
    try {
      standby = await loadStandby(db, userId);
    } catch (e) {
      standbyOk = false;
      console.error("creatives-pause standby err", (e as Error).message);
    }
  }
  const standbyLines: string[] = [];
  const flagged: {
    ad_account_id: string;
    client_name: string;
    ad_id: string;
    ad_name: string;
    spend: number;
    conversations: number | null;
    cost_per_conversation: number | null;
    good_history: boolean;
    cpa_target: number;
    age_hours: number | null;
  }[] = [];
  const heldAll: HeldCreative[] = [];

  await Promise.all(
    bindings.map(async (b) => {
      const accountId = b.ad_account_id as string;
      const cpaTarget = b.cpa_target as number;
      const clientName = (b.client_name as string | null) || accountId;
      try {
        const rows = await getCreativeCostAnalysis(token, accountId, DATE_PRESET);
        const allActive = rows.filter((r) => STATUSES.includes((r.status ?? "").toUpperCase()));
        const active = allActive.filter((r) => !opts.onlyNoResult || !r.conversations || r.conversations <= 0);
        // Etapa 136: quantos criativos ativos cada conjunto tem (base dos 70% do freio).
        const activeByAdset = new Map<string, number>();
        for (const r of allActive) if (r.adset_id) activeByAdset.set(r.adset_id, (activeByAdset.get(r.adset_id) ?? 0) + 1);
        // Só busca 7 dias / 2 dias + hoje se a conta tiver algum criativo acima do limite.
        const flaggedAll = active.filter(
          (r) =>
            decideCreativePause({ cpaTarget, m2: r, m7: undefined, sevenDayFetched: false, m3: undefined, threeDayFetched: false })
              .action !== "none",
        );
        if (flaggedAll.length === 0) return;
        // Etapa 133: olha só o dia de hoje antes de pausar. Se a busca falhar, não decide no escuro (pula a conta).
        let rowsToday: CreativeCostRow[];
        try {
          const todayStr = spDate(new Date());
          rowsToday = await getCreativeCostAnalysis(token, accountId, { since: todayStr, until: todayStr });
        } catch (e) {
          console.error("creatives-pause hoje err (não decide sem olhar hoje)", accountId, e);
          return;
        }
        const byToday = new Map(rowsToday.map((r) => [r.id, r]));
        const first = flaggedAll.filter(
          (r) =>
            !holdBecauseTodayIsGood({ cpaTarget, createdTime: r.created_time, now: nowDate, m2: r, mToday: byToday.get(r.id) }),
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
        const toPause: { r: CreativeCostRow; goodHistory: boolean }[] = [];
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
          toPause.push({ r, goodHistory: decision.goodHistory });
        }
        // Etapa 158: fim de semana — passo 1 (reduzir o conjunto pra R$10) antes de pausar criativo.
        if (weekend) {
          const kept: typeof toPause = [];
          if (standbyOk) {
            for (const t of toPause) {
              const adsetId = t.r.adset_id;
              if (!adsetId) {
                kept.push(t);
                continue;
              }
              const sb = standby.get(adsetId);
              if (!sb) {
                const out = await putAdsetOnStandby(db, userId, token, {
                  adset_id: adsetId,
                  ad_account_id: accountId,
                  client_name: clientName,
                  adset_name: t.r.adset_name ?? adsetId,
                  reason: "acima da meta (fim de semana)",
                });
                standby.set(adsetId, {
                  adset_id: adsetId,
                  ad_account_id: accountId,
                  client_name: clientName,
                  adset_name: t.r.adset_name ?? adsetId,
                  campaign_id: null,
                  kind: out.kind === "standby" ? "standby" : "no_cut",
                  reason: "acima da meta (fim de semana)",
                  from_budget: null,
                  to_budget: null,
                  started_at: new Date().toISOString(),
                });
                standbyLines.push(
                  out.kind === "standby"
                    ? `• ${clientName} — ${t.r.adset_name ?? adsetId}: ${fmtCurrency(out.from)} → ${fmtCurrency(out.to)} (criativo caro "${t.r.name}" fica; se não melhorar, pausa depois)`
                    : out.kind === "no_cut"
                      ? `• ${clientName} — ${t.r.adset_name ?? adsetId}: não reduzi (${out.why})`
                      : `• ${clientName} — ${t.r.adset_name ?? adsetId}: erro ao reduzir (${out.error}) — tento de novo na próxima rodada`,
                );
                continue;
              }
              if (!standbyStepDone(sb, nowDate)) continue;
              kept.push(t);
            }
          }
          toPause.length = 0;
          toPause.push(...kept);
        }
        // Etapa 136: freio de segurança por conjunto (70%).
        const groups = new Map<string, typeof toPause>();
        for (const t of toPause) {
          const key = t.r.adset_id ?? `solo:${t.r.id}`;
          const list = groups.get(key) ?? [];
          list.push(t);
          groups.set(key, list);
        }
        for (const [key, list] of groups) {
          const total = key.startsWith("solo:") ? 1 : (activeByAdset.get(key) ?? list.length);
          const brake = applyPauseBrake(
            list.map((t) => ({ id: t.r.id, severity: severityOf(t.r, cpaTarget), exempt: isTripleOverTarget(t.r, cpaTarget) })),
            total,
          );
          const pauseIds = new Set(brake.pause);
          for (const t of list) {
            const base = {
              ad_account_id: accountId,
              client_name: clientName,
              ad_id: t.r.id,
              ad_name: t.r.name,
              spend: t.r.spend,
              conversations: t.r.conversations,
              cost_per_conversation: t.r.cost_per_conversation,
              cpa_target: cpaTarget,
            };
            if (pauseIds.has(t.r.id)) {
              flagged.push({
                ...base,
                good_history: t.goodHistory,
                age_hours: t.r.created_time ? Math.round((nowDate.getTime() - new Date(t.r.created_time).getTime()) / 3_600_000) : null,
              });
            } else {
              heldAll.push(base);
            }
          }
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
      return {
        ad_account_id: f.ad_account_id,
        client_name: f.client_name,
        ad_id: f.ad_id,
        ad_name: f.ad_name,
        spend: f.spend,
        cost_per_conversation: f.cost_per_conversation,
        good_history: f.good_history,
        cpa_target: f.cpa_target,
        age_hours: f.age_hours,
        ok: !!r?.ok,
        error: r?.ok ? undefined : (r?.error ?? "Erro desconhecido"),
      };
    });
  }

  const pausedOk = paused.filter((p) => p.ok).sort((a, b) => b.spend - a.spend);

  // Etapa 158: registro das pausas (o backup da rodada seguinte reativa quem melhorou).
  if (pausedOk.length > 0) {
    const convById = new Map(flagged.map((f) => [f.ad_id, f.conversations]));
    await logAutoPauses(
      db,
      userId,
      pausedOk.map((p) => ({
        entity_type: "ad" as const,
        entity_id: p.ad_id,
        ad_account_id: p.ad_account_id,
        client_name: p.client_name,
        entity_name: p.ad_name,
        spend: p.spend,
        conversations: convById.get(p.ad_id) ?? null,
        cpa: p.cost_per_conversation,
        reason: "desempenho",
      })),
    );
  }

  let sendError: string | null = null;
  if (opts.send && standbyLines.length > 0) {
    try {
      await publishAlert(db, userId, {
        kind: "adsets-cut",
        title: `🌙 Fim de semana: criativo acima da meta — primeiro reduzo o orçamento do conjunto pra ${fmtCurrency(STANDBY_BUDGET_CENTS / 100)} (standby) — ${standbyLines.length}`,
        body: standbyLines.join("\n"),
        count: standbyLines.length,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }
  // Etapa 136: o que o freio manteve ativo vai junto no mesmo alerta (ou num alerta só dele, se nada foi pausado).
  const heldLines = heldAll.map(
    (h) =>
      `• ${h.client_name} — ${h.ad_name}: ${
        h.cost_per_conversation != null ? `${fmtCurrency(h.cost_per_conversation)}/conversa` : `gasto ${fmtCurrency(h.spend)} sem conversa`
      } (meta ${fmtCurrency(h.cpa_target)})`,
  );
  const heldBlock =
    heldLines.length > 0
      ? `\n\n🛑 Freio de segurança (mais de ${Math.round(BRAKE_MAX_SHARE * 100)}% do conjunto passaria do limite): ${heldLines.length} criativo${
          heldLines.length > 1 ? "s" : ""
        } acima do limite ${heldLines.length > 1 ? "foram mantidos ativos" : "foi mantido ativo"} por segurança, os menos ruins — a próxima rodada reavalia:\n${heldLines.join("\n")}`
      : "";
  if (opts.send && (pausedOk.length > 0 || heldLines.length > 0)) {
    try {
      const lines = pausedOk.map((p, i) => {
        const metric =
          p.cost_per_conversation != null
            ? `${fmtCurrency(p.cost_per_conversation)}/conversa`
            : `gasto ${fmtCurrency(p.spend)} sem conversa`;
        const extra = [
          p.cpa_target != null ? `meta ${fmtCurrency(p.cpa_target)}` : null,
          p.age_hours != null ? `criado há ${p.age_hours < 48 ? `${p.age_hours}h` : `${Math.round(p.age_hours / 24)} d`}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return `${i + 1}. ${p.client_name} — ${p.ad_name}: ${metric}${extra ? ` (${extra})` : ""}${
          p.good_history ? " · 7 dias bom, mas acima nos 2 dias + hoje" : ""
        }`;
      });
      await publishAlert(db, userId, {
        kind: opts.onlyNoResult ? "creatives-no-result" : "creatives-pause",
        title:
          pausedOk.length > 0
            ? `⏸️ ${
                opts.onlyNoResult ? "Criativos sem resultado pausados automaticamente (gasto acima da meta sem nenhuma conversa, ontem + hoje)" : "Criativos pausados automaticamente (CPA acima da meta ontem + hoje)"
              } — ${pausedOk.length} anúncio${pausedOk.length > 1 ? "s" : ""}`
            : `🛑 Freio de segurança: criativos acima do limite mantidos ativos — ${heldLines.length}`,
        body: `${lines.join("\n")}${heldBlock}`.trim(),
        count: Math.max(pausedOk.length, heldLines.length),
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { paused, held: heldAll, sendError };
}
