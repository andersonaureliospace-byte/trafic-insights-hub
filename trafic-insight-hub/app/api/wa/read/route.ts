import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Etapa 244: marca o grupo como lido no espelho (só no Traffic — não muda nada no seu WhatsApp).
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const { chat } = (await request.json()) as { chat?: string };
    if (!chat) throw new Error("Grupo obrigatório.");
    await supabase.from("wa_mirror_chats").update({ last_read_at: new Date().toISOString() }).eq("user_id", user.id).eq("chat_jid", chat);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
