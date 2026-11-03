import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { syncChat } from "@/lib/whatsapp/mirror";

// Etapa 244: mensagens de um grupo do espelho (do Supabase). ?live=1 busca antes as novas na Uazapi (grupo aberto na tela).
// ?before=ISO pagina pra trás (mensagens mais antigas).
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const url = new URL(request.url);
    const chat = url.searchParams.get("chat") ?? "";
    if (!chat) throw new Error("Grupo obrigatório.");
    const { data: allowed } = await supabase.from("wa_mirror_chats").select("chat_jid").eq("user_id", user.id).eq("chat_jid", chat).maybeSingle();
    if (!allowed) throw new Error("Esse grupo não está no espelho.");
    let liveError: string | null = null;
    if (url.searchParams.get("live") === "1") {
      try {
        const inst = await requireWhatsappInstance(supabase, user.id);
        await syncChat(supabase, user.id, { api_url: inst.api_url, token: inst.token }, chat, 50);
      } catch (e) {
        liveError = (e as Error).message;
      }
    }
    const before = url.searchParams.get("before");
    let q = supabase
      .from("wa_messages")
      .select("message_id, from_me, sender, sender_name, msg_type, body, has_media, quoted_id, ts")
      .eq("user_id", user.id)
      .eq("chat_jid", chat)
      .order("ts", { ascending: false })
      .limit(60);
    if (before) q = q.lt("ts", before);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ messages: (data ?? []).reverse(), hasMore: (data ?? []).length === 60, liveError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
