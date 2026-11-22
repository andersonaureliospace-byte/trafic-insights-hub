import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserMetaToken } from "@/lib/current-user";
import { hojeDaConta } from "@/lib/estrategia/hoje-conta";
import { CPA_KEYS, ORIGEM_PREFIX, cpaCaiu, parseOrigem } from "@/lib/estrategia/alerta-tarefas";

// Etapa 341: automação das tarefas do quadro Alertas. Roda pelo estr-tick (n8n, a cada 15 min) só nas batidas de 30 em
// 30 min em horário comercial. Busca o gasto/leads de HOJE só das contas que têm tarefa de CPA aberta (1 pedido por conta)
// e finaliza a tarefa quando o CPA de hoje caiu em relação ao da hora em que ela foi criada.
const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export async function autoFinalizarTarefas(db: SupabaseClient, userId: string): Promise<{ verificadas: number; finalizadas: number }> {
  const { data, error } = await db
    .from("estr_tarefas")
    .select("id, ad_account_id, origem_key, descricao")
    .eq("user_id", userId)
    .eq("tipo", "alerta")
    .eq("status", "aberta")
    .like("origem_key", `${ORIGEM_PREFIX}%`)
    .limit(500);
  if (error) throw error;
  const cpaTasks = (data ?? [])
    .map((t) => ({ ...t, meta: parseOrigem(t.origem_key as string) }))
    .filter((t) => t.meta && CPA_KEYS.has(t.meta.alerta) && t.meta.cpaBase != null && t.ad_account_id);
  if (cpaTasks.length === 0) return { verificadas: 0, finalizadas: 0 };

  const token = await getUserMetaToken(db as never, userId);
  const contas = [...new Set(cpaTasks.map((t) => String(t.ad_account_id).replace(/^act_/, "")))];
  const hoje = new Map<string, { spend: number; results: number }>();
  let next = 0;
  const worker = async () => {
    while (next < contas.length) {
      const id = contas[next++];
      try {
        hoje.set(id, await hojeDaConta(token, id));
      } catch (e) {
        console.error("alerta-tarefas hoje", id, (e as Error).message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, contas.length) }, worker));

  let finalizadas = 0;
  const now = new Date().toISOString();
  for (const t of cpaTasks) {
    const h = hoje.get(String(t.ad_account_id).replace(/^act_/, ""));
    const atual = cpaCaiu(t.meta!.cpaBase, h);
    if (atual == null) continue;
    const base = t.meta!.cpaBase === Infinity ? "sem lead" : brl(t.meta!.cpaBase as number);
    const nota = `✓ Finalizada sozinha: o CPA de hoje caiu (${base} → ${brl(atual)}).`;
    const { error: e } = await db
      .from("estr_tarefas")
      .update({ status: "feita", done_at: now, updated_at: now, descricao: `${String(t.descricao ?? "").trim()}\n${nota}`.trim().slice(0, 4000) })
      .eq("id", t.id)
      .eq("user_id", userId);
    if (!e) finalizadas++;
  }
  return { verificadas: cpaTasks.length, finalizadas };
}
