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
// Etapa 356: no fim de semana só o nome, SEM marcar (@) — o grupo não notifica ninguém no sábado e no domingo.
export function gestorHeader(nome: string, nums: Map<string, string>, mentions: string[]): string {
  const n = nums.get(nome.trim().toLowerCase());
  if (n && !fimDeSemanaSP()) {
    mentions.push(n);
    return `👤 @${n}`;
  }
  return `👤 *${nome.toUpperCase()}*`;
}

// Etapa 356: sábado e domingo (Brasília) — as notificações que vão PRO GESTOR (privado, plano de ação, prazo de
// otimização) ficam pausadas. O que vai pro grupo interno continua.
export function fimDeSemanaSP(now = new Date()): boolean {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(now);
  return wd === "Sat" || wd === "Sun";
}
