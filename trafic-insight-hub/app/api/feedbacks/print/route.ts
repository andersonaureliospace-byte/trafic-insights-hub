import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createServiceClient } from "@/lib/supabase/server";
import { FEEDBACK_BUCKET, processFeedback, resolveClientGroup } from "@/lib/feedbacks/core";

// Etapa 271: Feedback por print.
//   POST { action: "upload", kind: "print"|"audio", mime, bytes, name } → URL assinada (sobe direto pro Storage)
//   POST { action: "criar", ad_account_id, prints:[{path,mime}], pontos, audio?:{path,mime}, titulo? }
//        → cria o feedback, a IA escreve a mensagem (leva uns segundos) e devolve o id já "Aguardando revisão".
//   POST { action: "pontos", id, pontos } → troca os pontos de atenção (antes de gerar de novo)
export const maxDuration = 60;

const LIMIT = 20 * 1024 * 1024;
const normId = (id: string) => String(id ?? "").replace(/^act_/, "").trim();

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as Record<string, unknown>;

    if (body.action === "upload") {
      const bytes = Number(body.bytes ?? 0);
      if (bytes > LIMIT) throw new Error("Arquivo grande demais (máx. 20 MB).");
      const kind = body.kind === "audio" ? "audio" : "print";
      const name = String(body.name ?? "");
      const ext = (name.includes(".") ? name.split(".").pop()! : kind === "audio" ? "webm" : "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "bin";
      const path = `${user.id}/prints/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${kind}.${ext}`;
      const storage = createServiceClient().storage.from(FEEDBACK_BUCKET);
      const signed = await storage.createSignedUploadUrl(path);
      if (signed.error) throw new Error(`Storage: ${signed.error.message}`);
      return NextResponse.json({
        upload_url: signed.data.signedUrl,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
        path,
        url: storage.getPublicUrl(path).data.publicUrl,
      });
    }

    if (body.action === "criar") {
      const adAccountId = normId(String(body.ad_account_id ?? ""));
      if (!adAccountId) throw new Error("Escolha o cliente.");
      const own = (p: string) => p.startsWith(`${user.id}/prints/`);
      const prints = ((Array.isArray(body.prints) ? body.prints : []) as Array<{ path?: string; mime?: string }>)
        .map((p) => ({ path: String(p.path ?? ""), mime: String(p.mime ?? "image/png").split(";")[0] }))
        .filter((p) => own(p.path))
        .slice(0, 8);
      if (prints.length === 0) throw new Error("Anexe pelo menos um print do resultado.");
      const audio = body.audio as { path?: string; mime?: string } | null | undefined;
      const audioPath = audio?.path && own(String(audio.path)) ? String(audio.path) : null;

      const { data: b } = await supabase
        .from("account_bindings")
        .select("client_name")
        .eq("user_id", user.id)
        .in("ad_account_id", [adAccountId, `act_${adAccountId}`])
        .limit(1);
      const clientName = ((b?.[0]?.client_name as string | undefined) ?? "").trim() || adAccountId;
      const group = await resolveClientGroup(supabase, user.id, adAccountId);
      const id = crypto.randomUUID();
      // Etapa 298: semIa → o texto é o que você escreveu nos pontos de atenção (vai direto pra revisão, sem a IA)
      const semIa = body.semIa === true;
      const pontosTxt = String(body.pontos ?? "").slice(0, 4000);
      const { error } = await supabase.from("client_feedbacks").insert({
        id,
        user_id: user.id,
        ad_account_id: adAccountId,
        client_name: clientName,
        titulo: String(body.titulo ?? "").trim().slice(0, 200) || "Feedback de resultado",
        status: semIa ? "revisao" : "processando",
        ...(semIa ? { resumo: pontosTxt } : {}),
        tipo: "print",
        prints,
        pontos: pontosTxt,
        audio_path: audioPath,
        audio_mime: audioPath ? String(audio?.mime ?? "audio/webm").split(";")[0] : null,
        wa_group_id: group?.id ?? null,
        wa_group_name: group?.name ?? null,
      });
      if (error) {
        if (/tipo|prints|pontos/.test(error.message)) throw new Error("Rode o SQL supabase/migrations/0046_feedback_prints.sql no Supabase.");
        throw error;
      }
      if (!semIa) await processFeedback(supabase, id);
      return NextResponse.json({ ok: true, id });
    }

    if (body.action === "pontos") {
      const { error } = await supabase
        .from("client_feedbacks")
        .update({ pontos: String(body.pontos ?? "").slice(0, 4000), updated_at: new Date().toISOString() })
        .eq("id", String(body.id ?? ""))
        .eq("user_id", user.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    throw new Error("Ação desconhecida.");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
