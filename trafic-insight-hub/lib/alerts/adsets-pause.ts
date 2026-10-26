// Pausa automática de Conjuntos acima da meta (Etapa 53) — pensada pra
// rodar de 3 em 3 horas (02h05/05h05/08h05/11h05/14h05/17h05/20h05/23h05 no n8n, 5
// minutos depois do check de Criativos; Etapa 104), pausando sozinho todo conjunto
// ATIVO com custo por conversa (ou gasto, sem conversa) no DOBRO da Meta
// CPA + R$1 (ou mais) — MESMA lógica/limite de Painel > Análise > Conjuntos
// (isAdSetFlaggedAbove) — e avisando no grupo de WhatsApp quais conjuntos
// foram pausados. Isso inclui, sem cálculo de CPA nenhum, todo conjunto
// ATIVO sem nenhum anúncio ativo dentro dele (mesmo critério do selo "Sem
// anúncio ativo"). Sem cooldown: um conjunto já pausado deixa de ser ATIVO,
// então não aparece mais nas rodadas seguintes — sem re-pausa nem re-aviso
// do mesmo conjunto. Período fixo "últimos 3 dias + hoje" — mesmo padrão
// default da tela de Análise.
// Etapa 56: as pausas na Meta agora saem uma de cada vez, com 3s de
// intervalo (setEntitiesStatusSequential), em vez de todas em paralelo —
// mesma pauta de segurança contra rate limit que os botões manuais de
// Análise já seguem (BULK_DELAY_MS).
//
// Etapa 76 (correção): universo de contas restrito a user_selected_accounts
// ("Contas exibidas" do Painel) — mesmo critério já usado em
// bulk-status-update.ts e, desde agora, em creatives-pause.ts (mesmo bug,
// mesma correção: conta desmarcada do Painel mas ainda com meta de CPA
// cadastrada de antes continuava tendo conjuntos pausados sozinha).

// Etapa 99 (reestruturada): a pausa agora respeita o histórico de 7 dias e ganhou quarentena.
// Conjunto acima da meta nos últimos 3 dias mas com CPA de 7 dias ABAIXO do ideal (a "linha
// verde" de Análise) não é pausado: corta R$10 do orçamento diário (ABO ou CBO) e entra em
// quarentena de 24h (ignorado nas verificações). Passada a quarentena: ainda acima nos 3 dias
// e 7 dias abaixo → corta mais R$10 e volta à quarentena; acima nos 3 e nos 7 dias → pausa.
// Regras completas em lib/alerts/adset-decision.ts; quarentena em adset-quarantine.ts.

import type { createClient } from "@/lib/supabase/server";
import { getAdSetCostAnalysis, type AdSetCostRow } from "@/lib/meta/adset-cost-analysis";
import { setEntitiesStatusSequential } from "@/lib/meta/status";
import { applyBudgetCut, getAdSetBudgetInfo, setAdSetDailyBudget, BIG_BUDGET_CENTS, STANDBY_BUDGET_CENTS } from "@/lib/meta/budget";
import { allAdsActive, decideAdSetAction, isNewAdSet, needsSevenDayData, passesCutGate } from "@/lib/alerts/adset-decision";
import { isWeekendBR, loadRecentlyReleased, loadStandby, putAdsetOnStandby, standbyStepDone, type StandbyRecord } from "@/lib/alerts/weekend";
import { logAutoPauses } from "@/lib/alerts/pause-log";
import { spDate } from "@/lib/meta/client";
import { clearQuarantine, loadQuarantine, saveQuarantine } from "@/lib/alerts/adset-quarantine";
import { publishAlert, type AlertKind } from "@/lib/alerts/notifications";
import { fmtCurrency } from "@/lib/format";
import { applyPauseBrake, severityOf, BRAKE_MAX_SHARE } from "@/lib/alerts/pause-brake";

import { inactiveAccountIds } from "@/lib/accounts/inactive";
type Db = Awaited<ReturnType<typeof createClient>>;
const DATE_PRESET = "last_3d_plus_today" as const;
const DATE_PRESET_7D = "last_7d" as const;

