import { NextResponse } from "next/server";
import { gravadorAuth } from "@/lib/feedbacks/gravador-auth";

// Etapa 249: lista de clientes pro "Enviar para" da extensão (só os não arquivados), já dizendo quem tem grupo.
export async function GET(request: Request) {
  const auth = await gravadorAuth(request);
  if ("error" in auth) return auth.error;
  const { supabase, userId } = auth;
  try {
    const [{ data: bindings, error }, { data: chats }] = await Promise.all([
      supabase.from("account_bindings").select("ad_account_id, client_name, archived, wa_group_id, wa_group_name").eq("user_id", userId),
      supabase.from("wa_mirror_chats").select("chat_jid, name, ad_account_ids").eq("user_id", userId),
    ]);
    if (error) throw error;
    const norm = (s: string) => String(s ?? "").replace(/^act_/, "");
    const groupByAcc = new Map<string, string>();
    for (const c of (chats ?? []) as Array<{ name: string | null; chat_jid: string; ad_account_ids: string[] | null }>) {
      for (const a of c.ad_account_ids ?? []) groupByAcc.set(norm(a), c.name || c.chat_jid);
    }
    const clientes = ((bindings ?? []) as Array<{ ad_account_id: string; client_name: string | null; archived: boolean | null; wa_group_id: string | null; wa_group_name: string | null }>)
      .filter((b) => !b.archived)
      .map((b) => {
        const id = norm(b.ad_account_id);
        const grupo = groupByAcc.get(id) ?? (b.wa_group_id ? b.wa_group_name || b.wa_group_id : null);
        return { id, nome: (b.client_name ?? "").trim() || id, grupo };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return NextResponse.json({ clientes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
