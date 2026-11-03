import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { purgeOld, syncChat } from "@/lib/whatsapp/mirror";

// Etapa 244: espelho do WhatsApp — o n8n chama a cada 5 minutos. Busca na Uazapi as mensagens novas de cada grupo do
// espelho, grava no Supabase e apaga o que passou de 90 dias. Protegido pelo WHATSAPP_DISPATCH_SECRET.
// (Fora do Registro das automações de propósito: roda o tempo todo e não mexe em nada na Meta.)
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_DISPATCH_SECRET;
  if (!secret) return NextResponse.json({ error: "WHATSAPP_DISPATCH_SECRET não configurado no servidor." }, { status: 500 });
  if (request.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = createServiceClient();
  const { data: chats, error } = await db.from("wa_mirror_chats").select("user_id, chat_jid");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const users = [...new Set((chats ?? []).map((c) => c.user_id as string))];
  const deadline = Date.now() + 50_000;
  const results: Array<Record<string, unknown>> = [];
  for (const userId of users) {
    const { data: inst } = await db.from("whatsapp_instances").select("api_url, token").eq("user_id", userId).maybeSingle();
    if (!inst?.api_url || !inst?.token) continue;
    const creds = { api_url: inst.api_url as string, token: inst.token as string };
    const mine = (chats ?? []).filter((c) => c.user_id === userId);
    let saved = 0;
    const errors: string[] = [];
    // 4 grupos por vez
    const queue = [...mine];
    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        if (Date.now() > deadline) return;
        try {
          saved += await syncChat(db, userId, creds, c.chat_jid as string, 200);
        } catch (e) {
          errors.push(`${c.chat_jid}: ${(e as Error).message}`);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    await purgeOld(db, userId).catch(() => {});
    results.push({ userId, chats: mine.length, saved, errors: errors.slice(0, 5) });
  }
  return NextResponse.json({ ok: true, results });
}
