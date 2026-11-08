// Etapa 286: quadro Demandas — regras do servidor (sem React). Tarefas e rotinas ficam no Supabase (estr_tarefas /
// estr_rotinas). Rotina gera a tarefa do dia sozinha (uma por cliente quando é "todos"), sempre com o gestor do cliente.
// Alerta grave do Tráfego (pagamento/saldo, sem entrega, criativo pausado por custo) também vira tarefa.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Acc, Finding } from "./auditorias/checks";

export type TipoTarefa = "manual" | "rotina" | "alerta" | "feedback";
export interface Tarefa {
  id: string;
  titulo: string;
  descricao: string;
  tipo: TipoTarefa;
  ad_account_id: string | null;
  client_name: string | null;
  responsavel: string | null;
  data: string; // YYYY-MM-DD
  ordem: number;
  status: "aberta" | "feita" | "excluida";
  done_at: string | null;
  rotina_id: string | null;
  created_at: string;
}
export interface Rotina {
  id: string;
  titulo: string;
  descricao: string;
  alvo: "todos" | "cliente" | "nenhum";
  ad_account_id: string | null;
  responsavel: string | null;
  frequencia: "diaria" | "semanal" | "mensal";
  dias_semana: number[];
  dia_mes: number;
  ativa: boolean;
  created_at: string;
}

export const TAREFA_COLS = "id, titulo, descricao, tipo, ad_account_id, client_name, responsavel, data, ordem, status, done_at, rotina_id, created_at";
export const ROTINA_COLS = "id, titulo, descricao, alvo, ad_account_id, responsavel, frequencia, dias_semana, dia_mes, ativa, created_at";

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function rotinaNoDia(r: Rotina, ymd: string): boolean {
  if (r.frequencia === "diaria") return true;
  if (r.frequencia === "semanal") return (r.dias_semana ?? []).includes(weekdayOf(ymd));
  const [y, m, d] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d === Math.min(Math.max(1, r.dia_mes || 1), last); // dia 31 em mês de 30 → último dia
}

// Gera (sem repetir) as tarefas das rotinas ativas entre "from" e "to". A chave origem_key impede duplicar — e tarefa
// excluída fica marcada como excluída (não volta).
export async function gerarRotinas(db: SupabaseClient, userId: string, from: string, to: string, carteira: Acc[]): Promise<number> {
  const { data } = await db.from("estr_rotinas").select(ROTINA_COLS).eq("user_id", userId).eq("ativa", true);
  const rotinas = (data ?? []) as Rotina[];
  if (rotinas.length === 0) return 0;
  const byId = new Map(carteira.map((a) => [a.id, a]));
  const rows: Array<Record<string, unknown>> = [];
  for (let day = from; day <= to; day = addDaysYmd(day, 1)) {
    for (const r of rotinas) {
      if (day < r.created_at.slice(0, 10) || !rotinaNoDia(r, day)) continue;
      const alvos: Array<Acc | null> =
        r.alvo === "todos" ? carteira : r.alvo === "cliente" ? [byId.get(String(r.ad_account_id ?? "").replace(/^act_/, "")) ?? null].filter(Boolean) : [null];
      for (const a of alvos) {
        rows.push({
          user_id: userId,
          titulo: r.titulo,
          descricao: r.descricao,
          tipo: "rotina",
          ad_account_id: a?.id ?? null,
          client_name: a?.name ?? null,
          responsavel: a ? a.responsible : r.responsavel,
          data: day,
          ordem: 1000,
          rotina_id: r.id,
          origem_key: `rotina:${r.id}:${a?.id ?? "-"}:${day}`,
        });
      }
    }
  }
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data: ins } = await db.from("estr_tarefas").upsert(rows.slice(i, i + 500), { onConflict: "user_id,origem_key", ignoreDuplicates: true }).select("id");
    n += ins?.length ?? 0;
  }
  return n;
}

// Alertas graves das Auditorias que viram tarefa no dia (1 por conta por tipo por dia).
const GRAVES: Partial<Record<string, string>> = {
  saldo: "Saldo / pagamento",
  sem_entrega: "Conta sem entrega",
  custo_pausa: "Criativo pausado por custo alto — subir substituto",
  erros: "Erro de veiculação",
};
export async function tarefasDeAlertas(db: SupabaseClient, userId: string, findings: Finding[], hoje: string): Promise<number> {
  const rows = findings
    .filter((f) => GRAVES[f.check])
    .map((f) => {
      const tipo = f.check === "saldo" ? (f.line.startsWith("Pagamento") ? "pagamento" : "saldo") : f.check;
      return {
        user_id: userId,
        titulo: GRAVES[f.check] as string,
        descricao: f.line,
        tipo: "alerta",
        ad_account_id: f.acc.id,
        client_name: f.acc.name,
        responsavel: f.acc.responsible,
        data: hoje,
        ordem: -1000, // alerta entra no topo do dia
        origem_key: `alerta:${tipo}:${f.acc.id}:${hoje}`,
      };
    });
  if (rows.length === 0) return 0;
  const { data } = await db.from("estr_tarefas").upsert(rows, { onConflict: "user_id,origem_key", ignoreDuplicates: true }).select("id");
  return data?.length ?? 0;
}
