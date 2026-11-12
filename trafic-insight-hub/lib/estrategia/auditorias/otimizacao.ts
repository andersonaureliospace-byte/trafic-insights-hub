// Etapa 261: Prazo de otimização. Na hora do prazo de cada faixa, confere no histórico de alterações da Meta
// (/activities) se a conta teve pelo menos uma OTIMIZAÇÃO RELEVANTE hoje (orçamento, liga/desliga, criação,
// público, criativo, lance — a mesma regra da coluna Otimização). O que foi feito pelo usuário dono do token
// (as automações do Hub rodam com ele) não conta. A mensagem vai pro grupo escolhido na linha (ou o grupo padrão).
//   Sensíveis (marcação na ficha) até 09h · Críticas até 10h · Altas até 12h · Médias e baixas até 17h.
// Conta sensível só é cobrada às 09h (não entra de novo na faixa da prioridade). Inauguração fica de fora.

import type { SupabaseClient } from "@supabase/supabase-js";
import { metaGet, metaGetAll } from "@/lib/meta/client";
import { memoMeta, tokenTag } from "@/lib/meta/memo";
import { isRelevantActivity } from "@/lib/estrategia/activities";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { groupFor, isDireto, OTIM_PRAZO, type AuditConfig, type OtimFaixa } from "./config";
import type { Acc, CheckResult } from "./checks";
import { ROBO, gestorHeader, loadGestorNumbers } from "./gestores";

const act = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);

function midnightBrtSec(): number {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return Math.floor(new Date(`${ymd}T00:00:00-03:00`).getTime() / 1000);
}

export async function runOtimizacao(
  db: SupabaseClient,
  userId: string,
  token: string,
  cfg: AuditConfig,
  accounts: Acc[],
  faixa: OtimFaixa,
  lot: { index: number; total: number },
  deadline: number,
): Promise<CheckResult> {
  const errors: string[] = [];
  let calls = 0;
  const { data: sensRow } = await db.from("user_ui_prefs").select("pref_value").eq("user_id", userId).eq("pref_key", "contas_sensiveis").maybeSingle();
  const sens = (sensRow?.pref_value ?? {}) as Record<string, boolean>;
  const isSens = (a: Acc) => !!sens[a.id];

  const alvo = accounts
    .filter((a) => {
      if (faixa === "sensivel") return isSens(a);
      if (isSens(a) || a.priority === "inauguracao") return false;
      if (faixa === "critica") return a.priority === "critica";
      if (faixa === "alta") return a.priority === "alta";
      return a.priority === "media" || a.priority === "baixa";
    })
    .filter((_, i) => lot.total <= 1 || i % lot.total === lot.index);
  if (alvo.length === 0) return { findings: [], calls: 0, skipped: 0, errors: [], count: 0, checked: 0 };

  // Quem é o dono do token (as automações do Hub aparecem no histórico com esse nome).
  let me = "";
  try {
    me = await memoMeta(`me-name:${tokenTag(token)}`, 6 * 3600_000, async () => ((await metaGet<{ name?: string }>(token, "/me", { fields: "name" })).name ?? ""));
    calls++;
  } catch {
    /* sem o nome: conta tudo */
  }

  const since = midnightBrtSec();
  const pendentes: Acc[] = [];
  let next = 0;
  let skipped = 0;
  const worker = async () => {
    while (next < alvo.length) {
      const a = alvo[next++];
      if (Date.now() > deadline) {
        skipped++;
        continue;
      }
      try {
        const rows = await metaGetAll<{ event_type?: string; actor_name?: string }>(
          token,
          `/${act(a.id)}/activities`,
          { fields: "event_type,actor_name", since: String(since), until: String(Math.floor(Date.now() / 1000)), limit: "500" },
          4,
        );
        calls++;
        const ok = rows.some((r) => r.event_type && isRelevantActivity(r.event_type) && (!me || (r.actor_name ?? "") !== me));
        if (!ok) pendentes.push(a);
      } catch (e) {
        skipped++;
        errors.push(`${a.name}: ${(e as Error).message.slice(0, 140)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, alvo.length) }, worker));

  if (pendentes.length > 0) {
    const p = OTIM_PRAZO[faixa];
    const byResp = new Map<string, Acc[]>();
    for (const a of pendentes) {
      const r = a.responsible || "Sem responsável";
      byResp.set(r, [...(byResp.get(r) ?? []), a]);
    }
    const nums = await loadGestorNumbers(db, userId);
    const cab = `${ROBO} ⏰ *Prazo de otimização — ${p.label} até ${p.hora}*`;
    // Etapa 301: "direto pro gestor" → cada um recebe só as contas dele no privado; quem não tem número fica no grupo.
    if (isDireto(cfg, "otimizacao")) {
      const inst = await requireWhatsappInstance(db as never, userId);
      for (const [r, list] of [...byResp.entries()]) {
        const num = nums.get(r.trim().toLowerCase());
        if (!num) continue;
        try {
          await sendText({ api_url: inst.api_url, token: inst.token }, num, [cab, "", ...list.map((a) => `• ${a.name}`).sort((x, y) => x.localeCompare(y, "pt-BR"))].join("\n"));
          byResp.delete(r);
        } catch (e) {
          errors.push(`Privado ${r}: ${(e as Error).message.slice(0, 150)}`);
        }
      }
    }
    const restantes = [...byResp.values()].flat();
    const mentions: string[] = [];
    const lines = restantes.length === 0 ? [] : [cab, `${restantes.length} de ${alvo.length} ${alvo.length === 1 ? "conta" : "contas"} sem otimização hoje${lot.total > 1 ? ` (parte ${lot.index + 1}/${lot.total})` : ""}`];
    for (const [r, list] of [...byResp.entries()].sort((x, y) => x[0].localeCompare(y[0], "pt-BR"))) {
      lines.push("", gestorHeader(r, nums, mentions));
      for (const a of list.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"))) lines.push(`• ${a.name}`);
    }
    const to = groupFor(cfg, "otimizacao")?.id;
    if (lines.length === 0) {
      /* tudo foi no privado */
    } else if (!to) errors.push("Sem grupo pro Prazo de otimização (Automações → Auditorias).");
    else {
      const inst = await requireWhatsappInstance(db as never, userId);
      await sendText({ api_url: inst.api_url, token: inst.token }, to, lines.join("\n"), { mentions });
    }
  }
  return { findings: [], calls, skipped, errors, count: pendentes.length, checked: alvo.length };
}
