// Pausa automática de Conjuntos acima da meta (Etapa 53) — pensada pra
// rodar várias vezes ao dia (05h05/09h05/13h05/23h05 sugeridos no n8n, 5
// minutos depois do check de Criativos), pausando sozinho todo conjunto
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

import type { createClient } from "@/lib/supabase/server";
import { getAdSetCostAnalysis } from "@/lib/meta/adset-cost-analysis";
import { isAdSetFlaggedAbove } from "@/lib/meta/analysis-thresholds";
import { setEntitiesStatusSequential } from "@/lib/meta/status";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { fmtCurrency } from "@/lib/format";

type Db = Awaited<ReturnType<typeof createClient>>;
const DATE_PRESET = "last_3d_plus_today" as const;

export interface PausedAdSet {
  ad_account_id: string;
  client_name: string;
  adset_id: string;
  adset_name: string;
  spend: number;
  cost_per_conversation: number | null;
  has_active_ad: boolean;
  ok: boolean;
  error?: string;
}

export interface CheckAdSetsPauseResult {
  paused: PausedAdSet[];
  sendError: string | null;
}

export async function checkAndPauseAdSets(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean } = { send: false },
): Promise<CheckAdSetsPauseResult> {
  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target")
    .eq("user_id", userId)
    .not("cpa_target", "is", null);
  if (bindingsErr) throw bindingsErr;
  if (!bindings || bindings.length === 0) return { paused: [], sendError: null };

  const flagged: {
    ad_account_id: string;
    client_name: string;
    adset_id: string;
    adset_name: string;
    spend: number;
    cost_per_conversation: number | null;
    has_active_ad: boolean;
  }[] = [];

  await Promise.all(
    bindings.map(async (b) => {
      const accountId = b.ad_account_id as string;
      const cpaTarget = b.cpa_target as number;
      const clientName = (b.client_name as string | null) || accountId;
      try {
        const rows = await getAdSetCostAnalysis(token, accountId, DATE_PRESET);
        for (const r of rows) {
          if (!isAdSetFlaggedAbove(r, cpaTarget)) continue;
          flagged.push({
            ad_account_id: accountId,
            client_name: clientName,
            adset_id: r.id,
            adset_name: r.name,
            spend: r.spend,
            cost_per_conversation: r.cost_per_conversation,
            has_active_ad: r.has_active_ad,
          });
        }
      } catch (e) {
        console.error("adsets-pause analysis err (non-fatal)", accountId, e);
      }
    }),
  );

  let paused: PausedAdSet[] = [];
  if (flagged.length > 0) {
    const results = await setEntitiesStatusSequential(
      token,
      flagged.map((f) => ({ id: f.adset_id, type: "adset" as const })),
      "PAUSED",
    );
    const byId = new Map(results.map((r) => [r.id, r]));
    paused = flagged.map((f) => {
      const r = byId.get(f.adset_id);
      return { ...f, ok: !!r?.ok, error: r?.ok ? undefined : (r?.error ?? "Erro desconhecido") };
    });
  }

  const pausedOk = paused.filter((p) => p.ok).sort((a, b) => b.spend - a.spend);

  let sendError: string | null = null;
  if (opts.send && pausedOk.length > 0) {
    try {
      const instance = await requireWhatsappInstance(db, userId);
      if (!instance.alerts_group_id) {
        throw new Error("Cadastre o grupo de avisos em Configurações → WhatsApp antes de verificar.");
      }
      const lines = pausedOk.map((p, i) => {
        if (!p.has_active_ad) return `${i + 1}. ${p.client_name} — ${p.adset_name}: sem anúncio ativo`;
        const metric =
          p.cost_per_conversation != null
            ? `${fmtCurrency(p.cost_per_conversation)}/conversa`
            : `gasto ${fmtCurrency(p.spend)} sem conversa`;
        return `${i + 1}. ${p.client_name} — ${p.adset_name}: ${metric}`;
      });
      const message = `⏸️ Conjuntos pausados automaticamente (CPA acima da meta) — ${pausedOk.length} conjunto${
        pausedOk.length > 1 ? "s" : ""
      }\n\n${lines.join("\n")}`;
      await sendText({ api_url: instance.api_url, token: instance.token }, instance.alerts_group_id, message);
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { paused, sendError };
}
