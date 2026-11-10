// Etapa 257: uma "batida" das Auditorias (a cada 15 min, chamada pelo n8n). Descobre o horário de Brasília, pega os
// trabalhos da agenda pra esse horário, roda cada um só no lote de contas dele e, se for horário de resumo, manda.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserMetaToken } from "@/lib/current-user";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import {
  AUDIT_PREF_KEY,
  isCheckOn,
  jobsAt,
  minuteToHHMM,
  normalizeConfig,
  type AuditConfig,
  type CheckId,
  type Job,
} from "./config";
import {
  runCpaDia,
  runCustoAlto,
  runErros,
  runExpansaoWhatsapp,
  runSaldo,
  runPrioridade,
  runSemEntrega,
  runVerbaDiaria,
  runVerbaMensal,
  type Acc,
  type CheckResult,
} from "./checks";
import { queueFindings, sendDigest, sendUrgent, type DigestResult } from "./digest";
import { runPlano } from "./plano";
import { runOtimizacao } from "./otimizacao";
import { tarefasDeAlertas } from "@/lib/estrategia/demandas";
import { calendarSP } from "@/lib/estrategia/calc";
import type { OtimFaixa } from "./config";

export async function loadConfig(db: SupabaseClient, userId: string): Promise<AuditConfig> {
  const { data } = await db.from("user_ui_prefs").select("pref_value").eq("user_id", userId).eq("pref_key", AUDIT_PREF_KEY).maybeSingle();
  return normalizeConfig(data?.pref_value);
}

// Carteira do Hub estratégico: contas exibidas, sem as desativadas/arquivadas. Ordem fixa (pelo id) = lotes estáveis.
export async function loadCarteira(db: SupabaseClient, userId: string): Promise<Acc[]> {
  const [{ data: sel }, { data: binds }, off] = await Promise.all([
    db.from("user_selected_accounts").select("ad_account_id").eq("user_id", userId),
    db.from("account_bindings").select("ad_account_id, client_name, responsible, cpa_target, monthly_investment, whatsapp_contact, archived, priority").eq("user_id", userId),
    inactiveAccountIds(db as never, userId),
  ]);
  const norm = (s: string) => String(s).replace(/^act_/, "");
  const offN = new Set([...off].map(norm));
  const bById = new Map((binds ?? []).map((b) => [norm(b.ad_account_id as string), b]));
  const ids = [...new Set((sel ?? []).map((s) => norm(s.ad_account_id as string)))].filter((id) => !offN.has(id) && !bById.get(id)?.archived);
  return ids.sort().map((id) => {
    const b = bById.get(id);
    return {
      id,
      name: ((b?.client_name as string | null) ?? "").trim() || id,
      responsible: ((b?.responsible as string | null) ?? "").trim() || null,
      cpaTarget: b?.cpa_target != null ? Number(b.cpa_target) : null,
      monthly: b?.monthly_investment != null ? Number(b.monthly_investment) : null,
      whatsapp: ((b?.whatsapp_contact as string | null) ?? "").trim() || null,
      priority: (b?.priority as string | null) ?? null,
    };
  });
}

export function slotNow(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  // O n8n pode chamar alguns segundos/minutos atrasado: arredonda pra batida de 15 min mais próxima pra trás.
  return h * 60 + Math.floor(m / 15) * 15;
}

const lotOf = (accounts: Acc[], j: Job) => (j.lots <= 1 ? accounts : accounts.filter((_, i) => i % j.lots === j.lot));

export interface TickReport {
  slot: string;
  jobs: Array<{ check: CheckId; lot: string; accounts: number; calls: number; found: number; queued: number; skipped: number; error?: string }>;
  digest: DigestResult | null;
}

