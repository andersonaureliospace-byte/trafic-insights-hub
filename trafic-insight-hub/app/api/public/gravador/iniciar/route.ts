import { NextResponse } from "next/server";
import { gravadorAuth } from "@/lib/feedbacks/gravador-auth";
import { FEEDBACK_BUCKET, resolveClientGroup } from "@/lib/feedbacks/core";

// Etapa 249: a extensão terminou de gravar. Cria o feedback e devolve URLs assinadas pra ela subir o vídeo e o áudio
// DIRETO pro Storage do Supabase (não passa pela Vercel, que só aceita 4,5 MB por requisição).
const LIMIT = 50 * 1024 * 1024;
const extOf = (mime: string, audio: boolean) => (mime.includes("mp4") ? (audio ? "m4a" : "mp4") : "webm");

export async function POST(request: Request) {
  const auth = await gravadorAuth(request);
  if ("error" in auth) return auth.error;
  const { supabase, userId } = auth;
  try {
    const body = await request.json();
    const adAccountId = String(body.ad_account_id ?? "").replace(/^act_/, "").trim();
    const videoMime = String(body.video_mime ?? "video/mp4").split(";")[0];
    const audioMime = body.audio_mime ? String(body.audio_mime).split(";")[0] : null;
    const videoBytes = Number(body.video_bytes ?? 0);
    if (!adAccountId) throw new Error("Escolha o cliente.");
    if (videoBytes > LIMIT) {
      throw new Error(`O vídeo tem ${(videoBytes / 1048576).toFixed(0)} MB e o limite é 50 MB. Grave na qualidade "WhatsApp" ou em partes menores.`);
    }

    const { data: b } = await supabase
      .from("account_bindings")
      .select("client_name")
      .eq("user_id", userId)
      .in("ad_account_id", [adAccountId, `act_${adAccountId}`])
      .limit(1);
    const clientName = ((b?.[0]?.client_name as string | undefined) ?? "").trim() || adAccountId;
    const group = await resolveClientGroup(supabase, userId, adAccountId);

    const id = crypto.randomUUID();
    const videoPath = `${userId}/${id}/video.${extOf(videoMime, false)}`;
    const audioPath = audioMime ? `${userId}/${id}/audio.${extOf(audioMime, true)}` : null;

    const { error: insErr } = await supabase.from("client_feedbacks").insert({
      id,
      user_id: userId,
      ad_account_id: adAccountId,
      client_name: clientName,
      titulo: String(body.titulo ?? "").trim().slice(0, 200),
      status: "enviando",
      video_path: videoPath,
      video_mime: videoMime,
      video_bytes: videoBytes || null,
      audio_path: audioPath,
      audio_mime: audioMime,
      duracao_seg: body.duracao_seg != null ? Math.round(Number(body.duracao_seg)) : null,
      wa_group_id: group?.id ?? null,
      wa_group_name: group?.name ?? null,
    });
    if (insErr) {
      if (/client_feedbacks/.test(insErr.message)) throw new Error("Rode o SQL supabase/migrations/0043_client_feedbacks.sql no Supabase.");
      throw insErr;
    }

    const storage = supabase.storage.from(FEEDBACK_BUCKET);
    const v = await storage.createSignedUploadUrl(videoPath);
    if (v.error) throw new Error(`Storage: ${v.error.message}`);
    const a = audioPath ? await storage.createSignedUploadUrl(audioPath) : null;
    if (a?.error) throw new Error(`Storage: ${a.error.message}`);

    return NextResponse.json({
      id,
      cliente: clientName,
      grupo: group?.name ?? null,
      video_upload_url: v.data.signedUrl,
      audio_upload_url: a?.data?.signedUrl ?? null,
      // chave pública (anon) do Supabase — a mesma que já vai no navegador; o gateway pede ela no upload
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
