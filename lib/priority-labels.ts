// Rótulos/cores de prioridade personalizados (Configurações > Status) —
// extraído pra cá (Etapa 55) a partir de app/api/priority-labels/route.ts,
// pra ser reaproveitado também pela automação de status em massa (que
// precisa montar a mensagem de WhatsApp com o rótulo que o usuário
// personalizou, não com o rótulo padrão fixo).

import type { createClient } from "@/lib/supabase/server";
import { DEFAULT_PRIORITY_OPTIONS, type PriorityOption } from "@/lib/format";

type Db = Awaited<ReturnType<typeof createClient>>;
const PREF_KEY = "priority_labels";

export async function getPriorityOptions(db: Db, userId: string): Promise<PriorityOption[]> {
  const { data, error } = await db
    .from("user_ui_prefs")
    .select("pref_value")
    .eq("user_id", userId)
    .eq("pref_key", PREF_KEY)
    .maybeSingle();
  if (error) throw error;

  const saved = (data?.pref_value ?? []) as Partial<PriorityOption>[];
  const savedById = new Map(saved.filter((s) => s.id).map((s) => [s.id, s]));
  // Sempre parte dos 5 IDs fixos, na mesma ordem — só troca rótulo/cor se o
  // usuário tiver personalizado aquele item específico.
  return DEFAULT_PRIORITY_OPTIONS.map((def) => ({
    id: def.id,
    label: savedById.get(def.id)?.label || def.label,
    color: savedById.get(def.id)?.color || def.color,
  }));
}
