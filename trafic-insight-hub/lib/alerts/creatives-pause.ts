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

// Etapa 206: diagnóstico por conta — o que a rodada viu e por que cada criativo acima do limite foi (ou não) pausado.
export interface CreativeAccountDiag {
  ad_account_id: string;
  client_name: string;
  cpa_target: number;
  error: string | null; // a busca na Meta falhou mesmo depois de tentar de novo
  retried: boolean;
  notes: string[];
}

interface FlaggedCreative {
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
}

export interface CheckCreativesPauseResult {
  paused: PausedCreative[];
  held: HeldCreative[];
  sendError: string | null;
  diag: CreativeAccountDiag[];
  queued: number; // Etapa 209: no modo "queue", quantos criativos foram pra fila (a pausa é a 2ª chamada)
}

export async function checkAndPauseCreatives(
  db: Db,
  userId: string,
  token: string,
  // onlyNoResult (Etapa 105): só criativo SEM nenhuma conversa no período (gastou e não trouxe
  // resultado). Roda com mais frequência (de hora em hora) que a verificação completa, já que o
  // criativo ruim (com conversa, só caro) ainda pode reverter.
  // onlyAccountId (Etapa 206): varre só essa conta (botão "Verificar criativos de uma conta" no Registro das automações).
  // mode "queue" (Etapa 209): só analisa e grava a fila (creative_pause_queue); quem pausa é processCreativePauseQueue.
  opts: { send: boolean; onlyNoResult?: boolean; onlyAccountId?: string; mode?: "full" | "queue" } = { send: false },
): Promise<CheckCreativesPauseResult> {
  const { data: selected, error: selectedErr } = await db
    .from("user_selected_accounts")
    .select("ad_account_id")
    .eq("user_id", userId);
  if (selectedErr) throw selectedErr;
  const off = await inactiveAccountIds(db, userId);
  let accountIds = (selected ?? []).map((s) => s.ad_account_id as string).filter((id) => !off.has(id));
  if (opts.onlyAccountId) accountIds = accountIds.filter((id) => id === opts.onlyAccountId);
  if (accountIds.length === 0) return { paused: [], held: [], sendError: null, diag: [], queued: 0 };

  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target")
    .eq("user_id", userId)
    .in("ad_account_id", accountIds)
    .not("cpa_target", "is", null);
  if (bindingsErr) throw bindingsErr;
  if (!bindings || bindings.length === 0) return { paused: [], held: [], sendError: null, diag: [], queued: 0 };

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
  const flagged: FlaggedCreative[] = [];
  const heldAll: HeldCreative[] = [];
  const diag: CreativeAccountDiag[] = [];
  const metric = (r: { spend: number; conversations: number | null; cost_per_conversation: number | null }) =>
    r.conversations && r.conversations > 0 && r.cost_per_conversation != null
      ? `${fmtCurrency(r.cost_per_conversation)}/conversa`
      : `gasto ${fmtCurrency(r.spend)} sem conversa`;

  // Etapa 207: a função tem 60s no servidor. Antes, todas as contas eram varridas ao mesmo tempo e a pausa esperava 3s entre
  // um criativo e outro — com muitas contas a rodada estourava os 60s e era cortada no meio (sem pausar nem registrar nada).
  // Agora: no máximo 4 contas por vez (ordem embaralhada, pra não sobrar sempre a mesma), nenhuma conta nova começa depois
  // de 35s, a pausa espera 1s entre criativos e para aos 52s. O que ficou de fora aparece como erro no Registro.
  const startedAt = Date.now();
  const ANALYSIS_DEADLINE = startedAt + 35_000;
  const HARD_DEADLINE = startedAt + 52_000;
  const queue = [...bindings].sort(() => Math.random() - 0.5);
  const pauseResults = new Map<string, { id: string; ok: boolean; error?: string }>();
  const queueMode = opts.mode === "queue";
  let queued = 0;
  const runAccount = async (b: (typeof bindings)[number]) => {
      const accountId = b.ad_account_id as string;
      const cpaTarget = b.cpa_target as number;
      const clientName = (b.client_name as string | null) || accountId;
      const d: CreativeAccountDiag = { ad_account_id: accountId, client_name: clientName, cpa_target: cpaTarget, error: null, retried: false, notes: [] };
      diag.push(d);
      // Etapa 206: se a busca na Meta falhar, tenta a conta de novo uma vez (antes pulava a conta calada).
      const accFlagged: typeof flagged = [];
      const attempt = async () => {
        d.notes = [];
        accFlagged.length = 0;
        const rows = await getCreativeCostAnalysis(token, accountId, DATE_PRESET);
        const allActive = rows.filter((r) => STATUSES.includes((r.status ?? "").toUpperCase()));
        const active = allActive.filter((r) => !opts.onlyNoResult || !r.conversations || r.conversations <= 0);
        // Etapa 136: quantos criativos ativos cada conjunto tem (base dos 70% do freio).
        const activeByAdset = new Map<string, number>();
        for (const r of allActive) if (r.adset_id) activeByAdset.set(r.adset_id, (activeByAdset.get(r.adset_id) ?? 0) + 1);
        // Só busca 7 dias / 2 dias + hoje se a conta tiver algum criativo acima do limite.
        const flaggedRaw = active.filter(
          (r) =>
            decideCreativePause({ cpaTarget, m2: r, m7: undefined, sevenDayFetched: false, m3: undefined, threeDayFetched: false })
              .action !== "none",
        );
        d.notes.push(`${active.length} criativo(s) ativo(s); ${flaggedRaw.length} acima do limite (${fmtCurrency(cpaTarget + 4)}+ ontem + hoje)`);
        if (flaggedRaw.length === 0) return;
        // Etapa 206: anúncio com várias mídias (formato flexível) voltou a ser pausado normalmente (a trava da Etapa 195 saiu).
        const flaggedAll = flaggedRaw;
        // Etapa 133: olha só o dia de hoje antes de pausar. Se a busca falhar, não decide no escuro (pula a conta).
        let rowsToday: CreativeCostRow[];
        try {
          const todayStr = spDate(new Date());
          rowsToday = await getCreativeCostAnalysis(token, accountId, { since: todayStr, until: todayStr });
        } catch (e) {
          throw new Error(`busca de hoje na Meta falhou: ${(e as Error).message.slice(0, 160)}`);
        }
        const byToday = new Map(rowsToday.map((r) => [r.id, r]));
        const first = flaggedAll.filter((r) => {
          const hold = holdBecauseTodayIsGood({ cpaTarget, createdTime: r.created_time, now: nowDate, m2: r, mToday: byToday.get(r.id) });
          if (hold) d.notes.push(`${r.name} (${metric(r)}): mantido — criativo novo e hoje já está dentro da meta`);
          return !hold;
        });
        if (first.length === 0) return;
        let rows7: CreativeCostRow[] | null = null;
        try {
          rows7 = await getCreativeCostAnalysis(token, accountId, DATE_PRESET_7D);
        } catch (e) {
          throw new Error(`busca dos 7 dias na Meta falhou: ${(e as Error).message.slice(0, 160)}`);
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
            throw new Error(`busca dos 2 dias + hoje na Meta falhou: ${(e as Error).message.slice(0, 160)}`);
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
          if (decision.action !== "pause") {
            d.notes.push(`${r.name} (${metric(r)}): mantido — ${decision.reason}`);
            continue;
          }
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
                d.notes.push(`${t.r.name} (${metric(t.r)}): fim de semana — conjunto reduzido pra R$10 primeiro (pausa só 6h depois, se não melhorar)`);
                continue;
              }
              if (!standbyStepDone(sb, nowDate)) {
                d.notes.push(`${t.r.name} (${metric(t.r)}): fim de semana — esperando as 6h do standby do conjunto`);
                continue;
              }
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
              d.notes.push(`${t.r.name} (${metric(t.r)}): PAUSAR`);
              accFlagged.push({
                ...base,
                good_history: t.goodHistory,
                age_hours: t.r.created_time ? Math.round((nowDate.getTime() - new Date(t.r.created_time).getTime()) / 3_600_000) : null,
              });
            } else {
              d.notes.push(`${t.r.name} (${metric(t.r)}): mantido pelo freio de segurança (70% do conjunto)`);
              heldAll.push(base);
            }
          }
        }
      };
      try {
        await attempt();
      } catch (e1) {
        console.error("creatives-pause conta falhou, tentando de novo", accountId, (e1 as Error).message);
        if (Date.now() > ANALYSIS_DEADLINE) {
          d.error = `${(e1 as Error).message.slice(0, 200)} (sem tempo pra tentar de novo nesta rodada)`;
          return;
        }
        d.retried = true;
        await new Promise((r) => setTimeout(r, 2500));
        try {
          await attempt();
        } catch (e) {
          d.error = (e as Error).message.slice(0, 300);
          console.error("creatives-pause analysis err (non-fatal)", accountId, e);
          return;
        }
      }
      if (queueMode) {
        // Etapa 209: grava na fila (a 2ª chamada pausa). Falha ao gravar = erro da conta no Registro.
        try {
          await enqueueCreatives(db, userId, accFlagged, !!opts.onlyNoResult);
          queued += accFlagged.length;
          d.notes = d.notes.map((n) => (n.endsWith(": PAUSAR") ? n.replace(/: PAUSAR$/, ": NA FILA PRA PAUSAR") : n));
        } catch (e) {
          d.error = (e as Error).message.slice(0, 300);
        }
        return;
      }
      // Etapa 208: pausa os criativos DESTA conta logo depois de analisá-la (antes ficava tudo pro fim da rodada e o tempo
      // acabava antes de pausar). 1s entre uma pausa e outra; para no limite do servidor.
      for (let i = 0; i < accFlagged.length; i++) {
        const f = accFlagged[i];
        flagged.push(f);
        if (Date.now() > HARD_DEADLINE) {
          pauseResults.set(f.ad_id, { id: f.ad_id, ok: false, error: "não deu tempo de pausar nesta rodada — fica pra próxima" });
          continue;
        }
        const [r] = await setEntitiesStatusSequential(token, [{ id: f.ad_id, type: "ad" as const }], "PAUSED");
        pauseResults.set(f.ad_id, r);
        d.notes = d.notes.map((n) => (n.startsWith(`${f.ad_name} (`) && n.endsWith(": PAUSAR") ? n.replace(/: PAUSAR$/, r.ok ? ": PAUSADO" : `: falhou ao pausar (${r.error ?? "erro"})`) : n));
        if (i < accFlagged.length - 1) await new Promise((res) => setTimeout(res, 1000));
      }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length > 0) {
        const b = queue.shift()!;
        if (Date.now() > ANALYSIS_DEADLINE) {
          diag.push({
            ad_account_id: b.ad_account_id as string,
            client_name: (b.client_name as string | null) || (b.ad_account_id as string),
            cpa_target: b.cpa_target as number,
            error: "não deu tempo nesta rodada (limite de 60s do servidor) — fica pra próxima",
            retried: false,
            notes: [],
          });
          continue;
        }
        await runAccount(b);
      }
    }),
  );

  let paused: PausedCreative[] = [];
  if (flagged.length > 0) {
    // Etapa 208: as pausas já foram feitas conta a conta (pauseResults).
    const results = flagged.map((f) => pauseResults.get(f.ad_id) ?? { id: f.ad_id, ok: false, error: "não pausado" });
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
  if (pausedOk.length > 0) await logCreativePauses(db, userId, pausedOk, new Map(flagged.map((f) => [f.ad_id, f.conversations])));

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
  if (opts.send && (pausedOk.length > 0 || heldLines.length > 0)) {
    try {
      await publishPausedAlert(db, userId, pausedOk, heldLines, !!opts.onlyNoResult);
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { paused, held: heldAll, sendError, diag, queued };
}

// Etapa 158: registro das pausas (o backup da rodada seguinte reativa quem melhorou).
async function logCreativePauses(db: Db, userId: string, pausedOk: PausedCreative[], convById: Map<string, number | null>) {
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

// Alerta "Criativos pausados automaticamente" (+ o que o freio manteve ativo).
async function publishPausedAlert(db: Db, userId: string, pausedOk: PausedCreative[], heldLines: string[], onlyNoResult: boolean) {
  const heldBlock =
    heldLines.length > 0
      ? `\n\n🛑 Freio de segurança (mais de ${Math.round(BRAKE_MAX_SHARE * 100)}% do conjunto passaria do limite): ${heldLines.length} criativo${
          heldLines.length > 1 ? "s" : ""
        } acima do limite ${heldLines.length > 1 ? "foram mantidos ativos" : "foi mantido ativo"} por segurança, os menos ruins — a próxima rodada reavalia:\n${heldLines.join("\n")}`
      : "";
  const lines = pausedOk.map((p, i) => {
    const metric =
      p.cost_per_conversation != null ? `${fmtCurrency(p.cost_per_conversation)}/conversa` : `gasto ${fmtCurrency(p.spend)} sem conversa`;
    const extra = [
      p.cpa_target != null ? `meta ${fmtCurrency(p.cpa_target)}` : null,
      p.age_hours != null ? `criado há ${p.age_hours < 48 ? `${p.age_hours}h` : `${Math.round(p.age_hours / 24)} d`}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return `${i + 1}. ${p.client_name} — ${p.ad_name}: ${metric}${extra ? ` (${extra})` : ""}${p.good_history ? " · 7 dias bom, mas acima nos 2 dias + hoje" : ""}`;
  });
  await publishAlert(db, userId, {
    kind: onlyNoResult ? "creatives-no-result" : "creatives-pause",
    title:
      pausedOk.length > 0
        ? `⏸️ ${
            onlyNoResult
              ? "Criativos sem resultado pausados automaticamente (gasto acima da meta sem nenhuma conversa, ontem + hoje)"
              : "Criativos pausados automaticamente (CPA acima da meta ontem + hoje)"
          } — ${pausedOk.length} anúncio${pausedOk.length > 1 ? "s" : ""}`
        : `🛑 Freio de segurança: criativos acima do limite mantidos ativos — ${heldLines.length}`,
    body: `${lines.join("\n")}${heldBlock}`.trim(),
    count: Math.max(pausedOk.length, heldLines.length),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Etapa 209: DUAS ETAPAS. 1ª chamada (mode "queue"): analisa e grava a fila em creative_pause_queue, sem pausar.
// 2ª chamada (processCreativePauseQueue): lê a fila e pausa um por um (1s entre cada), até o limite de tempo. O que
// sobrar fica "pending" e a próxima chamada continua. Cada etapa tem os 60s inteiros do servidor.
const QUEUE_TABLE = "creative_pause_queue";
const QUEUE_HARD_DEADLINE_MS = 50_000;

async function enqueueCreatives(db: Db, userId: string, items: FlaggedCreative[], onlyNoResult: boolean): Promise<void> {
  if (items.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await db.from(QUEUE_TABLE).upsert(
    items.map((f) => ({
      user_id: userId,
      ad_id: f.ad_id,
      ad_account_id: f.ad_account_id,
      client_name: f.client_name,
      ad_name: f.ad_name,
      spend: f.spend,
      conversations: f.conversations,
      cost_per_conversation: f.cost_per_conversation,
      cpa_target: f.cpa_target,
      good_history: f.good_history,
      age_hours: f.age_hours,
      kind: onlyNoResult ? "no-result" : "cpa",
      status: "pending",
      error: null,
      queued_at: now,
      processed_at: null,
    })),
    { onConflict: "user_id,ad_id" },
  );
  if (error) {
    throw new Error(`Não consegui gravar a fila de pausas (${error.message}). Rode a migration 0038_creative_pause_queue.sql no Supabase.`);
  }
}

export interface QueueRunResult {
  paused: PausedCreative[];
  remaining: number;
  sendError: string | null;
}

export async function processCreativePauseQueue(db: Db, userId: string, token: string, opts: { send: boolean }): Promise<QueueRunResult> {
  const startedAt = Date.now();
  const { data, error } = await db
    .from(QUEUE_TABLE)
    .select("ad_id, ad_account_id, client_name, ad_name, spend, conversations, cost_per_conversation, cpa_target, good_history, age_hours, kind")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("queued_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`Fila de pausas indisponível (${error.message}). Rode a migration 0038_creative_pause_queue.sql no Supabase.`);
  const items = data ?? [];
  const paused: (PausedCreative & { kind: string; conversations: number | null })[] = [];
  let remaining = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (Date.now() - startedAt > QUEUE_HARD_DEADLINE_MS) {
      remaining = items.length - i;
      break;
    }
    const [r] = await setEntitiesStatusSequential(token, [{ id: it.ad_id as string, type: "ad" as const }], "PAUSED");
    await db
      .from(QUEUE_TABLE)
      .update({ status: r.ok ? "paused" : "failed", error: r.ok ? null : (r.error ?? "erro"), processed_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("ad_id", it.ad_id as string);
    paused.push({
      ad_account_id: it.ad_account_id as string,
      client_name: (it.client_name as string | null) ?? (it.ad_account_id as string),
      ad_id: it.ad_id as string,
      ad_name: (it.ad_name as string | null) ?? (it.ad_id as string),
      spend: Number(it.spend ?? 0),
      cost_per_conversation: it.cost_per_conversation != null ? Number(it.cost_per_conversation) : null,
      good_history: !!it.good_history,
      cpa_target: it.cpa_target != null ? Number(it.cpa_target) : undefined,
      age_hours: it.age_hours != null ? Number(it.age_hours) : null,
      ok: r.ok,
      error: r.ok ? undefined : (r.error ?? "erro"),
      kind: (it.kind as string) ?? "cpa",
      conversations: it.conversations != null ? Number(it.conversations) : null,
    });
    if (i < items.length - 1) await new Promise((res) => setTimeout(res, 1000));
  }
  const pausedOk = paused.filter((p) => p.ok).sort((a, b) => b.spend - a.spend);
  if (pausedOk.length > 0) await logCreativePauses(db, userId, pausedOk, new Map(paused.map((p) => [p.ad_id, p.conversations])));
  // Limpa da fila o que já foi processado há mais de 3 dias.
  await db
    .from(QUEUE_TABLE)
    .delete()
    .eq("user_id", userId)
    .neq("status", "pending")
    .lt("processed_at", new Date(Date.now() - 3 * 86_400_000).toISOString());

  let sendError: string | null = null;
  if (opts.send) {
    for (const kind of ["cpa", "no-result"] as const) {
      const list = pausedOk.filter((p) => p.kind === kind);
      if (list.length === 0) continue;
      try {
        await publishPausedAlert(db, userId, list, [], kind === "no-result");
      } catch (e) {
        sendError = (e as Error).message;
      }
    }
  }
  return { paused, remaining, sendError };
}
