// Etapa 68: os dois primeiros usos de IA em Demandas — (1) transcrever ÁUDIO
// recebido no grupo do WhatsApp e (2) separar uma mensagem (texto corrido ou
// já transcrito) em pedidos distintos, quando ela traz mais de uma
// solicitação misturada sem quebra de linha nem lista. As duas funções são
// travadas por prompt pra NUNCA interpretar, resumir, corrigir ou completar o
// que foi dito — pedido explícito do usuário ("a geração da tarefa não é pra
// adivinhar a tarefa"). splitDemandTasks só decide ONDE um pedido termina e o
// outro começa; o texto de cada item sai exatamente como foi escrito/falado.
//
// Etapa 70: generateCopyVariations é DIFERENTE das duas de cima de propósito
// — aqui o pedido explícito do usuário foi o oposto ("vamos usar uma IA pra
// fazer as variações", com liberdade criativa de verdade). Ela escreve copy
// nova pro Gerador de Copy do Instituto Visão Solidária, usando os modelos
// reais da marca como referência de padrão (few-shot), não como texto fixo.
//
// Gemini foi escolhido nas três por ter camada gratuita e aceitar áudio
// direto.
//
// gemini-2.0-flash foi descontinuado pelo Google (erro 404 em produção,
// "model is no longer available") — trocado por gemini-3.6-flash (mesma
// camada gratuita, mesmo suporte a áudio e responseSchema), o modelo que a
// própria resposta de erro do Google indicou como substituto.
const GEMINI_MODEL = "gemini-3.6-flash";

const TRANSCRIBE_PROMPT =
  "Transcreva o áudio a seguir em português, palavra por palavra, exatamente como foi falado. " +
  "Não resuma, não corrija o sentido, não complete frases que a pessoa deixou incompletas, não adicione " +
  "nenhuma informação que não foi dita. Responda APENAS com a transcrição, sem comentários, sem aspas, " +
  "sem prefixo do tipo \"Transcrição:\".";

export async function transcribeAudio(mediaUrl: string, mimeType: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada no servidor.");

  const audioRes = await fetch(mediaUrl);
  if (!audioRes.ok) throw new Error(`Falha ao baixar o áudio da mensagem (HTTP ${audioRes.status}).`);
  const buf = Buffer.from(await audioRes.arrayBuffer());

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: TRANSCRIBE_PROMPT },
          { inlineData: { mimeType: mimeType || "audio/ogg", data: buf.toString("base64") } },
        ],
      },
    ],
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || !text.trim()) throw new Error("Gemini não retornou nenhuma transcrição pro áudio.");
  return text.trim();
}

const SPLIT_INSTRUCTIONS = `Você vai receber o texto de uma solicitação de tarefa mandada por WhatsApp (uma ou mais mensagens, já com qualquer áudio transcrito literalmente). Ela pode trazer UM único pedido ou VÁRIOS pedidos diferentes, com ou sem quebra de linha entre eles.

Sua ÚNICA função é separar os pedidos em itens. Regras obrigatórias, sem exceção:
- Cada item do array "items" tem que ser um trecho EXATO do texto original — mesmas palavras, mesma ordem — só removendo marcador de lista (traço, "•", número) do início da linha quando existir.
- NUNCA reescreva, resuma, corrija erro de português, complete frase incompleta ou invente qualquer informação que não esteja literalmente no texto.
- Se o texto tiver uma linha curta de cabeçalho terminando em ":" (ex.: "Plano de ação:") descrevendo o conjunto todo, coloque ela em "title" (sem os dois-pontos) e não repita como item; senão "title" é null.
- Se só houver um pedido (mesmo que a frase seja longa), devolva um array com esse único item, sem cortar nem dividir sem necessidade, e "title" null.

Responda SOMENTE com JSON válido, neste formato exato:
{"title": "string ou null", "items": ["item 1", "item 2"]}`;

export interface SplitResult {
  title: string | null;
  items: string[];
}

export async function splitDemandTasks(text: string): Promise<SplitResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada no servidor.");

  const prompt = `${SPLIT_INSTRUCTIONS}\n\nTexto:\n"""\n${text}\n"""`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING", nullable: true },
          items: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["items"],
      },
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw || !raw.trim()) throw new Error("Gemini não retornou nenhum resultado pro split da demanda.");

  const parsed = JSON.parse(raw) as { title?: string | null; items?: unknown };
  const items = Array.isArray(parsed.items) ? parsed.items.map((i) => String(i)) : [];
  return { title: parsed.title ?? null, items };
}

// Etapa 70 — Gerador de Copy (Instituto Visão Solidária).
export interface CopyReferenceModelInput {
  endereco_exemplo: string;
  copy: string;
  oferta: string;
  cta: string;
  condicao: string;
}

export interface CopyVariationResult {
  copy: string;
  oferta: string;
  cta: string;
}

