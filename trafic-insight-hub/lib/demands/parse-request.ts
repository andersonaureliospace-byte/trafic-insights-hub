// Etapa 68 (revisado): organiza o texto bruto da solicitação (uma ou mais
// mensagens de WhatsApp, já com áudio transcrito antes de chegar aqui — ver
// lib/ai/gemini.ts) numa demanda com título + itens.
//
// Separar pedidos misturados num texto corrido (sem Enter, sem lista — muito
// comum em transcrição de áudio) não dá pra fazer só com regra fixa de
// código: por isso quem decide ONDE um pedido termina e o outro começa é a
// IA (splitDemandTasks, em lib/ai/gemini.ts) — mas travada por prompt pra só
// separar, nunca reescrever/resumir/corrigir/inventar (pedido explícito:
// "não é pra adivinhar a tarefa"). Cada item sai com o texto exatamente como
// foi escrito ou falado.
//
// deterministicSplit (abaixo) é só uma rede de segurança: se a chamada à IA
// falhar (fora do ar, erro de rede, JSON inválido), a demanda ainda é criada
// — quebrando por linha/marcador de lista, sem IA nenhuma — em vez de perder
// a solicitação inteira.
import { splitDemandTasks } from "@/lib/ai/gemini";

const BULLET_RE = /^[-•*·▪◦]\s*|^\d+[.)]\s*/;

function stripBullet(line: string): string {
  return line.replace(BULLET_RE, "").trim();
}

export interface ParsedRequest {
  title: string;
  items: string[];
}

function deterministicSplit(text: string): ParsedRequest {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return { title: "", items: [] };
  if (lines.length === 1) {
    const only = stripBullet(lines[0]);
    return { title: only, items: [only] };
  }

  const first = lines[0];
  const isHeader = first.endsWith(":") && !BULLET_RE.test(first);
  if (isHeader) {
    const title = first.slice(0, -1).trim();
    const items = lines.slice(1).map(stripBullet).filter(Boolean);
    return { title: title || items[0] || "", items: items.length > 0 ? items : [title] };
  }

  const items = lines.map(stripBullet).filter(Boolean);
  return { title: items[0], items };
}

export async function parseRequestText(rawTexts: string[]): Promise<ParsedRequest> {
  const text = rawTexts.join("\n").trim();
  if (!text) return { title: "", items: [] };

  try {
    const { title, items: rawItems } = await splitDemandTasks(text);
    const items = rawItems.map((i) => i.trim()).filter(Boolean);
    if (items.length === 0) return deterministicSplit(text);
    return { title: (title ?? "").trim() || items[0], items };
  } catch {
    // IA fora do ar ou resposta inválida — não perde a solicitação, só cai
    // pro split determinístico (por linha/marcador de lista).
    return deterministicSplit(text);
  }
}
