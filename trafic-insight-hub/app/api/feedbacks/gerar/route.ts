import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { gerarFeedbackIA } from "@/lib/feedbacks/gerar";

// Etapa 330: feedback automático pelos números (sem print) + plano de ação objetivo.
//   POST { ad_account_id, dias: 2|3|7, pontos?, hoje?: { spend, results } } → { feedback, plano, resumoDados }
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
    const r = await gerarFeedbackIA(supabase, user.id, {
      adAccountId,
      dias,
      pontos: String(body.pontos ?? "").slice(0, 4000),
      hoje,
      token,
    });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
