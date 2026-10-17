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
import { applyBudgetCut, getAdSetBudgetInfo } from "@/lib/meta/budget";
import { decideAdSetAction, needsSevenDayData } from "@/lib/alerts/adset-decision";
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

export interface CheckAdSetsPauseResult {
  paused: PausedAdSet[];
  reduced: ReducedAdSet[];
  held: HeldAdSet[];
  sendError: string | null;
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
        for (const r of rows3) {
          const rec = quarantine.get(r.id);
          const r7 = by7.get(r.id);
          const decision = decideAdSetAction({
            cpaTarget,
            now,
            m3: toMetrics(r),
            m7: r7 ? toMetrics(r7) : undefined,
            sevenDayFetched: rows7 !== null,
            quarantineUntil: rec ? new Date(rec.quarantine_until) : null,
          });
          if (decision.action === "clear") toClear.push(r.id);
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
  if (opts.send && (pausedOk.length > 0 || cutOk.length > 0 || cutNotes.length > 0 || held.length > 0)) {
    try {
      const sections: Array<{ kind: AlertKind; title: string; body: string; count: number }> = [];
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

  return { paused, reduced, held, sendError };
}
