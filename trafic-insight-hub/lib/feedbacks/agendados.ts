import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarFeedback } from "@/lib/feedbacks/enviar";

// Etapa 315: feedbacks com envio programado. Ficam em user_ui_prefs ("feedbacks_agendados") — sem migration.
// O estr-tick (n8n, a cada 15 min) manda os que já passaram do horário.
export const AGENDADOS_KEY = "feedbacks_agendados";

export interface Agendado {
  id: string; // client_feedbacks.id
  quando: string; // ISO
  proximo?: string | null; // próximo feedback (Demandas), se marcado
  cliente?: string | null;
}

export async function lerAgendados(db: SupabaseClient, userId: string): Promise<Agendado[]> {
  const { data } = await db.from("user_ui_prefs").select("pref_value").eq("user_id", userId).eq("pref_key", AGENDADOS_KEY).maybeSingle();
  const v = data?.pref_value;
  return Array.isArray(v) ? (v as Agendado[]).filter((a) => a && typeof a.id === "string" && typeof a.quando === "string") : [];
}

export async function gravarAgendados(db: SupabaseClient, userId: string, list: Agendado[]): Promise<void> {
  const { error } = await db
    .from("user_ui_prefs")
    .upsert({ user_id: userId, pref_key: AGENDADOS_KEY, pref_value: list }, { onConflict: "user_id,pref_key" });
  if (error) throw error;
}

export async function enviarAgendados(db: SupabaseClient, userId: string): Promise<{ enviados: number; erros: string[] }> {
  const list = await lerAgendados(db, userId);
  const agora = Date.now();
  const vencidos = list.filter((a) => Date.parse(a.quando) <= agora);
  if (vencidos.length === 0) return { enviados: 0, erros: [] };
  // tira da fila antes de mandar (não manda duas vezes se dois ticks se cruzarem); erro fica gravado no feedback
  await gravarAgendados(db, userId, list.filter((a) => Date.parse(a.quando) > agora));
  let enviados = 0;
  const erros: string[] = [];
  for (const a of vencidos) {
    try {
      await enviarFeedback(db, userId, a.id, a.proximo ?? null);
      enviados++;
    } catch (e) {
      erros.push(`${a.cliente ?? a.id}: ${(e as Error).message.slice(0, 150)}`);
    }
  }
  return { enviados, erros };
}