export interface PausedAdSet {
  ad_account_id: string;
  client_name: string;
  adset_id: string;
  adset_name: string;
  spend: number;
  cost_per_conversation: number | null;
  // CPA dos últimos 7 dias (só vem preenchido quando foi consultado).
  cost_7d?: number | null;
  has_active_ad: boolean;
  ok: boolean;
  error?: string;
}

// Conjunto que NÃO foi pausado porque os últimos 7 dias estão abaixo do ideal: o orçamento
// diário foi cortado em R$10 (ou não deu pra cortar) e o conjunto entrou em quarentena de 24h.
export interface ReducedAdSet {
  ad_account_id: string;
  client_name: string;
  adset_id: string;
  adset_name: string;
  spend: number;
  cost_per_conversation: number | null;
  cost_7d: number | null;
  scope: "adset" | "campaign" | null; // onde o corte foi (conjunto = ABO, campanha = CBO)
  from: number | null; // orçamento diário antes (R$)
  to: number | null; // orçamento diário depois (R$)
  // cut = cortou; floor = já no piso, nada cortado; lifetime = orçamento vitalício, nada cortado;
  // shared = campanha CBO já cortada nas últimas 24h, pulado; error = falha na Meta (tenta de novo)
  kind: "cut" | "floor" | "lifetime" | "shared" | "error";
  repeat: boolean; // true = segundo corte (ou mais) depois da quarentena
  ok: boolean;
  error?: string;
}

// Etapa 136: conjunto que passou do limite de pausa mas foi MANTIDO ativo pelo freio de segurança (70% da conta).
export interface HeldAdSet {
  ad_account_id: string;
  client_name: string;
  adset_id: string;
  adset_name: string;
  spend: number;
  cost_per_conversation: number | null;
  cost_7d: number | null;
  cpa_target: number;
}

// Etapa 158: conjunto ABO com orçamento acima de R$25 e CPA de ontem + hoje R$4+ acima da meta → orçamento vai pra R$10.
export interface ToTenAdSet {
  ad_account_id: string;
  client_name: string;
  adset_id: string;
  adset_name: string;
  from: number;
  spend: number;
  cost_per_conversation: number | null;
  cpa_target: number;
}

// Etapa 158: fim de semana — passo 1 (reduzir pra R$10 / standby) de um conjunto acima da meta.
export interface StandbyPut {
  client_name: string;
  adset_name: string;
  outcome: "standby" | "no_cut" | "error";
  from?: number;
  to?: number;
  note?: string;
}

// Etapa 158: conjunto sem anúncio ativo e sem gasto — não pausa, só avisa.
export interface NoSpendAdSet {
  adset_id: string;
  client_name: string;
  adset_name: string;
}

export interface CheckAdSetsPauseResult {
  paused: PausedAdSet[];
  reduced: ReducedAdSet[];
  held: HeldAdSet[];
  sendError: string | null;
  toTen?: ToTenAdSet[];
  standbyPut?: StandbyPut[];
  noSpend?: NoSpendAdSet[];
}

const toMetrics = (r: AdSetCostRow) => ({
  spend: r.spend,
  conversations: r.conversations,
  cost_per_conversation: r.cost_per_conversation,
  has_active_ad: r.has_active_ad,
  has_pending_ad: r.has_pending_ad,
});

