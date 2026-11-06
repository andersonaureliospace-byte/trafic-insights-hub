// Etapa 260: Plano de ação da manhã — uma mensagem por grupo, separada por gestor, com o que fazer em cada conta,
// da mais urgente pra menos urgente. Só números que o Hub já guarda (sem pedido à Meta):
//   - retrato das ofertas (GERAL / EXAME / PROMO: status + CPA dos 2 últimos dias fechados), feito ~05h20;
//   - backup diário (CPA dos 3 últimos dias fechados e ritmo do investimento do mês);
//   - pausas automáticas de ontem (fila das Auditorias).
// Saldo, pagamento, erros e sem entrega NÃO entram (já vão nos resumos). Sem limite fixo de contas: entra a conta com
// pelo menos um ponto vermelho, ou com dois amarelos/laranjas; no máximo 3 ações por conta.

import type { SupabaseClient } from "@supabase/supabase-js";
import { readOffersSnapshot } from "@/lib/offers/snapshot";
import { offerStatuses, type OfferStatus } from "@/lib/offers/rule";
import { readStoredDaysMany } from "@/lib/meta/daily-store";
import { calendarSP, ritmoOf } from "@/lib/estrategia/calc";
import { fmtCurrency } from "@/lib/format";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { groupFor, type AuditConfig } from "./config";
import type { Acc } from "./checks";

const brl = (v: number) => fmtCurrency(v);

export const PLANO_REGRAS = {
  ofertaCara: 2, // CPA da oferta (2 dias) mais de R$ 2 acima do ideal
  semConversaX: 2, // oferta gastou 2x o ideal sem conversa
  contaCritica: 3, // CPA da conta (3 dias) mais de R$ 3 acima do ideal → conta vermelha
  contaAtencao: 1, // mais de R$ 1 acima → laranja
  verbaMin: 50, // atraso/adiantamento mínimo pra virar ação (R$)…
  verbaPct: 0.05, // …ou 5% da meta do mês, o que for maior
};

type Nivel = 3 | 2 | 1; // 🔴 / 🟠 / 🟡
const ICON: Record<Nivel, string> = { 3: "🔴", 2: "🟠", 1: "🟡" };
const ST_ICON: Record<OfferStatus, string> = { ATIVO: "🟢", INATIVO: "⏸️", INEXISTENTE: "⚪" };

