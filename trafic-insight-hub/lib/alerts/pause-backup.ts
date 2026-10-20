// Backup das pausas automáticas (Etapa 158) — roda no começo de cada rodada de pausas (n8n, antes dos criativos).
// Revisa os conjuntos e criativos que o sistema pausou nas últimas 6h (registro em auto_pause_log). A Meta atribui conversas
// com atraso, então um item pausado com 1 conversa pode ganhar outra depois e o custo por conversa cair. Reativa quando:
//   - ganhou conversa desde a pausa (mais conversas agora do que na hora da pausa);
//   - o custo por conversa agora é menor que o da pausa;
//   - e já voltou pra dentro do limite (as mesmas regras de pausa não pausariam hoje):
//       criativo = ontem + hoje a menos de R$4 acima da meta; conjunto = 3 dias + hoje a menos de R$4 acima da meta.
// Só mexe em quem ainda está PAUSADO (se você já reativou na mão, sai da fila). Quem reativou é avisado na aba Alertas.

import type { createClient } from "@/lib/supabase/server";
import { getCreativeCostAnalysis } from "@/lib/meta/creative-analysis";
import { metaGet } from "@/lib/meta/client";
import { setEntitiesStatusSequential } from "@/lib/meta/status";
import { shouldReactivate, type Now } from "@/lib/alerts/reactivate-rule";
import { loadPausesToReview, markDone, markReactivated, type PauseLogEntry } from "@/lib/alerts/pause-log";
import { publishAlert } from "@/lib/alerts/notifications";
import { fmtCurrency } from "@/lib/format";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface ReactivatedItem {
  entity_type: "adset" | "ad";
  client_name: string;
  name: string;
  cpa_before: number | null;
  cpa_now: number;
  conv_before: number;
  conv_now: number;
}

export interface PauseBackupResult {
  reviewed: number;
  reactivated: ReactivatedItem[];
  sendError: string | null;
}

export async function reviewPausedAndReactivate(
  db: Db,
  userId: string,
  token: string,
  opts: { send: boolean } = { send: false },
): Promise<PauseBackupResult> {
  const entries = await loadPausesToReview(db, userId);
  if (entries.length === 0) return { reviewed: 0, reactivated: [], sendError: null };

  const { data: bindings } = await db
    .from("account_bindings")
    .select("ad_account_id, cpa_target")
    .eq("user_id", userId)
    .in("ad_account_id", [...new Set(entries.map((e) => e.ad_account_id))]);
  const targetByAccount = new Map((bindings ?? []).filter((b) => b.cpa_target != null).map((b) => [b.ad_account_id as string, Number(b.cpa_target)]));

  const byAccount = new Map<string, PauseLogEntry[]>();
  for (const e of entries) {
    const list = byAccount.get(e.ad_account_id) ?? [];
    list.push(e);
    byAccount.set(e.ad_account_id, list);
  }

  const toActivate: Array<{ entry: PauseLogEntry; now: Now }> = [];
  const doneIds: string[] = [];

  await Promise.all(
    [...byAccount.entries()].map(async ([accountId, list]) => {
      const cpaTarget = targetByAccount.get(accountId);
      if (cpaTarget == null) return;
      try {
        const ads = list.filter((e) => e.entity_type === "ad");
        const adsets = list.filter((e) => e.entity_type === "adset");

        if (ads.length > 0) {
          const rows = await getCreativeCostAnalysis(token, accountId, "today_yesterday");
          const byId = new Map(rows.map((r) => [r.id, r]));
          for (const e of ads) {
            const r = byId.get(e.entity_id);
            if (!r) continue; // sem dado no período: não decide
            const status = (r.status ?? "").toUpperCase();
            if (status === "ACTIVE") {
              doneIds.push(e.id); // já foi reativado por fora
              continue;
            }
            if (status !== "PAUSED") continue;
            const now: Now = { spend: r.spend, conversations: r.conversations ?? 0, cpa: r.cost_per_conversation };
            if (shouldReactivate(e, now, cpaTarget)) toActivate.push({ entry: e, now });
          }
        }

        if (adsets.length > 0) {
          const rows = await getCreativeCostAnalysis(token, accountId, "last_3d_plus_today");
          const agg = new Map<string, { spend: number; conv: number }>();
          for (const r of rows) {
            if (!r.adset_id) continue;
            const g = agg.get(r.adset_id) ?? { spend: 0, conv: 0 };
            g.spend += r.spend;
            g.conv += r.conversations ?? 0;
            agg.set(r.adset_id, g);
          }
          for (const e of adsets) {
            const g = agg.get(e.entity_id);
            if (!g) continue;
            let status = "";
            try {
              const st = await metaGet<{ effective_status?: string; status?: string }>(token, `/${e.entity_id}`, { fields: "effective_status,status" });
              status = (st.effective_status || st.status || "").toUpperCase();
            } catch {
              continue;
            }
            if (status === "ACTIVE") {
              doneIds.push(e.id);
              continue;
            }
            if (status !== "PAUSED") continue;
            const now: Now = { spend: g.spend, conversations: g.conv, cpa: g.conv > 0 ? g.spend / g.conv : null };
            if (shouldReactivate(e, now, cpaTarget)) toActivate.push({ entry: e, now });
          }
        }
      } catch (err) {
        console.error("pause-backup err (non-fatal)", accountId, err);
      }
    }),
  );

  await markDone(db, userId, doneIds);

  const reactivated: ReactivatedItem[] = [];
  if (toActivate.length > 0) {
    const results = await setEntitiesStatusSequential(
      token,
      toActivate.map((t) => ({ id: t.entry.entity_id, type: t.entry.entity_type })),
      "ACTIVE",
    );
    const okById = new Map(results.map((r) => [r.id, r.ok]));
    const okEntries = toActivate.filter((t) => okById.get(t.entry.entity_id));
    await markReactivated(db, userId, okEntries.map((t) => t.entry.id));
    for (const t of okEntries) {
      reactivated.push({
        entity_type: t.entry.entity_type,
        client_name: t.entry.client_name ?? t.entry.ad_account_id,
        name: t.entry.entity_name ?? t.entry.entity_id,
        cpa_before: t.entry.cpa_at_pause,
        cpa_now: t.now.cpa ?? 0,
        conv_before: t.entry.conversations_at_pause ?? 0,
        conv_now: t.now.conversations,
      });
    }
  }

  let sendError: string | null = null;
  if (opts.send && reactivated.length > 0) {
    try {
      const lines = reactivated.map(
        (r, i) =>
          `${i + 1}. ${r.client_name} — ${r.name} (${r.entity_type === "adset" ? "conjunto" : "criativo"}): ${
            r.cpa_before != null ? fmtCurrency(r.cpa_before) : "—"
          } → ${fmtCurrency(r.cpa_now)}/conversa · ${r.conv_before} → ${r.conv_now} conversas`,
      );
      await publishAlert(db, userId, {
        kind: "pause-backup",
        title: `♻️ Backup: reativado — ganhou conversa depois da pausa e o custo voltou pra dentro do limite — ${reactivated.length}`,
        body: lines.join("\n"),
        count: reactivated.length,
      });
    } catch (e) {
      sendError = (e as Error).message;
    }
  }

  return { reviewed: entries.length, reactivated, sendError };
}
