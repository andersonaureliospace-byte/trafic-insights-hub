// Etapa 330: histórico das mudanças de prioridade por conta (user_ui_prefs "prioridade_hist" = { [conta]: Mudanca[] },
// mais nova primeiro, as últimas 10). Gravado quando a prioridade muda na ficha (manual) e na reclassificação
// automática. O gerador de feedback usa pra ajustar o tom: subiu = mais urgência; desceu = mais calmo e animador.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MudancaPrioridade {
  de: string | null;
  para: string | null;
  em: string; // ISO
  origem: "manual" | "automatica";
}
export type HistPrioridade = Record<string, MudancaPrioridade[]>;

export const PRIORIDADE_HIST_KEY = "prioridade_hist";
const norm = (id: string) => String(id).replace(/^act_/, "");

// Peso pra saber se subiu ou desceu (Inauguração fica à parte).
const PESO: Record<string, number> = { baixa: 1, media: 2, alta: 3, critica: 4 };
export function direcao(m: Pick<MudancaPrioridade, "de" | "para">): "subiu" | "desceu" | "outra" {
  const a = m.de ? PESO[m.de] : undefined;
  const b = m.para ? PESO[m.para] : undefined;
  if (a == null || b == null || a === b) return "outra";
  return b > a ? "subiu" : "desceu";
}

// Nunca quebra quem chamou: o histórico é só um apoio.
export async function registrarPrioridades(
  db: SupabaseClient,
  userId: string,
  mudancas: Array<{ conta: string; de: string | null; para: string | null }>,
  origem: MudancaPrioridade["origem"],
): Promise<void> {
  const reais = mudancas.filter((m) => (m.de ?? null) !== (m.para ?? null));
  if (reais.length === 0) return;
  try {
    const { data } = await db.from("user_ui_prefs").select("pref_value").eq("user_id", userId).eq("pref_key", PRIORIDADE_HIST_KEY).maybeSingle();
    const hist = ((data?.pref_value ?? {}) as HistPrioridade) || {};
    const em = new Date().toISOString();
    for (const m of reais) {
      const id = norm(m.conta);
      hist[id] = [{ de: m.de ?? null, para: m.para ?? null, em, origem }, ...(hist[id] ?? [])].slice(0, 10);
    }
    await db.from("user_ui_prefs").upsert({ user_id: userId, pref_key: PRIORIDADE_HIST_KEY, pref_value: hist }, { onConflict: "user_id,pref_key" });
  } catch (e) {
    console.error("prioridade_hist err", (e as Error).message);
  }
}