interface Acao {
  nivel: Nivel;
  txt: string;
}
interface ContaPlano {
  acc: Acc;
  score: number;
  nivel: Nivel;
  header: string;
  acoes: Acao[];
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function buildPlano(db: SupabaseClient, userId: string, accounts: Acc[]): Promise<ContaPlano[]> {
  const cal = calendarSP();
  const yesterday = addDays(cal.today, -1);
  const [snap, flagsRow, stored3, storedMonth, pausas] = await Promise.all([
    readOffersSnapshot(db as never, userId),
    db.from("user_ui_prefs").select("pref_value").eq("user_id", userId).eq("pref_key", "offer_flags").maybeSingle(),
    readStoredDaysMany(accounts.map((a) => a.id), addDays(cal.today, -3), yesterday),
    cal.day > 1 ? readStoredDaysMany(accounts.map((a) => a.id), cal.monthStart, yesterday) : Promise.resolve(new Map()),
    db
      .from("estr_digest_items")
      .select("ad_account_id, line")
      .eq("user_id", userId)
      .eq("check_id", "custo_pausa")
      .gte("created_at", new Date(Date.now() - 26 * 3600_000).toISOString()),
  ]);
  const flags = (flagsRow.data?.pref_value ?? {}) as Record<string, { exame?: boolean; promo?: boolean }>;
  const pausasBy = new Map<string, number>();
  for (const p of pausas.data ?? []) if (/PAUSADO/.test(p.line as string)) pausasBy.set(p.ad_account_id as string, (pausasBy.get(p.ad_account_id as string) ?? 0) + 1);

  const out: ContaPlano[] = [];
  for (const a of accounts) {
    const acoes: Acao[] = [];
    const ideal = a.cpaTarget && a.cpaTarget > 0 ? a.cpaTarget : null;
    let contaNivel: Nivel | 0 = 0;

    // CPA da conta nos 3 últimos dias fechados (vai no cabeçalho; pesa na prioridade).
    let spend3 = 0;
    let res3 = 0;
    for (const d of stored3.get(a.id)?.values() ?? []) {
      spend3 += d.spend;
      res3 += d.results;
    }
    let cpaTxt = "";
    if (ideal && spend3 > 0) {
      const cpa = res3 > 0 ? spend3 / res3 : Infinity;
      cpaTxt = `CPA 3 dias ${res3 > 0 ? brl(cpa) : "sem conversa"} (ideal ${brl(ideal)})`;
      if (cpa > ideal + PLANO_REGRAS.contaCritica) contaNivel = 3;
      else if (cpa > ideal + PLANO_REGRAS.contaAtencao) contaNivel = 2;
    }

    // Ofertas.
    const entry = snap.accounts[a.id];
    const statusParts: string[] = [];
    if (entry) {
      const st = offerStatuses(entry.summary);
      const m = entry.summary.metrics?.last2d;
      const f = flags[a.id] ?? {};
      const kinds: Array<{ k: "geral" | "exame" | "promo"; label: string; esperado: boolean }> = [
        { k: "geral", label: "GERAL", esperado: true },
        { k: "exame", label: "EXAME", esperado: !!f.exame },
        { k: "promo", label: "PROMO", esperado: !!f.promo },
      ];
      for (const { k, label, esperado } of kinds) {
        const status = st[k];
        if (!esperado && status === "INEXISTENTE") continue;
        const met = m?.[k];
        const cpa = met && met.spend > 0 ? (met.results > 0 ? met.spend / met.results : Infinity) : null;
        statusParts.push(`${label} ${ST_ICON[status]}${cpa != null && status !== "INEXISTENTE" ? ` ${cpa === Infinity ? "s/ conv." : brl(cpa)}` : ""}`);
        if (esperado && status !== "ATIVO") {
          acoes.push({
            nivel: k === "geral" ? 3 : 2,
            txt: status === "INEXISTENTE" ? `Subir conjunto de ${label} (não tem no mês)` : `Ligar ${label} (está inativa)`,
          });
          continue;
        }
        if (status !== "ATIVO" || !ideal || !met || met.spend <= 0) continue;
        if (met.results <= 0 && met.spend >= ideal * PLANO_REGRAS.semConversaX) {
          acoes.push({ nivel: 3, txt: `${label} gastou ${brl(met.spend)} em 2 dias sem conversa → trocar criativo / revisar público` });
        } else if (cpa != null && cpa > ideal + PLANO_REGRAS.ofertaCara) {
          acoes.push({ nivel: cpa > ideal * 2 ? 3 : 2, txt: `${label} com CPA ${brl(cpa)} (ideal ${brl(ideal)}) → trocar criativo da ${label}` });
        }
      }
    }

    // Verba do mês (do dia 01 até ontem).
    if (a.monthly && a.monthly > 0 && cal.day > 1) {
      const days = storedMonth.get(a.id);
      if (days && days.size > 0) {
        let spent = 0;
        for (const d of days.values()) spent += d.spend;
        const r = ritmoOf(a.monthly, spent, cal);
        const band = Math.max(PLANO_REGRAS.verbaMin, a.monthly * PLANO_REGRAS.verbaPct);
        const restantes = cal.daysInMonth - cal.day + 1; // hoje incluso
        const porDia = Math.max(0, (a.monthly - spent) / restantes);
        if (r.gap != null && r.gap >= band) {
          acoes.push({ nivel: 2, txt: `Atrasada ${brl(r.gap)} no mês → investir ~${brl(porDia)}/dia até o fim do mês (média até aqui ${brl(r.avg ?? 0)}/dia)` });
        } else if (r.gap != null && -r.gap >= band) {
          acoes.push({ nivel: 1, txt: `Adiantada ${brl(-r.gap)} no mês → segurar em ~${brl(porDia)}/dia` });
        }
      }
    }

    // Pausas automáticas de ontem (custo 3x o ideal).
    const np = pausasBy.get(a.id) ?? 0;
    if (np > 0) acoes.push({ nivel: 1, txt: `${np} ${np === 1 ? "pausa automática" : "pausas automáticas"} ontem (custo 3x) → repor criativo` });

    acoes.sort((x, y) => y.nivel - x.nivel);
    const score = acoes.reduce((t, x) => t + x.nivel, 0) + (contaNivel || 0);
    const vermelho = contaNivel === 3 || acoes.some((x) => x.nivel === 3);
    if (!vermelho && score < 4) continue; // natural: só quem precisa de atenção de verdade
    const nivel: Nivel = vermelho ? 3 : score >= 4 ? 2 : 1;
    if (acoes.length === 0 && contaNivel) acoes.push({ nivel: contaNivel, txt: "CPA acima do ideal → revisar conjuntos e criativos" });
    const header = [cpaTxt, statusParts.join(" · ")].filter(Boolean).join("\n   ");
    out.push({ acc: a, score, nivel, header, acoes: acoes.slice(0, 3) });
  }
  return out.sort((x, y) => y.score - x.score || x.acc.name.localeCompare(y.acc.name, "pt-BR"));
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function formatPlano(contas: ContaPlano[], accounts: Acc[]): string {
  const cal = calendarSP();
  const wd = new Date(`${cal.today}T12:00:00-03:00`).getDay();
  const [, mm, dd] = cal.today.split("-");
  const out: string[] = [`📋 *Plano de ação — ${DIAS[wd]}, ${dd}/${mm}*`];
  const gestores = [...new Set(accounts.map((a) => a.responsible || "Sem responsável"))].sort((a, b) =>
    a === "Sem responsável" ? 1 : b === "Sem responsável" ? -1 : a.localeCompare(b, "pt-BR"),
  );
  for (const g of gestores) {
    const total = accounts.filter((a) => (a.responsible || "Sem responsável") === g).length;
    const lista = contas.filter((c) => (c.acc.responsible || "Sem responsável") === g);
    out.push("", `👤 *${g.toUpperCase()}* · ${lista.length ? `${lista.length} de ${total} contas ${lista.length === 1 ? "pede" : "pedem"} atenção` : `nada urgente nas ${total} contas ✅`}`);
    lista.forEach((c, i) => {
      out.push("", `${i + 1}. ${ICON[c.nivel]} *${c.acc.name}*`);
      if (c.header) out.push(`   ${c.header}`);
      for (const x of c.acoes) out.push(`   • ${x.txt}`);
    });
  }
  return out.join("\n");
}

export async function runPlano(db: SupabaseClient, userId: string, cfg: AuditConfig, accounts: Acc[]): Promise<{ contas: number; error: string | null }> {
  const contas = await buildPlano(db, userId, accounts);
  const g = groupFor(cfg, "plano");
  if (!g) return { contas: contas.length, error: "Sem grupo pro Plano de ação (Automações → Auditorias)." };
  const text = formatPlano(contas, accounts);
  const inst = await requireWhatsappInstance(db as never, userId);
  const creds = { api_url: inst.api_url, token: inst.token };
  // Uma mensagem por gestor se passar do tamanho de uma mensagem.
  if (text.length <= 3800) await sendText(creds, g.id, text);
  else for (const part of text.split("\n\n👤 ").map((p, i) => (i === 0 ? p : `👤 ${p}`))) await sendText(creds, g.id, part);
  return { contas: contas.length, error: null };
}
