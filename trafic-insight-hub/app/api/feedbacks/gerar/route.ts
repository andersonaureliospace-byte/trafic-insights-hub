import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { gerarFeedbackIA } from "@/lib/feedbacks/gerar";
import { transcrever } from "@/lib/ai/llm";
import { publicUrl } from "@/lib/feedbacks/core";

// Etapa 330: feedback automático pelos números (sem print) + plano de ação objetivo.
//   POST { ad_account_id, dias: 2|3|7, pontos?, personalizacao?, prints?: [{path, mime}], audio?: {path, mime}, hoje?: { spend, results } }
//        → { feedback, plano, resumoDados, transcricao? }
// Etapa 334: lê até 2 prints (Groq grátis: cada imagem pesa no limite por minuto) e transcreve o áudio dos pontos.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as Record<string, unknown>;
    const adAccountId = String(body.ad_account_id ?? "").replace(/^act_/, "").trim();
    if (!adAccountId) throw new Error("Escolha o cliente.");
    const d = Number(body.dias);
    const dias = (d === 2 || d === 3 || d === 7 ? d : 3) as 2 | 3 | 7;
    const h = body.hoje as { spend?: unknown; results?: unknown } | null | undefined;
    const hoje = h && Number.isFinite(Number(h.results)) ? { spend: Number(h.spend) || 0, results: Number(h.results) || 0 } : null;
    let token: string | null = null;
    try {
      token = await getUserMetaToken(supabase, user.id);
    } catch {
      token = null; // sem a Meta: só não verifica se já otimizou hoje
    }
    const own = (p: string) => p.startsWith(`${user.id}/prints/`);
    const prints: string[] = [];
    for (const p of ((Array.isArray(body.prints) ? body.prints : []) as Array<{ path?: string; mime?: string }>).slice(0, 2)) {
      const path = String(p.path ?? "");
      if (!own(path)) continue;
      const res = await fetch(publicUrl(supabase, path) as string);
      if (!res.ok) continue;
      const mime = String(p.mime ?? "image/png").split(";")[0];
      prints.push(`data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`);
    }
    let pontos = String(body.pontos ?? "").slice(0, 4000);
    let transcricao: string | null = null;
    const audio = body.audio as { path?: string; mime?: string } | null | undefined;
    if (audio?.path && own(String(audio.path))) {
      try {
        transcricao = await transcrever(publicUrl(supabase, String(audio.path)) as string, String(audio.mime ?? "audio/webm").split(";")[0]);
        if (transcricao) pontos = [pontos, `(falado) ${transcricao}`].filter(Boolean).join("\n");
      } catch (e) {
        transcricao = null;
        console.error("transcrever err", (e as Error).message);
      }
    }
    const r = await gerarFeedbackIA(supabase, user.id, {
      adAccountId,
      dias,
      pontos,
      personalizacao: String(body.personalizacao ?? "").slice(0, 1000),
      prints,
      hoje,
      token,
    });
    return NextResponse.json({ ...r, transcricao });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
