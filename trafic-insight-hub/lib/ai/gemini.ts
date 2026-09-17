// Etapa 68: os dois únicos usos de IA em Demandas — (1) transcrever ÁUDIO
// recebido no grupo do WhatsApp e (2) separar uma mensagem (texto corrido ou
// já transcrito) em pedidos distintos, quando ela traz mais de uma
// solicitação misturada sem quebra de linha nem lista. As duas funções são
// travadas por prompt pra NUNCA interpretar, resumir, corrigir ou completar o
// que foi dito — pedido explícito do usuário ("a geração da tarefa não é pra
// adivinhar a tarefa"). splitDemandTasks só decide ONDE um pedido termina e o
// outro começa; o texto de cada item sai exatamente como foi escrito/falado.
// Gemini foi escolhido por ter camada gratuita e aceitar áudio direto.
const GEMINI_MODEL = "gemini-2.0-flash";

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
