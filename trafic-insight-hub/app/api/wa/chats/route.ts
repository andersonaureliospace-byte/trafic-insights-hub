import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { purgeOld, syncChat } from "@/lib/whatsapp/mirror";

// Etapa 244: grupos do espelho do WhatsApp.
//   GET    → grupos escolhidos, com não lidas e última mensagem (?sync=1: antes busca as novas de todos na Uazapi)
//   PUT    → { chat_jid, name, ad_account_ids } adiciona/atualiza (grupo novo já puxa o que a Uazapi tiver)
//   DELETE → { chat_jid } tira do espelho (apaga as mensagens guardadas dele)
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    // Com o Hub aberto, o painel pede ?sync=1 de minuto em minuto: busca as mensagens novas de todos os grupos (4 por vez,
    // até ~20s) e apaga o que passou de 90 dias. A Uazapi guarda cerca de uma semana, então nada se perde entre aberturas.
    let syncError: string | null = null;
    if (new URL(request.url).searchParams.get("sync") === "1") {
      try {
        const inst = await requireWhatsappInstance(supabase, user.id);
        const creds = { api_url: inst.api_url, token: inst.token };
        const { data: list } = await supabase.from("wa_mirror_chats").select("chat_jid").eq("user_id", user.id);
        const queue = (list ?? []).map((c) => c.chat_jid as string);
        const deadline = Date.now() + 20_000;
        const worker = async () => {
          for (let c = queue.shift(); c; c = queue.shift()) {
            if (Date.now() > deadline) return;
            await syncChat(supabase, user.id, creds, c, 200).catch(() => 0);
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        await purgeOld(supabase, user.id).catch(() => {});
      } catch (e) {
        syncError = (e as Error).message;
      }
    }
    const { data, error } = await supabase
      .from("wa_mirror_chats")
      .select("chat_jid, name, ad_account_ids, last_read_at, last_message_at, last_preview, synced_at, created_at")
      .eq("user_id", user.id);
    if (error) {
      if (/wa_mirror_chats/.test(error.message)) throw new Error("Rode o SQL supabase/migrations/0042_wa_mirror.sql no Supabase.");
      throw error;
    }
    const chats = await Promise.all(
      (data ?? []).map(async (c) => {
        const since = (c.last_read_at as string | null) ?? (c.created_at as string);
        const { count } = await supabase
          .from("wa_messages")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("chat_jid", c.chat_jid as string)
          .eq("from_me", false)
          .gt("ts", since);
        return { ...c, unread: count ?? 0 };
      }),
    );
    chats.sort((a, b) => String(b.last_message_at ?? "").localeCompare(String(a.last_message_at ?? "")));
    return NextResponse.json({ chats, syncError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as { chat_jid?: string; name?: string; ad_account_ids?: string[] };
    const chat = String(body.chat_jid ?? "").trim();
    if (!chat.endsWith("@g.us") && !chat.endsWith("@s.whatsapp.net")) throw new Error("Grupo inválido.");
    const { data: existing } = await supabase.from("wa_mirror_chats").select("id").eq("user_id", user.id).eq("chat_jid", chat).maybeSingle();
    const { error } = await supabase.from("wa_mirror_chats").upsert(
      {
        user_id: user.id,
        chat_jid: chat,
        name: String(body.name ?? "").slice(0, 200),
        ad_account_ids: Array.isArray(body.ad_account_ids) ? body.ad_account_ids.map(String).slice(0, 20) : [],
        ...(existing ? {} : { last_read_at: new Date().toISOString() }),
      },
      { onConflict: "user_id,chat_jid" },
    );
    if (error) {
      if (/wa_mirror_chats/.test(error.message)) throw new Error("Rode o SQL supabase/migrations/0042_wa_mirror.sql no Supabase.");
      throw error;
    }
    let imported = 0;
    let importError: string | null = null;
    if (!existing) {
      try {
        const inst = await requireWhatsappInstance(supabase, user.id);
        imported = await syncChat(supabase, user.id, { api_url: inst.api_url, token: inst.token }, chat, 2000);
      } catch (e) {
        importError = (e as Error).message;
      }
    }
    return NextResponse.json({ ok: true, imported, importError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as { chat_jid?: string };
    const chat = String(body.chat_jid ?? "").trim();
    if (!chat) throw new Error("Grupo obrigatório.");
    await supabase.from("wa_mirror_chats").delete().eq("user_id", user.id).eq("chat_jid", chat);
    await supabase.from("wa_messages").delete().eq("user_id", user.id).eq("chat_jid", chat);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
