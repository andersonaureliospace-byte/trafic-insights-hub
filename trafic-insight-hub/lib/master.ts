import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";

// Etapa 353: quem é o master (Anderson) e quais logins têm carteira própria (master + estrategistas).
// Automações (liga/pausa, horários, regras) são do master e valem pra todo mundo; cada estrategista recebe os avisos
// nos grupos/WhatsApp dele.

let cache: { id: string | null; at: number } | null = null;

export async function getMasterId(db: SupabaseClient = createServiceClient()): Promise<string | null> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.id;
  let id: string | null = null;
  const { data } = await db.from("hub_members").select("user_id").eq("role", "master").limit(1);
  id = (data?.[0]?.user_id as string | undefined) ?? null;
  if (!id) {
    // antes do SQL 0049: o login que tem o token da Meta
    const { data: c } = await db.from("user_meta_credentials").select("user_id").not("access_token", "is", null).order("user_id").limit(1);
    id = (c?.[0]?.user_id as string | undefined) ?? null;
  }
  cache = { id, at: Date.now() };
  return id;
}

// Logins com carteira própria (têm token da Meta e não são gestor/desativados). Master sempre primeiro.
export async function listOwners(db: SupabaseClient = createServiceClient()): Promise<string[]> {
  const [{ data: creds }, { data: members }, master] = await Promise.all([
    db.from("user_meta_credentials").select("user_id").not("access_token", "is", null),
    db.from("hub_members").select("user_id, role, disabled"),
    getMasterId(db),
  ]);
  const bloqueados = new Set((members ?? []).filter((m) => m.role === "gestor" || m.disabled).map((m) => m.user_id as string));
  const ids = [...new Set((creds ?? []).map((c) => c.user_id as string))].filter((id) => !bloqueados.has(id));
  return ids.sort((a, b) => (a === master ? -1 : b === master ? 1 : a.localeCompare(b)));
}
