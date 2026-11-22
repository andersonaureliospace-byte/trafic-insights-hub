import type { SupabaseClient } from "@supabase/supabase-js";

// Etapa 346: disparos agendados. O disparo é criado "pausado" e a data/hora fica em user_ui_prefs ("disparos_agendados"),
// sem migration. Quando chega a hora, vira "rodando" e o motor normal (runDisparos) manda. Quem libera: o Hub aberto em
// qualquer tela (confere a cada ~20 s) e a batida das Auditorias no n8n (a cada 15 min, mesmo com o Hub fechado).
export const AGENDADOS_KEY = "disparos_agendados";

export interface DisparoAgendado {
  id: string; // estr_disparos.id
  quando: string; // ISO
}

export async function lerDisparosAgendados(db: SupabaseClient, userId: string): Promise<DisparoAgendado[]> {
  const { data } = await db.from("user_ui_prefs").select("pref_value").eq("user_id", userId).eq("pref_key", AGENDADOS_KEY).maybeSingle();
  const v = data?.pref_value;
  return Array.isArray(v) ? (v as DisparoAgendado[]).filter((a) => a && typeof a.id === "string" && typeof a.quando === "string") : [];
}

export async function gravarDisparosAgendados(db: SupabaseClient, userId: string, list: DisparoAgendado[]): Promise<void> {
  const { error } = await db.from("user_ui_prefs").upsert({ user_id: userId, pref_key: AGENDADOS_KEY, pref_value: list }, { onConflict: "user_id,pref_key" });
  if (error) throw error;
}

export async function tirarAgendamento(db: SupabaseClient, userId: string, id: string): Promise<void> {
  const list = await lerDisparosAgendados(db, userId);
  if (list.some((a) => a.id === id)) await gravarDisparosAgendados(db, userId, list.filter((a) => a.id !== id));
}

// Libera os que já passaram do horário (pausado → rodando). Devolve quantos liberou.
export async function liberarDisparosAgendados(db: SupabaseClient, userId: string): Promise<number> {
  const list = await lerDisparosAgendados(db, userId);
  const agora = Date.now();
  const vencidos = list.filter((a) => Date.parse(a.quando) <= agora);
  if (vencidos.length === 0) return 0;
  await gravarDisparosAgendados(db, userId, list.filter((a) => Date.parse(a.quando) > agora));
  const now = new Date().toISOString();
  let n = 0;
  for (const a of vencidos) {
    const { data } = await db
      .from("estr_disparos")
      .update({ status: "rodando", next_at: now, updated_at: now })
      .eq("id", a.id)
      .eq("user_id", userId)
      .eq("status", "pausado")
      .select("id");
    n += data?.length ?? 0;
  }
  return n;
}
