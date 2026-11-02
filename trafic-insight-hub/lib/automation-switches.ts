// Etapa 238: leitura do liga/pausa das automações pelos hooks do n8n (servidor). Regras em automation-switches-shared.ts.
import { createServiceClient } from "@/lib/supabase/server";
import { isEnabled, SWITCHES_PREF_KEY, type Switches } from "@/lib/automation-switches-shared";

export { DEFAULT_PAUSED, isEnabled, SWITCHES_PREF_KEY, type Switches } from "@/lib/automation-switches-shared";

// Leitura pelos hooks (sem login: usa a service key). App de um usuário só — vale a primeira linha encontrada.
// Se a leitura falhar, segue o padrão (nunca derruba a automação por isso).
export async function readSwitchesService(): Promise<Switches> {
  try {
    const db = createServiceClient();
    const { data, error } = await db.from("user_ui_prefs").select("pref_value").eq("pref_key", SWITCHES_PREF_KEY).limit(1);
    if (error) throw error;
    const v = data?.[0]?.pref_value;
    return v && typeof v === "object" ? (v as Switches) : {};
  } catch (e) {
    console.error("automation switches read err", (e as Error).message);
    return {};
  }
}

export async function automationPaused(key: string): Promise<boolean> {
  return !isEnabled(await readSwitchesService(), key);
}