export async function runTick(db: SupabaseClient, userId: string, opts: { minute?: number; forceDigest?: boolean; only?: CheckId } = {}): Promise<TickReport> {
  const started = Date.now();
  const deadline = started + 45_000; // a função tem 60s; sobra tempo pro resumo e pro registro
  const minute = opts.minute ?? slotNow();
  const slot = minuteToHHMM(minute >= 0 ? minute : slotNow());
  const cfg = await loadConfig(db, userId);
  const report: TickReport = { slot, jobs: [], digest: null };

  const weekday = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })).getDay();
  let jobs = jobsAt(minute, weekday);
  if (opts.only) jobs = jobs.filter((j) => j.check === opts.only);
  // A conferência de WhatsApp usa a mesma busca da expansão: roda se qualquer uma das duas estiver ligada.
  jobs = jobs.filter((j) => (j.check === "expansao" ? isCheckOn(cfg, "expansao") || isCheckOn(cfg, "whatsapp") : isCheckOn(cfg, j.check)));

  if (jobs.length > 0) {
    const carteira = await loadCarteira(db, userId);
    let token: string | null = null;
    try {
      token = await getUserMetaToken(db as never, userId);
    } catch (e) {
      for (const j of jobs) report.jobs.push({ check: j.check, lot: `${j.lot + 1}/${j.lots}`, accounts: 0, calls: 0, found: 0, queued: 0, skipped: 0, error: (e as Error).message });
      jobs = [];
    }
    for (const j of jobs) {
      const lot = lotOf(carteira, j);
      const entry = { check: j.check, lot: `${j.lot + 1}/${j.lots}`, accounts: lot.length, calls: 0, found: 0, queued: 0, skipped: 0 } as TickReport["jobs"][number];
      try {
        if (Date.now() > deadline) throw new Error("sem tempo nesta batida");
        let res: CheckResult;
        const t = token as string;
        switch (j.check) {
          case "expansao":
            res = await runExpansaoWhatsapp(db, userId, t, lot, deadline, {
              expansao: isCheckOn(cfg, "expansao"),
              whatsapp: isCheckOn(cfg, "whatsapp"),
              full: slot.startsWith("06:"), // Etapa 295: 1ª rodada do dia confere todos os conjuntos ativos
            });
            {
              // Etapa 295: WhatsApp do anúncio diferente da ficha (ou ficha sem WhatsApp) é urgente — avisa NA HORA
              const wpp = res.findings.filter((f) => f.check === "whatsapp");
              if (wpp.length) {
                const u = await sendUrgent(db, userId, cfg, wpp, "whatsapp", "🚨 *URGENTE — WhatsApp do anúncio*");
                await tarefasDeAlertas(db, userId, wpp, calendarSP().today).catch(() => 0);
                res = { ...res, findings: res.findings.filter((f) => f.check !== "whatsapp"), count: res.findings.length, errors: u.error ? [...res.errors, u.error] : res.errors };
                entry.queued = u.sent;
              }
            }
            break;
          case "custo":
            res = await runCustoAlto(db, userId, t, lot, deadline);
            // Etapa 300: aviso de custo 2x desligado por enquanto — só as pausas (3x) seguem avisando.
            res = { ...res, findings: res.findings.filter((f) => f.check !== "custo") };
            break;
          case "cpa_dia":
            res = await runCpaDia(t, lot, deadline, j.variant === "evening" ? "evening" : "midday");
            break;
          case "saldo":
            if (j.variant === "urgente") {
              // Etapa 284: urgente — manda agora (não vai pra fila do resumo)
              const r = await runSaldo(db, userId, t, lot, slot, true);
              const u = await sendUrgent(db, userId, cfg, r.findings);
              await tarefasDeAlertas(db, userId, r.findings, calendarSP().today).catch(() => 0); // Etapa 286: vira tarefa
              res = { ...r, findings: [], count: r.findings.length, errors: u.error ? [...r.errors, u.error] : r.errors };
              entry.queued = u.sent;
            } else res = await runSaldo(db, userId, t, lot, slot);
            break;
          case "verba_mensal":
            // Etapa 260: com o Plano de ação ligado, o investimento do mês vai nele (não repete no resumo das 08h).
            res = isCheckOn(cfg, "plano") ? { findings: [], calls: 0, skipped: 0, errors: [] } : await runVerbaMensal(lot);
            break;
          case "otimizacao":
            // a faixa escolhe as contas; o lote divide só a faixa (não a carteira inteira)
            res = await runOtimizacao(db, userId, t, cfg, carteira, (j.variant ?? "critica") as OtimFaixa, { index: j.lot, total: j.lots }, deadline);
            break;
          case "plano": {
            const p = await runPlano(db, userId, cfg, lot);
            res = { findings: [], calls: 0, skipped: 0, errors: p.error ? [p.error] : [] };
            entry.found = p.contas;
            break;
          }
          case "verba_diaria":
            res = await runVerbaDiaria(t, lot, deadline);
            break;
          case "sem_entrega":
            res = await runSemEntrega(t, lot, deadline, slot);
            break;
          case "erros":
            res = await runErros(t, lot, deadline);
            break;
          case "prioridade":
            res = await runPrioridade(db, userId, t, lot);
            break;
          default:
            res = { findings: [], calls: 0, skipped: 0, errors: [] };
        }
        entry.calls = res.calls;
        if (j.check !== "plano") entry.found = res.count ?? res.findings.length;
        if (res.checked != null) entry.accounts = res.checked;
        entry.skipped = res.skipped;
        if (res.findings.length) {
          entry.queued = await queueFindings(db, userId, cfg, res.findings);
          // Etapa 286: alertas graves (saldo/pagamento, sem entrega, criativo pausado, erro) viram tarefa no quadro Demandas
          await tarefasDeAlertas(db, userId, res.findings, calendarSP().today).catch(() => 0);
        }
        if (res.errors.length) entry.error = res.errors.slice(0, 3).join(" · ");
      } catch (e) {
        entry.error = (e as Error).message.slice(0, 300);
      }
      report.jobs.push(entry);
    }
  }

  // Etapa 300: não acumula mais — o que entrou na fila nesta batida já sai agora (sendDigest não faz nada se a fila
  // estiver vazia). Os horários de resumo da tela deixaram de ser usados.
  {
    try {
      report.digest = await sendDigest(db, userId, cfg, slot);
    } catch (e) {
      report.digest = { groups: 0, items: 0, noGroup: 0, error: (e as Error).message };
    }
  }

  // Registro (uma linha por trabalho; resumo enviado entra como "resumo").
  const rows = [
    ...report.jobs.map((j) => ({ user_id: userId, slot, check_id: j.check, lot: j.lot, accounts: j.accounts, meta_calls: j.calls, found: j.found, error: j.error ?? null })),
    ...(report.digest && (report.digest.items > 0 || report.digest.error)
      ? [{ user_id: userId, slot, check_id: "resumo", lot: null, accounts: report.digest.groups, meta_calls: 0, found: report.digest.items, error: report.digest.error }]
      : []),
  ];
  if (rows.length > 0) {
    await db.from("estr_audit_runs").insert(rows);
    await db.from("estr_audit_runs").delete().eq("user_id", userId).lt("ran_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  }
  return report;
}