// Etapa 70 (ajuste): "condicao" saiu do que a IA gera — agora é fixada na
// subcategoria (ou o texto padrão) e só é anexada depois, em
// app/api/copy/generate/route.ts. O schema/prompt aqui só cobrem copy/oferta/
// cta.
const COPY_STRUCTURE_GUIDE = `Você escreve copy de anúncio do Meta Ads (Feed/Stories/Reels) para o Instituto Visão Solidária (IVS), uma franquia de óticas com centenas de unidades — a comunicação segue sempre a mesma linha entre unidades, só muda o endereço e o mecanismo da oferta.

Cada variação tem 3 partes (o endereço da loja e a condição/letra miúda são fixos e NÃO fazem parte do que você escreve — já vêm prontos):

- "copy": o texto criativo completo, em parágrafos curtos separados por linha em branco, nesta ordem: (1) um gancho/headline chamando atenção — pode citar a cidade/região, uma pergunta, um alerta de urgência ou um gatilho mental (concorrência, tempo, economia, política, etc), sempre respeitando o TOM DE COMUNICAÇÃO indicado abaixo; (2) um parágrafo explicando a oferta com o mecanismo exato (nunca invente valor ou mecanismo diferente do informado); (3) opcionalmente uma linha curta de reforço/diferencial; (4) a tagline fixa da marca, sempre parecida com "BARATO QUE ÓTICA? SÓ AQUI NO INSTITUTO VISÃO SOLIDÁRIA 😍" (pode variar levemente o texto antes do nome da marca, mas mantenha o sentido e o emoji 😍 no final). Use emojis nas posições certas: gancho costuma abrir com 🔵/🚨, o parágrafo da oferta com 👓, o reforço com ✨/💰/🚀/💎/💡 — EXCETO no tom "neutro" (veja abaixo).
- "oferta": uma frase curta (sem emoji) resumindo o mecanismo exato da promoção — deve refletir fielmente o valor/mecanismo informado, nunca inventado.
- "cta": uma frase curta convidando a falar no WhatsApp, abrindo com um emoji de celular/mão/balão (📲/👉/💬) — EXCETO no tom "neutro" (veja abaixo).

TOM DE COMUNICAÇÃO desta geração: {{TOM}}
{{TOM_GUIDANCE}}

Gere exatamente {{COUNT}} variação(ões), todas fiéis a esse padrão, mas com ganchos e textos diferentes entre si (não repita a mesma frase em variações diferentes).`;

function tomGuidance(tom: string): string {
  if (tom.toLowerCase() === "neutro") {
    return (
      'Instrução especial pro tom "neutro": escreva de forma direta e informativa, SEM nenhum gatilho mental ' +
      "(nada de urgência, escassez, comparação com concorrência, política, etc), sem emojis de ênfase " +
      "(🔵🚨✨💰🚀💎💡) e sem exagero ou apelo emocional — só descreva a oferta e a marca com clareza. " +
      "Pode manter a tagline da marca e um emoji simples no CTA (📲/👉/💬), mas o restante do texto deve soar " +
      "sóbrio, como um comunicado, não uma propaganda agressiva."
    );
  }
  return `Escreva seguindo esse tom pedido ("${tom}") em todo o texto — no gancho, no reforço e no CTA — sem perder a estrutura descrita acima.`;
}

export async function generateCopyVariations(params: {
  categoryLabel: string;
  subcategoryName: string;
  address: string;
  clientName: string | null;
  offerText: string;
  tom: string;
  extraFields: { label: string; value: string }[];
  referenceModels: CopyReferenceModelInput[];
  count?: number;
}): Promise<CopyVariationResult[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada no servidor.");
  const count = params.count && params.count > 0 ? params.count : 5;
  const tom = params.tom.trim() || "neutro";

  const examplesBlock = params.referenceModels.length
    ? params.referenceModels
        .map(
          (m, i) =>
            `Exemplo real ${i + 1} (endereço de exemplo: ${m.endereco_exemplo || "—"}):\n` +
            `copy: """${m.copy}"""\noferta: """${m.oferta}"""\ncta: """${m.cta}"""\ncondicao: """${m.condicao}"""`,
        )
        .join("\n\n")
    : "(nenhum modelo de referência cadastrado ainda pra essa subcategoria — siga só a estrutura descrita acima.)";

  const extraFieldsBlock = params.extraFields.length
    ? params.extraFields.map((f) => `- ${f.label}: ${f.value}`).join("\n")
    : "(nenhum)";

  const prompt = `${COPY_STRUCTURE_GUIDE.replace("{{COUNT}}", String(count)).replace("{{TOM}}", tom).replace("{{TOM_GUIDANCE}}", tomGuidance(tom))}

Categoria: ${params.categoryLabel}
Subcategoria: ${params.subcategoryName}
Endereço real da unidade (use exatamente este texto se precisar citar a cidade/região no gancho — não repita o endereço completo dentro do "copy", ele já aparece separado na tela): ${params.address || "—"}
${params.clientName ? `Nome do cliente/unidade: ${params.clientName}\n` : ""}Oferta desta geração (use este mecanismo exato, não invente outro): ${params.offerText || "(use o mecanismo mostrado nos exemplos de referência abaixo)"}
Campos extras informados:
${extraFieldsBlock}

Modelos de referência da marca (few-shot — use como padrão de estrutura, nunca copie literalmente; note que o "condicao" dos exemplos é só referência de padrão, você não gera esse campo):
${examplesBlock}

Responda SOMENTE com um JSON array de ${count} objeto(s), neste formato exato: [{"copy": "...", "oferta": "...", "cta": "..."}]`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            copy: { type: "STRING" },
            oferta: { type: "STRING" },
            cta: { type: "STRING" },
          },
          required: ["copy", "oferta", "cta"],
        },
      },
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw || !raw.trim()) throw new Error("Gemini não retornou nenhuma variação de copy.");

  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Gemini não retornou variações no formato esperado.");
  }
  return parsed.map((v) => {
    const item = v as Record<string, unknown>;
    return {
      copy: String(item.copy ?? ""),
      oferta: String(item.oferta ?? ""),
      cta: String(item.cta ?? ""),
    };
  });
}
