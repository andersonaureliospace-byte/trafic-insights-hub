// Etapa 300: WhatsApp de cada gestor (Configurações → Gestores) — usado pra mandar no privado e pra marcar no grupo.
import type { SupabaseClient } from "@supabase/supabase-js";

export const ROBO = "🤖";

export const toWhats = (s: string) => {
  const d = String(s ?? "").replace(/\D/g, "");
  return d && !d.startsWith("55") && d.length <= 11 ? `55${d}` : d;
};

export async function loadGestorNumbers(db: SupabaseClient, userId: string): Promise<Map<string, string>> {
  const { data } = await db.from("user_ui_prefs").select("pref_value").eq("user_id", userId).eq("pref_key", "gestores").maybeSingle();
  const out = new Map<string, string>();
  for (const x of (Array.isArray(data?.pref_value) ? data?.pref_value : []) as Array<string | { name?: string; whatsapp?: string }>) {
    if (x && typeof x === "object" && x.name) {
      const n = toWhats(String(x.whatsapp ?? ""));
      if (n.length >= 12) out.set(x.name.trim().toLowerCase(), n);
    }
  }
  return out;
}

// Cabeçalho do gestor dentro de uma mensagem de grupo: "👤 @5563…" (marca) ou o nome, se não tiver número.
export function gestorHeader(nome: string, nums: Map<string, string>, mentions: string[]): string {
  const n = nums.get(nome.trim().toLowerCase());
  if (n) {
    mentions.push(n);
    return `👤 @${n}`;
  }
  return `👤 *${nome.toUpperCase()}*`;
}
