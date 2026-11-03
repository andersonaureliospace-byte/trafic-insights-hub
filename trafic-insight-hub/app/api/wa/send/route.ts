import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { waFetch } from "@/lib/whatsapp/client";
import { syncChat } from "@/lib/whatsapp/mirror";

// Etapa 244: responder um grupo do espelho pelo seu número (opcional: citando uma mensagem — replyid).
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as { chat?: string; text?: string; replyid?: string };
    const chat = String(body.chat ?? "");
    const text = String(body.text ?? "").trim();
    if (!chat || !text) throw new Error("Escreva a mensagem.");
    const { data: allowed } = await supabase.from("wa_mirror_chats").select("chat_jid").eq("user_id", user.id).eq("chat_jid", chat).maybeSingle();
    if (!allowed) throw new Error("Esse grupo não está no espelho.");
    const inst = await requireWhatsappInstance(supabase, user.id);
    const creds = { api_url: inst.api_url, token: inst.token };
    await waFetch(creds, "/send/text", {
      method: "POST",
      body: JSON.stringify({ number: chat, text, ...(body.replyid ? { replyid: body.replyid } : {}), readchat: true }),
    });
    await syncChat(supabase, user.id, creds, chat, 20).catch(() => 0);
    await supabase.from("wa_mirror_chats").update({ last_read_at: new Date().toISOString() }).eq("user_id", user.id).eq("chat_jid", chat);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
