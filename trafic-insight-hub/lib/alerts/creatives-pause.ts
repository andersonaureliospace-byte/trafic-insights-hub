// Pausa automática de Criativos acima da meta (Etapa 53) — pensada pra
// rodar várias vezes ao dia (05h/09h/13h/23h sugeridos no n8n), pausando
// sozinho todo criativo ATIVO com custo por conversa (ou gasto, sem
// conversa) R$4+ acima da Meta CPA — MESMA lógica/limite de Painel >
// Análise > Criativos (isCreativeFlaggedAbove) — e avisando no grupo de
// WhatsApp quais criativos foram pausados. Sem cooldown: como o critério é
// "ainda ATIVO e acima do limite", um criativo já pausado nessa rodada
// simplesmente não aparece mais nas rodadas seguintes (deixou de ser
// ATIVO), então não tem re-pausa nem re-aviso do mesmo criativo. Período
// fixo "últimos 3 dias + hoje" — mesmo padrão default da tela de Análise.
// Etapa 56: as pausas na Meta agora saem uma de cada vez, com 3s de
// intervalo (setEntitiesStatusSequential), em vez de todas em paralelo —
// mesma pauta de segurança contra rate limit que os botões manuais de
// Análise já seguem (BULK_DELAY_MS).

import type { createClient } from "@/lib/supabase/server";
import { getCreativeCostAnalysis } from "@/lib/meta/creative-analysis";
import { isCreativeFlaggedAbove } from "@/lib/meta/analysis-thresholds";
import { setEntitiesStatusSequential } from "@/lib/meta/status";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { fmtCurrency } from "@/lib/format";

type Db = Awaited<ReturnType<typeof createClient>>;
const DATE_PRESET = "last_3d_plus_today" as const;
const STATUSES = ["ACTIVE"];

export interface PausedCreative {
  ad_account_id: string;
  client_name: string;
  ad_id: string;
  ad_name: string;
  spend: number;
  cost_per_conversation: number | null;
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
  opts: { send: boolean } = { send: false },
): Promise<CheckCreativesPauseResult> {
  const { data: bindings, error: bindingsErr } = await db
    .from("account_bindings")
    .select("ad_account_id, client_name, cpa_target")
    .eq("user_id", userId)
    .not("cpa_target", "is", null);
  if (bindingsErr) throw bindingsErr;
  if (!bindings || bindings.length === 0) return { paused: [], sendError: null };

  const flagged: { ad_account_id: string; client_name: string; ad_id: string; ad_name: string; spend: number; cost_per_conversation: number | null }[] = [];

  await Promise.all(
    bindings.map(async (b) => {
      const accountId = b.ad_account_id as string;
      const cpaTarget = b.cpa_target as number;
      const clientName = (b.client_name as string | null) || accountId;
      try {
        const rows = await getCreativeCostAnalysis(token, accountId, DATE_PRESET);
        for (const r of rows) {
          if (!STATUSES.includes((r.status ?? "").toUpperCase())) continue;
          if (!isCreativeFlaggedAbove(r, cpaTarget)) continue;
          flagged.push({
            ad_account_id: accountId,
            client_name: clientName,
            ad_id: r.id,
            ad_name: r.name,
            spend: r.spend,
            cost_per_conversation: r.cost_per_conversation,
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
      const instance = await requireWhatsappInstance(db, userId);
      if (!instance.alerts_group_id) {
        throw new Error("Cadastre o grupo de avisos em Configurações → WhatsApp antes de verificar.");
      }
      const lines = pausedOk.map(
        (p, i) =>
          `${i + 1}. ${p.client_name} — ${p.ad_name}: ${
            p.cost_per_conversation != null
              ? `${fmtCurrency(p.cost_per_conversation)}/conversa`
              : `gasto ${fmtCurrency(p.spend)} sem conversa`
          }`,
      );
      const message = `⏸️ Criativos pausados automaticamente (CPA acima da meta) — ${pausedOk.length} anúncio${
        pausedOk.length > 1 ? "s" : ""
      }\n\n${lines.join("\n")}`;
      await sendText({ api_url: instance.api_url, token: instance.token }, instance.alerts_group_id, message);
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { paused, sendError };
}
