// Etapa 96: Pix/boleto já enviados "resolvem" o aviso da conta. Depois de um envio
// com sucesso (status 'sent'), os avisos daquela conta somem de Pendências (e não
// disparam WhatsApp) por 24h — igual ao cooldown dos avisos. Passou disso e o saldo/
// pagamento continua com problema, o aviso volta sozinho.
//   - Pix ou boleto enviado → some o "Saldo baixo" e o alerta de sexta.
//   - Boleto enviado → some também o "Erro no pagamento" (conta de boleto só trava por isso).
// Pix agendado (status 'scheduled') ainda não conta — só quando de fato foi enviado.

import type { createClient } from "@/lib/supabase/server";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";

type Db = Awaited<ReturnType<typeof createClient>>;

export const SEND_HANDLED_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RecentSends {
  pix: Set<string>;
  boleto: Set<string>;
}

export async function getRecentSends(db: Db, userId: string): Promise<RecentSends> {
  const since = new Date(Date.now() - SEND_HANDLED_WINDOW_MS).toISOString();
  const [pixRes, boletoRes] = await Promise.all([
    db.from("pix_sends").select("ad_account_id").eq("user_id", userId).eq("status", "sent").gte("created_at", since),
    db.from("boleto_sends").select("ad_account_id").eq("user_id", userId).eq("status", "sent").gte("created_at", since),
  ]);
  return {
    pix: new Set((pixRes.data ?? []).map((r) => r.ad_account_id as string)),
    boleto: new Set((boletoRes.data ?? []).map((r) => r.ad_account_id as string)),
  };
}

// Aviso no grupo de avisos do WhatsApp (o mesmo dos alertas). Nunca derruba o envio:
// devolve a mensagem de erro (ou null se deu certo) pra quem chamou mostrar na tela.
export async function notifyAlertsGroup(db: Db, userId: string, text: string): Promise<string | null> {
  try {
    const instance = await requireWhatsappInstance(db, userId);
    if (!instance.alerts_group_id) {
      return "Cadastre o grupo de avisos em Configurações → WhatsApp pra receber esse aviso.";
    }
    await sendText({ api_url: instance.api_url, token: instance.token }, instance.alerts_group_id, text);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
