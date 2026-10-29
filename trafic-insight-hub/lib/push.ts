// Etapa 221: notificações push no celular (Web Push / VAPID). Variáveis na Vercel:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT (ex.: mailto:seu@email.com).
// Sem as variáveis, nada é enviado (e nada quebra). Inscrições ficam em push_subscriptions (migration 0039).

import webpush from "web-push";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface PushPayload {
  title: string;
  body: string;
  url?: string; // tela que abre ao tocar (padrão: /m)
  tag?: string; // mesma tag substitui a notificação anterior no aparelho
}

let configured: boolean | null = null;
export function pushConfigured(): boolean {
  if (configured != null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (configured = false);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:avisos@trafic-insight-hub.app", pub, priv);
  return (configured = true);
}

// Manda pra todos os aparelhos inscritos do usuário. Devolve quantos receberam. Nunca lança erro.
export async function sendPushToUser(db: Db, userId: string, payload: PushPayload): Promise<number> {
  try {
    if (!pushConfigured()) return 0;
    const { data, error } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
    if (error || !data?.length) return 0;
    const body = JSON.stringify({
      title: payload.title.slice(0, 120),
      body: payload.body.slice(0, 300),
      url: payload.url ?? "/m",
      tag: payload.tag,
    });
    let sent = 0;
    await Promise.all(
      data.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
            body,
            { TTL: 12 * 3600, urgency: "high" },
          );
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id as string);
          else console.error("push err", code, (e as Error).message);
        }
      }),
    );
    return sent;
  } catch (e) {
    console.error("push err (non-fatal)", (e as Error).message);
    return 0;
  }
}
