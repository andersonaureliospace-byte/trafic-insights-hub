// Etapa 260 → Etapa 300: "Suas contas para olhar" da manhã — só o nome da conta e o motivo, sem métricas.
// Motivos (só o que o Hub já guarda, sem pedido à Meta):
//   - CPA alto (Etapa 312): CPL de ONTEM mais de R$ 4 acima do ideal (ou gastou ideal + R$ 4 sem conversa).
//     A pausa de criativo a 3x o ideal continua sendo da auditoria de custo alto (07h, 12h, 19h) — não é aviso aqui;
//   - Investimento abaixo da meta: do dia 01 até ontem, atrasada R$ 50 ou 5% da meta do mês (o que for maior).
// Vai no WhatsApp pessoal de cada gestor; gestor sem número vai pro grupo do Plano, marcando o gestor.
// Gestor sem nenhuma conta pra olhar não recebe mensagem.

import type { SupabaseClient } from "@supabase/supabase-js";
import { readStoredDaysMany } from "@/lib/meta/daily-store";
import { calendarSP, ritmoOf } from "@/lib/estrategia/calc";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { groupFor, isDireto, type AuditConfig } from "./config";
import { ROBO, gestorHeader, loadGestorNumbers } from "./gestores";
import type { Acc } from "./checks";

export const PLANO_REGRAS = {
  cpaAcima: 4, // CPL de ontem mais de R$ 4 acima do ideal (sem conversa: gastou ideal + R$ 4)
  verbaMin: 50, // atraso mínimo (R$)…
  verbaPct: 0.05, // …ou 5% da meta do mês, o que for maior
};

interface ContaPlano {
  acc: Acc;
  motivos: string[];
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function buildPlano(_db: SupabaseClient, _userId: string, accounts: Acc[]): Promise<ContaPlano[]> {
  const cal = calendarSP();
  const yesterday = addDays(cal.today, -1);
  const [storedOntem, storedMonth] = await Promise.all([
    readStoredDaysMany(accounts.map((a) => a.id), yesterday, yesterday),
    cal.day > 1 ? readStoredDaysMany(accounts.map((a) => a.id), cal.monthStart, yesterday) : Promise.resolve(new Map()),
  ]);

  const out: ContaPlano[] = [];
  for (const a of accounts) {
    const motivos: string[] = [];
    const ideal = a.cpaTarget && a.cpaTarget > 0 ? a.cpaTarget : null;

    if (ideal) {
      let spend = 0;
      let res = 0;
      for (const d of storedOntem.get(a.id)?.values() ?? []) {
        spend += d.spend;
        res += d.results;
      }
      const limite = ideal + PLANO_REGRAS.cpaAcima;
      const alto = res > 0 ? spend / res > limite : spend > limite;
      if (alto) motivos.push("CPA alto");
    }

    if (a.monthly && a.monthly > 0 && cal.day > 1) {
      const days = storedMonth.get(a.id);
      if (days && days.size > 0) {
        let spent = 0;
        for (const d of days.values()) spent += d.spend;
        const r = ritmoOf(a.monthly, spent, cal);
        const band = Math.max(PLANO_REGRAS.verbaMin, a.monthly * PLANO_REGRAS.verbaPct);
        if (r.gap != null && r.gap >= band) motivos.push("investimento abaixo da meta");
      }
    }

    if (motivos.length) out.push({ acc: a, motivos });
  }
  // As duas coisas juntas primeiro; depois por nome.
  return out.sort((x, y) => y.motivos.length - x.motivos.length || x.acc.name.localeCompare(y.acc.name, "pt-BR"));
}

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function titulo(): string {
  const cal = calendarSP();
  const wd = new Date(`${cal.today}T12:00:00-03:00`).getDay();
  const [, mm, dd] = cal.today.split("-");
  return `${ROBO} *Suas contas para olhar — ${DIAS[wd]}, ${dd}/${mm}*`;
}

const linha = (c: ContaPlano) => {
  const m = c.motivos.join(" e ");
  return `• ${c.acc.name} — ${m.charAt(0).toUpperCase()}${m.slice(1)}`;
};
const respOf = (a: Acc) => a.responsible || "Sem responsável";

export async function runPlano(db: SupabaseClient, userId: string, cfg: AuditConfig, accounts: Acc[]): Promise<{ contas: number; error: string | null }> {
  const contas = await buildPlano(db, userId, accounts);
  if (contas.length === 0) return { contas: 0, error: null };
  const nums = await loadGestorNumbers(db, userId);
  const inst = await requireWhatsappInstance(db as never, userId);
  const creds = { api_url: inst.api_url, token: inst.token };

  const porGestor = new Map<string, ContaPlano[]>();
  for (const c of contas) porGestor.set(respOf(c.acc), [...(porGestor.get(respOf(c.acc)) ?? []), c]);

  const erros: string[] = [];
  const paraGrupo: string[] = [];
  for (const [g, lista] of porGestor) {
    const num = g === "Sem responsável" || !isDireto(cfg, "plano") ? "" : (nums.get(g.trim().toLowerCase()) ?? "");
    if (!num) {
      paraGrupo.push(g);
      continue;
    }
    try {
      await sendText(creds, num, [titulo(), "", ...lista.map(linha)].join("\n"));
    } catch (e) {
      erros.push(`${g}: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  if (paraGrupo.length > 0) {
    const grp = groupFor(cfg, "plano");
    if (!grp) erros.push(`Sem WhatsApp cadastrado pra: ${paraGrupo.join(", ")} (Configurações → Gestores).`);
    else {
      const mentions: string[] = [];
      const out = [titulo()];
      for (const g of paraGrupo.sort((a, b) => a.localeCompare(b, "pt-BR"))) {
        out.push("", gestorHeader(g, nums, mentions), ...(porGestor.get(g) ?? []).map(linha));
      }
      try {
        await sendText(creds, grp.id, out.join("\n"), { mentions });
      } catch (e) {
        erros.push(`grupo: ${(e as Error).message.slice(0, 120)}`);
      }
    }
  }
  return { contas: contas.length, error: erros.length ? erros.join(" · ") : null };
}
