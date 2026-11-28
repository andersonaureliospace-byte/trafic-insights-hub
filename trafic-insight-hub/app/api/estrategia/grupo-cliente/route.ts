import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

// Etapa 359: trocar o grupo de WhatsApp de um cliente pela ficha (o painel lateral de WhatsApp, onde isso era feito, saiu).
// { accountId, group: { id, name } | null } → tira a conta de qualquer grupo em que ela estava e liga no grupo escolhido
// (é esse grupo que a Rotina da manhã, os feedbacks, o gravador e os disparos usam). null = deixa sem grupo.
const norm = (id: string) => String(id ?? "").replace(/^act_/, "").trim();

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { accountId?: string; group?: { id?: string; name?: string } | null };
    const acc = norm(body.accountId ?? "");
    if (!acc) throw new Error("Conta não informada.");
    const g = body.group && typeof body.group.id === "string" && body.group.id.endsWith("@g.us") ? { id: body.group.id, name: String(body.group.name ?? "").slice(0, 200) } : null;
    if (body.group && !g) throw new Error("Grupo inválido.");

    // 1) tira a conta de todos os grupos em que ela aparecia
    const { data: chats, error } = await supabase.from("wa_mirror_chats").select("chat_jid, ad_account_ids").eq("user_id", user.id);
    if (error) throw error;
    for (const c of chats ?? []) {
      const ids = ((c.ad_account_ids as string[] | null) ?? []).filter((a) => norm(a) !== acc);
      if (ids.length !== ((c.ad_account_ids as string[] | null) ?? []).length) {
        await supabase.from("wa_mirror_chats").update({ ad_account_ids: ids }).eq("user_id", user.id).eq("chat_jid", c.chat_jid as string);
      }
    }
    // 2) liga no grupo escolhido (mantém as outras contas que já estavam nele)
    if (g) {
      const atual = (chats ?? []).find((c) => c.chat_jid === g.id);
      const ids = [...new Set([...(((atual?.ad_account_ids as string[] | null) ?? []).filter((a) => norm(a) !== acc)), acc])];
      const { error: upErr } = await supabase
        .from("wa_mirror_chats")
        .upsert({ user_id: user.id, chat_jid: g.id, name: g.name, ad_account_ids: ids, ...(atual ? {} : { last_read_at: new Date().toISOString() }) }, { onConflict: "user_id,chat_jid" });
      if (upErr) throw upErr;
    }
    // 3) a ficha também guarda o grupo (usado quando a conta não está em nenhum grupo da lista)
    await supabase
      .from("account_bindings")
      .update({ wa_group_id: g?.id ?? null, wa_group_name: g?.name ?? null, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .in("ad_account_id", [acc, `act_${acc}`]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
