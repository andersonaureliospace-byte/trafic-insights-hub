import type { createClient } from "@/lib/supabase/server";

export interface WhatsappInstanceRow {
  id: string;
  api_url: string;
  token: string;
  status: string;
  alerts_group_id: string | null;
  alerts_group_name: string | null;
}

export async function getWhatsappInstance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<WhatsappInstanceRow | null> {
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("id, api_url, token, status, alerts_group_id, alerts_group_name")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as WhatsappInstanceRow | null) ?? null;
}

export async function requireWhatsappInstance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<WhatsappInstanceRow> {
  const inst = await getWhatsappInstance(supabase, userId);
  if (!inst || !inst.api_url || !inst.token) {
    throw new Error("Cadastre a URL e o token do WhatsApp em Configurações → WhatsApp.");
  }
  return inst;
}
