import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createServiceClient } from "@/lib/supabase/server";
import { FEEDBACK_BUCKET, FEEDBACK_COLUMNS, publicUrl, type FeedbackRow } from "@/lib/feedbacks/core";

// Etapa 249: Clientes → Feedbacks.
//   GET    → lista (mais novos primeiro), com a URL do vídeo pra tocar na revisão
//   PATCH  → { id, resumo?, titulo?, wa_group_id?, wa_group_name? } edita antes de enviar
//   DELETE → { id } apaga o feedback e os arquivos dele no Storage (libera espaço)
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("client_feedbacks")
      .select(FEEDBACK_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) {
      if (/client_feedbacks/.test(error.message)) throw new Error("Rode o SQL supabase/migrations/0043_client_feedbacks.sql no Supabase.");
      throw error;
    }
    const feedbacks = ((data ?? []) as FeedbackRow[]).map((r) => ({ ...r, video_url: publicUrl(supabase, r.video_path) }));
    return NextResponse.json({ feedbacks });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as Record<string, unknown>;
    const id = String(body.id ?? "");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.resumo === "string") patch.resumo = body.resumo.slice(0, 4000);
    if (typeof body.titulo === "string") patch.titulo = body.titulo.trim().slice(0, 200);
    if ("wa_group_id" in body) {
      patch.wa_group_id = body.wa_group_id ? String(body.wa_group_id) : null;
      patch.wa_group_name = body.wa_group_name ? String(body.wa_group_name) : null;
    }
    const { error } = await supabase.from("client_feedbacks").update(patch).eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const { id } = (await request.json()) as { id?: string };
    const { data } = await supabase.from("client_feedbacks").select("video_path, audio_path").eq("id", String(id)).eq("user_id", user.id).maybeSingle();
    if (!data) throw new Error("Feedback não encontrado.");
    const paths = [data.video_path, data.audio_path].filter(Boolean) as string[];
    if (paths.length) await createServiceClient().storage.from(FEEDBACK_BUCKET).remove(paths);
    const { error } = await supabase.from("client_feedbacks").delete().eq("id", String(id)).eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
