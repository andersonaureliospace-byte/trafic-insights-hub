import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { llmJson } from "@/lib/ai/llm";
import { espacar } from "@/lib/feedbacks/gerar";

// Etapa 352: "Melhorar meu texto" — a IA NÃO escreve um feedback novo: ela revisa o texto que você escreveu.
//   POST { texto } → { texto }
export const maxDuration = 60;

const SYSTEM = `Você revisa uma mensagem que um estrategista de tráfego pago escreveu pro grupo de WhatsApp do cliente (dono de loja).
NÃO escreva uma mensagem nova: melhore a DELE, mantendo o que ele quis dizer, os fatos, a ordem das ideias e o jeito dele de falar.

O que fazer:
- Corrigir todos os erros de português (ortografia, acentos, concordância, pontuação, palavras digitadas errado).
- Deixar a comunicação mais clara e fluida, com frases curtas.
- Deixar o tom mais simpático, humano e empático, menos rude e menos analítico/técnico. Trocar termos técnicos (CPA, CPL, lead,
  criativo, conjunto, campanha, métricas) por palavras simples ("pessoas chamando no WhatsApp", "conversas", "anúncio", "vídeo").
- Quando houver notícia ruim, use a técnica do sanduíche: comece com algo positivo ou acolhedor, dê a notícia com cuidado e mostre o que
  está sendo feito, e feche com algo positivo e de compromisso. Se a mensagem já for boa notícia, só deixe mais calorosa.
- Não invente números, fatos nem promessas que ele não escreveu. Pode completar uma frase que ficou cortada só se o sentido for óbvio.
- Mantenha mais ou menos o mesmo tamanho (pode ficar um pouco maior por causa do sanduíche). No máximo 1 emoji, só se combinar.
- Formatação: blocos curtos separados por UMA linha em branco ("\\n\\n" no JSON). Sem títulos, listas ou negrito.

Responda SOMENTE em JSON: {"texto": "..."}`;

export async function POST(request: Request) {
  try {
    await requireUser();
    const body = (await request.json().catch(() => ({}))) as { texto?: unknown };
    const texto = String(body.texto ?? "").trim().slice(0, 4000);
    if (!texto) throw new Error("Escreva a mensagem primeiro.");
    const r = await llmJson<{ texto?: string }>(SYSTEM, `Mensagem do estrategista:\n"""${texto}"""`, { temperature: 0.4, maxTokens: 1500 });
    const out = espacar(String(r.texto ?? ""));
    if (!out) throw new Error("A IA não devolveu o texto. Tente de novo.");
    return NextResponse.json({ texto: out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
