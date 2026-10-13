import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { asanaConfigured } from "@/lib/asana/priority-sync";
import { sendDescriptionToAsana, syncDescriptionsFromAsana } from "@/lib/asana/descriptions";

// Etapa 115: aba "Descrição".
// GET   -> linhas já sincronizadas (uma por cliente) + se o Asana está configurado.
// PATCH -> salva o rascunho de um cliente ({ ad_account_id, draft }); draft = null descarta.
// POST  -> { action: "sync" } atualiza do Asana agora; { action: "send", ad_account_id, force? } envia
//          o rascunho do cliente pro Asana (substitui a descrição).
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("client_descriptions").select("*").eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ rows: data ?? [], configured: asanaConfigured() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as { ad_account_id?: string; draft?: string | null };
    const accountId = String(body.ad_account_id ?? "").trim();
    if (!accountId) throw new Error("ad_account_id é obrigatório.");
    const draft = body.draft == null ? null : String(body.draft);
    const { data: existing, error: findErr } = await supabase
      .from("client_descriptions")
      .select("ad_account_id")
      .eq("user_id", user.id)
      .eq("ad_account_id", accountId)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!existing) throw new Error("Clique em \"Atualizar do Asana\" antes de editar esse cliente.");
    const { error } = await supabase
      .from("client_descriptions")
      .update({ draft, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("ad_account_id", accountId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as { action?: string; ad_account_id?: string; force?: boolean };
    if (body.action === "sync") {
      const summary = await syncDescriptionsFromAsana(supabase, user.id);
      return NextResponse.json({ summary });
    }
    if (body.action === "send") {
      const accountId = String(body.ad_account_id ?? "").trim();
      if (!accountId) throw new Error("ad_account_id é obrigatório.");
      const result = await sendDescriptionToAsana(supabase, user.id, accountId, { force: Boolean(body.force) });
      return NextResponse.json(result);
    }
    throw new Error("action inválida.");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