export async function checkAndPauseAdSets(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean } = { send: false },
): Promise<CheckAdSetsPauseResult> {
  const { data: selected, error: selectedErr } = await db
    .from("user_selected_accounts")
    .select("ad_account_id")
    .eq("user_id", userId);
  if (selectedErr) throw selectedErr;
  const off = await inactiveAccountIds(db, userId);
  const accountIds = (selected ?? []).map((s) => s.ad_account_id as string).filter((id) => !off.has(id));
  if (accountIds.length === 0) return { paused: [], reduced: [], held: [], sendError: null };

  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target")
    .eq("user_id", userId)
    .in("ad_account_id", accountIds)
    .not("cpa_target", "is", null);
  if (bindingsErr) throw bindingsErr;
  if (!bindings || bindings.length === 0) return { paused: [], reduced: [], held: [], sendError: null };

  const quarantine = await loadQuarantine(db, userId);
  const now = new Date();
  // Etapa 158: fim de semana (sábado/domingo) tem o passo "reduzir pra R$10" antes de pausar. Sem a tabela do standby
  // (migration 0034), o fim de semana segue sem esse passo (e sem pausar por desempenho, pra não pular direto pro fim da escada).
  const weekend = isWeekendBR(now);
  let standby = new Map<string, StandbyRecord>();
  let standbyOk = true;
  if (weekend) {
    try {
      standby = await loadStandby(db, userId);
    } catch (e) {
      standbyOk = false;
      console.error("adsets-pause standby err", (e as Error).message);
    }
  }
  // Etapa 204: saiu do standby há menos de 48h → protegido como conjunto novo.
  const released = await loadRecentlyReleased(db, userId, now);
  const toTen: ToTenAdSet[] = [];
  const standbyPut: StandbyPut[] = [];
  const noSpend: NoSpendAdSet[] = [];

  interface Candidate {
    ad_account_id: string;
    client_name: string;
    adset: AdSetCostRow;
    cost_7d: number | null;
    action: "cut" | "pause";
    repeat: boolean;
    cpa_target: number;
  }
  // Etapa 136: quantos conjuntos ativos cada conta tem (base dos 70% do freio de segurança).
  const activeCountByAccount = new Map<string, number>();
  const candidates: Candidate[] = [];
  const toClear: string[] = [];

  await Promise.all(
    bindings.map(async (b) => {
      const accountId = b.ad_account_id as string;
      const cpaTarget = b.cpa_target as number;
      const clientName = (b.client_name as string | null) || accountId;
      try {
        const rows3 = await getAdSetCostAnalysis(token, accountId, DATE_PRESET);
        activeCountByAccount.set(accountId, rows3.length);
        // Só busca os 7 dias se algum conjunto da conta precisar da decisão.
        const needs7 = rows3.some((r) => {
          const rec = quarantine.get(r.id);
          return needsSevenDayData(toMetrics(r), cpaTarget, rec ? new Date(rec.quarantine_until) : null, now);
        });
        let rows7: AdSetCostRow[] | null = [];
        if (needs7) {
          try {
            rows7 = await getAdSetCostAnalysis(token, accountId, DATE_PRESET_7D);
          } catch (e) {
            console.error("adsets-pause 7d err (não decide sem o histórico)", accountId, e);
            rows7 = null;
          }
        }
        const by7 = new Map((rows7 ?? []).map((r) => [r.id, r]));
        // Etapa 158: ontem + hoje, só quando algum conjunto pode estar na regra "acima de R$25 → R$10" (gastou R$25+ no período).
        let by2 = new Map<string, AdSetCostRow>();
        if (!weekend && rows3.some((r) => r.has_active_ad && r.spend >= 25 && !isNewAdSet(r.created_time, now))) {
          try {
            by2 = new Map((await getAdSetCostAnalysis(token, accountId, "today_yesterday")).map((r) => [r.id, r]));
          } catch (e) {
            console.error("adsets-pause ontem+hoje err (sem a regra de R$25 nesta conta)", accountId, e);
          }
        }
        // Etapa 195: consulta (só se algum conjunto da conta chegar a "pausar") quais conjuntos têm anúncio com várias mídias.
        for (const r of rows3) {
          const rec = quarantine.get(r.id);
          const r7 = by7.get(r.id);
          // Etapa 173: por desempenho, conjunto com menos de 48h nunca é mexido. Sem anúncio ativo segue pra decisão (pode ser pausado).
          if (r.has_active_ad && isNewAdSet(r.created_time, now)) continue;
          // Etapa 204: idem pra quem saiu do standby há menos de 48h.
          if (r.has_active_ad && released.has(r.id)) continue;
          const inQuarantine = !!rec && new Date(rec.quarantine_until).getTime() > now.getTime();

          // Etapa 158 — orçamento diário acima de R$25 e CPA ontem + hoje R$4+ acima da meta: vai pra R$10 (só ABO).
          const r2 = by2.get(r.id);
          if (!weekend && !inQuarantine && r.has_active_ad && r2 && passesCutGate(toMetrics(r2), cpaTarget)) {
            const infoRes = await getAdSetBudgetInfo(token, r.id);
            if (infoRes.ok && infoRes.info.scope === "adset" && infoRes.info.currentCents > BIG_BUDGET_CENTS) {
              const setRes = await setAdSetDailyBudget(token, r.id, STANDBY_BUDGET_CENTS);
              if (setRes.ok) {
                await saveQuarantine(db, userId, {
                  adset_id: r.id,
                  ad_account_id: accountId,
                  campaign_id: infoRes.info.campaignId,
                  budget_scope: "adset",
                  cuts: (rec?.cuts ?? 0) + 1,
                  from: infoRes.info.currentCents / 100,
                  to: STANDBY_BUDGET_CENTS / 100,
                });
                toTen.push({
                  ad_account_id: accountId,
                  client_name: clientName,
                  adset_id: r.id,
                  adset_name: r.name,
                  from: infoRes.info.currentCents / 100,
                  spend: r2.spend,
                  cost_per_conversation: r2.cost_per_conversation,
                  cpa_target: cpaTarget,
                });
                continue;
              }
              console.error("adsets-pause R$25→R$10 err", r.id, setRes.error);
            }
          }

          // Etapa 158 — fim de semana, passo 1: acima da meta → reduz pra R$10 (standby). Só passa pro passo seguinte
          // (pausar) 6h depois. Sem registro do standby (tabela ausente), não pausa por desempenho no fim de semana.
          if (weekend && r.has_active_ad && !inQuarantine && passesCutGate(toMetrics(r), cpaTarget)) {
            if (!standbyOk) continue;
            const sb = standby.get(r.id);
            if (!sb) {
              const out = await putAdsetOnStandby(db, userId, token, {
                adset_id: r.id,
                ad_account_id: accountId,
                client_name: clientName,
                adset_name: r.name,
                reason: "acima da meta (fim de semana)",
              });
              standbyPut.push(
                out.kind === "standby"
                  ? { client_name: clientName, adset_name: r.name, outcome: "standby", from: out.from, to: out.to }
                  : out.kind === "no_cut"
                    ? { client_name: clientName, adset_name: r.name, outcome: "no_cut", note: out.why }
                    : { client_name: clientName, adset_name: r.name, outcome: "error", note: out.error },
              );
              continue;
            }
            if (!standbyStepDone(sb, now)) continue;
          }

          const decision = decideAdSetAction({
            cpaTarget,
            now,
            m3: toMetrics(r),
            m7: r7 ? toMetrics(r7) : undefined,
            sevenDayFetched: rows7 !== null,
            quarantineUntil: rec ? new Date(rec.quarantine_until) : null,
            createdTime: r.created_time,
            adsAllActive: allAdsActive(r.ads),
            weekend,
          });
          if (decision.action === "notify_no_spend") noSpend.push({ adset_id: r.id, client_name: clientName, adset_name: r.name });
          if (decision.action === "clear") toClear.push(r.id);
          // Etapa 206: a trava de "várias mídias" (Etapa 195) saiu — esses conjuntos voltam a ser pausados normalmente.
          if (decision.action === "cut" || decision.action === "pause") {
            candidates.push({
              ad_account_id: accountId,
              client_name: clientName,
              adset: r,
              cost_7d: r7?.cost_per_conversation ?? null,
              action: decision.action,
              repeat: !!rec,
              cpa_target: cpaTarget,
            });
          }
        }
      } catch (e) {
        console.error("adsets-pause analysis err (non-fatal)", accountId, e);
      }
    }),
  );

  await clearQuarantine(db, userId, toClear);

  // --- Etapa 136: freio de segurança (por conta). Conjunto sem anúncio ativo fica fora do freio (pausa direto). ---
  const held: HeldAdSet[] = [];
  const heldIds = new Set<string>();
  {
    const byAccount = new Map<string, Candidate[]>();
    for (const c of candidates) {
      if (c.action !== "pause") continue;
      const list = byAccount.get(c.ad_account_id) ?? [];
      list.push(c);
      byAccount.set(c.ad_account_id, list);
    }
    for (const [accountId, list] of byAccount) {
      const brake = applyPauseBrake(
        list.map((c) => ({
          id: c.adset.id,
          severity: severityOf(c.adset, c.cpa_target),
          exempt: !c.adset.has_active_ad,
        })),
        activeCountByAccount.get(accountId) ?? list.length,
      );
      for (const id of brake.held) heldIds.add(id);
    }
    for (const c of candidates) {
      if (c.action === "pause" && heldIds.has(c.adset.id)) {
        held.push({
          ad_account_id: c.ad_account_id,
          client_name: c.client_name,
          adset_id: c.adset.id,
          adset_name: c.adset.name,
          spend: c.adset.spend,
          cost_per_conversation: c.adset.cost_per_conversation,
          cost_7d: c.cost_7d,
          cpa_target: c.cpa_target,
        });
      }
    }
  }

  // --- Pausas (como sempre: uma de cada vez, com intervalo) ---
  const toPause = candidates.filter((c) => c.action === "pause" && !heldIds.has(c.adset.id));
  let paused: PausedAdSet[] = [];
  if (toPause.length > 0) {
    const results = await setEntitiesStatusSequential(
      token,
      toPause.map((c) => ({ id: c.adset.id, type: "adset" as const })),
      "PAUSED",
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    paused = toPause.map((c) => {
      const r = byId.get(c.adset.id);
      return {
        ad_account_id: c.ad_account_id,
        client_name: c.client_name,
        adset_id: c.adset.id,
        adset_name: c.adset.name,
        spend: c.adset.spend,
        cost_per_conversation: c.adset.cost_per_conversation,
        cost_7d: c.cost_7d,
        has_active_ad: c.adset.has_active_ad,
        ok: !!r?.ok,
        error: r?.ok ? undefined : (r?.error ?? "Erro desconhecido"),
      };
    });
    await clearQuarantine(
      db,
      userId,
      paused.filter((p) => p.ok).map((p) => p.adset_id),
    );
    // Etapa 158: registro das pausas por desempenho (o backup da rodada seguinte confere e reativa se melhorou).
    const candById = new Map(toPause.map((c) => [c.adset.id, c]));
    await logAutoPauses(
      db,
      userId,
      paused
        .filter((p) => p.ok && p.has_active_ad)
        .map((p) => ({
          entity_type: "adset" as const,
          entity_id: p.adset_id,
          ad_account_id: p.ad_account_id,
          client_name: p.client_name,
          entity_name: p.adset_name,
          spend: p.spend,
          conversations: candById.get(p.adset_id)?.adset.conversations ?? null,
          cpa: p.cost_per_conversation,
          reason: "desempenho",
        })),
    );
  }

  // --- Cortes de R$10 + quarentena ---
  const reduced: ReducedAdSet[] = [];
  const toCut = candidates.filter((c) => c.action === "cut");
  // Campanhas CBO já cortadas nas últimas 24h (por esta ou por verificação anterior).
  const campaignQuarantined = new Set(
    [...quarantine.values()]
      .filter((q) => q.budget_scope === "campaign" && q.campaign_id && new Date(q.quarantine_until) > now)
      .map((q) => q.campaign_id as string),
  );
  const campaignCutThisRun = new Map<string, { ok: boolean; from: number | null; to: number | null; kind: ReducedAdSet["kind"]; error?: string }>();
  for (const c of toCut) {
    const base = {
      ad_account_id: c.ad_account_id,
      client_name: c.client_name,
      adset_id: c.adset.id,
      adset_name: c.adset.name,
      spend: c.adset.spend,
      cost_per_conversation: c.adset.cost_per_conversation,
      cost_7d: c.cost_7d,
      repeat: c.repeat,
    };
    const prevCuts = quarantine.get(c.adset.id)?.cuts ?? 0;
    const infoRes = await getAdSetBudgetInfo(token, c.adset.id);
    if (!infoRes.ok) {
      if (infoRes.reason === "error") {
        reduced.push({ ...base, scope: null, from: null, to: null, kind: "error", ok: false, error: infoRes.error });
        continue; // sem quarentena: tenta de novo na próxima verificação
      }
      // Vitalício / sem orçamento diário: nada pra cortar — quarentena de 24h só pra não repetir o aviso.
      await saveQuarantine(db, userId, { adset_id: c.adset.id, ad_account_id: c.ad_account_id, campaign_id: infoRes.campaignId ?? null, budget_scope: "adset", cuts: prevCuts });
      reduced.push({ ...base, scope: null, from: null, to: null, kind: "lifetime", ok: false, error: infoRes.error });
      continue;
    }
    const info = infoRes.info;
    const scope = info.scope;
    const campaignId = info.campaignId;
    if (scope === "campaign" && campaignId) {
      const already = campaignCutThisRun.get(campaignId);
      if (already) {
        // Mesma campanha CBO já cortada nesta rodada: não corta duas vezes, só põe este conjunto na quarentena.
        if (already.ok) {
          await saveQuarantine(db, userId, { adset_id: c.adset.id, ad_account_id: c.ad_account_id, campaign_id: campaignId, budget_scope: "campaign", cuts: prevCuts + 1, from: already.from, to: already.to });
        }
        reduced.push({ ...base, scope, from: already.from, to: already.to, kind: already.ok ? "shared" : already.kind, ok: already.ok, error: already.error });
        continue;
      }
      if (campaignQuarantined.has(campaignId)) {
        // Outro conjunto desta campanha já cortou o orçamento dela há menos de 24h.
        reduced.push({ ...base, scope, from: info.currentCents / 100, to: info.currentCents / 100, kind: "shared", ok: true });
        continue;
      }
    }
    const res = await applyBudgetCut(token, info);
    if (res.ok) {
      const from = res.fromCents / 100;
      const to = res.toCents / 100;
      await saveQuarantine(db, userId, { adset_id: c.adset.id, ad_account_id: c.ad_account_id, campaign_id: campaignId, budget_scope: scope, cuts: prevCuts + 1, from, to });
      if (scope === "campaign" && campaignId) campaignCutThisRun.set(campaignId, { ok: true, from, to, kind: "cut" });
      reduced.push({ ...base, scope, from, to, kind: "cut", ok: true });
    } else if (res.floor) {
      await saveQuarantine(db, userId, { adset_id: c.adset.id, ad_account_id: c.ad_account_id, campaign_id: campaignId, budget_scope: scope, cuts: prevCuts });
      const cur = info.currentCents / 100;
      if (scope === "campaign" && campaignId) campaignCutThisRun.set(campaignId, { ok: false, from: cur, to: cur, kind: "floor", error: res.error });
      reduced.push({ ...base, scope, from: cur, to: cur, kind: "floor", ok: false, error: res.error });
    } else {
      reduced.push({ ...base, scope, from: info.currentCents / 100, to: null, kind: "error", ok: false, error: res.error });
    }
  }

  const pausedOk = paused.filter((p) => p.ok).sort((a, b) => b.spend - a.spend);
  const cutOk = reduced.filter((r) => r.kind === "cut" || r.kind === "shared");
  const cutNotes = reduced.filter((r) => r.kind === "floor" || r.kind === "lifetime");

  let sendError: string | null = null;
  // Etapa 158: avisos "sem gasto" só uma vez por dia por conjunto (a rodada é de 3 em 3 horas).
  let noSpendNew: NoSpendAdSet[] = [];
  if (opts.send && noSpend.length > 0) {
    noSpendNew = await filterNewNoSpend(db, userId, noSpend);
  }
  if (
    opts.send &&
    (pausedOk.length > 0 || cutOk.length > 0 || cutNotes.length > 0 || held.length > 0 || toTen.length > 0 || standbyPut.length > 0 || noSpendNew.length > 0)
  ) {
    try {
      const sections: Array<{ kind: AlertKind; title: string; body: string; count: number }> = [];
      if (toTen.length > 0) {
        sections.push({
          kind: "adsets-cut",
          title: `📉 Orçamento reduzido pra R$10 (orçamento acima de R$25 e CPA ontem + hoje R$4+ acima da meta; quarentena de 24h) — ${toTen.length} conjunto${toTen.length > 1 ? "s" : ""}`,
          body: toTen
            .map(
              (t, i) =>
                `${i + 1}. ${t.client_name} — ${t.adset_name}: ${fmtCurrency(t.from)} → ${fmtCurrency(STANDBY_BUDGET_CENTS / 100)} · ontem + hoje ${
                  t.cost_per_conversation != null ? `${fmtCurrency(t.cost_per_conversation)}/conversa` : `gasto ${fmtCurrency(t.spend)}`
                } (meta ${fmtCurrency(t.cpa_target)})`,
            )
            .join("\n"),
          count: toTen.length,
        });
      }
      if (standbyPut.length > 0) {
        sections.push({
          kind: "adsets-cut",
          title: `🌙 Fim de semana: conjuntos acima da meta — primeiro reduzo o orçamento (standby R$10); se não melhorar, pausa criativo e depois o conjunto — ${standbyPut.length}`,
          body: standbyPut
            .map((o, i) =>
              o.outcome === "standby"
                ? `${i + 1}. ${o.client_name} — ${o.adset_name}: ${fmtCurrency(o.from ?? 0)} → ${fmtCurrency(o.to ?? 0)}`
                : o.outcome === "no_cut"
                  ? `${i + 1}. ${o.client_name} — ${o.adset_name}: não reduzi (${o.note ?? "sem orçamento diário no conjunto"})`
                  : `${i + 1}. ${o.client_name} — ${o.adset_name}: erro ao reduzir (${o.note ?? "erro"}) — tento de novo na próxima rodada`,
            )
            .join("\n"),
          count: standbyPut.length,
        });
      }
      if (noSpendNew.length > 0) {
        sections.push({
          kind: "adsets-no-spend",
          title: `⚠️ Conjuntos ativos sem anúncio ativo e sem gasto (não pausei, só aviso) — ${noSpendNew.length}`,
          body: noSpendNew.map((n, i) => `${i + 1}. ${n.client_name} — ${n.adset_name}`).join("\n"),
          count: noSpendNew.length,
        });
      }
      if (pausedOk.length > 0) {
        const lines = pausedOk.map((p, i) => {
          if (!p.has_active_ad) return `${i + 1}. ${p.client_name} — ${p.adset_name}: sem anúncio ativo`;
          const metric =
            p.cost_per_conversation != null
              ? `${fmtCurrency(p.cost_per_conversation)}/conversa`
              : `gasto ${fmtCurrency(p.spend)} sem conversa`;
          const hist = p.cost_7d != null ? ` · 7 dias ${fmtCurrency(p.cost_7d)}` : "";
          return `${i + 1}. ${p.client_name} — ${p.adset_name}: ${metric}${hist}`;
        });
        sections.push({
          kind: "adsets-paused",
          title: `⏸️ Conjuntos pausados automaticamente (CPA acima da meta nos últimos 3 e 7 dias) — ${pausedOk.length} conjunto${
            pausedOk.length > 1 ? "s" : ""
          }`,
          body: lines.join("\n"),
          count: pausedOk.length,
        });
      }
      if (held.length > 0) {
        const heldLines = held.map(
          (h) =>
            `• ${h.client_name} — ${h.adset_name}: ${
              h.cost_per_conversation != null ? `${fmtCurrency(h.cost_per_conversation)}/conversa` : `gasto ${fmtCurrency(h.spend)} sem conversa`
            } (meta ${fmtCurrency(h.cpa_target)})${h.cost_7d != null ? ` · 7 dias ${fmtCurrency(h.cost_7d)}` : ""}`,
        );
        const note = `🛑 Freio de segurança (mais de ${Math.round(BRAKE_MAX_SHARE * 100)}% dos conjuntos da conta passariam do limite): ${held.length} conjunto${
          held.length > 1 ? "s foram mantidos ativos" : " foi mantido ativo"
        } por segurança, os menos ruins — a próxima rodada reavalia:\n${heldLines.join("\n")}`;
        const target = sections.find((s) => s.kind === "adsets-paused");
        if (target) target.body = `${target.body}\n\n${note}`;
        else
          sections.push({
            kind: "adsets-paused",
            title: `🛑 Freio de segurança: conjuntos acima do limite mantidos ativos — ${held.length}`,
            body: note,
            count: held.length,
          });
      }
      const cutLines = cutOk.map((r, i) => {
        const where = r.scope === "campaign" ? " (orçamento da campanha)" : "";
        const money =
          r.kind === "shared" ? `orçamento da campanha já cortado (quarentena)` : `${fmtCurrency(r.from ?? 0)} → ${fmtCurrency(r.to ?? 0)}${where}`;
        const metric = r.cost_per_conversation != null ? `${fmtCurrency(r.cost_per_conversation)}/conversa` : `gasto ${fmtCurrency(r.spend)} sem conversa`;
        return `${i + 1}. ${r.client_name} — ${r.adset_name}: ${money} · 3 dias ${metric} · 7 dias ${r.cost_7d != null ? fmtCurrency(r.cost_7d) : "—"}${r.repeat ? " · 2º corte" : ""}`;
      });
      if (cutLines.length > 0) {
        sections.push({
          kind: "adsets-cut",
          title: `📉 Orçamento reduzido em R$10 (últimos 3 dias acima da meta, mas 7 dias abaixo do ideal — quarentena de 24h) — ${cutLines.length} conjunto${
            cutLines.length > 1 ? "s" : ""
          }`,
          body: cutLines.join("\n"),
          count: cutLines.length,
        });
      }
      if (cutNotes.length > 0) {
        const lines = cutNotes.map((r, i) => `${i + 1}. ${r.client_name} — ${r.adset_name}: ${r.error ?? "não deu pra cortar o orçamento"}`);
        sections.push({
          kind: "adsets-cut-failed",
          title: "⚠️ Conjuntos que pediam corte de orçamento, mas não deu pra cortar (quarentena de 24h mesmo assim)",
          body: lines.join("\n"),
          count: cutNotes.length,
        });
      }
      for (const section of sections) await publishAlert(db, userId, section);
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { paused, reduced, held, sendError, toTen, standbyPut, noSpend };
}

// Quais conjuntos "sem gasto" ainda não foram avisados hoje (guarda os ids do dia em meta_insights_cache).
async function filterNewNoSpend(db: Db, userId: string, list: NoSpendAdSet[]): Promise<NoSpendAdSet[]> {
  const key = `adsets_no_spend:${spDate(new Date())}`;
  let seen = new Set<string>();
  try {
    const { data } = await db.from("meta_insights_cache").select("payload").eq("user_id", userId).eq("cache_key", key).maybeSingle();
    const ids = (data?.payload as { ids?: string[] } | undefined)?.ids;
    if (Array.isArray(ids)) seen = new Set(ids);
  } catch {
    // sem cache: avisa de novo (melhor repetir que calar)
  }
  const fresh = list.filter((n) => !seen.has(n.adset_id));
  if (fresh.length === 0) return [];
  try {
    await db.from("meta_insights_cache").upsert(
      {
        user_id: userId,
        cache_key: key,
        payload: { ids: [...seen, ...fresh.map((n) => n.adset_id)] },
        expires_at: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: "user_id,cache_key" },
    );
  } catch (e) {
    console.error("no-spend cache err", (e as Error).message);
  }
  return fresh;
}
