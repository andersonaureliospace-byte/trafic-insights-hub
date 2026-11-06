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

// Ajuste: o Gemini grátis de vez em quando devolve 503 "model is currently
// experiencing high demand" (sobrecarga temporária do lado do Google, não um
// erro nosso) — antes isso quebrava a geração na hora. Agora tenta de novo
// automaticamente (com uma pequena espera crescente) antes de desistir, nas
// três funções que chamam o Gemini.
const RETRYABLE_STATUSES = new Set([503, 429]);
const MAX_ATTEMPTS = 3;

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

async function callGemini(apiKey: string, body: unknown): Promise<GeminiResponse> {
  let lastError: Error = new Error("Gemini: falha desconhecida.");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    if (res.ok) return (await res.json()) as GeminiResponse;

    const statusText = await res.text();
    const retryable = RETRYABLE_STATUSES.has(res.status);
    lastError = retryable
      ? new Error("O Gemini está sobrecarregado no momento (alta demanda no plano gratuito) — tentamos de novo automaticamente sem sucesso. Espere um pouco e tente gerar de novo.")
      : new Error(`Gemini ${res.status}: ${statusText}`);
    if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt)); // 1s, depois 2s
  }
  throw lastError;
}

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

  const json = await callGemini(apiKey, body);
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

  const json = await callGemini(apiKey, body);
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

  const json = await callGemini(apiKey, body);
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

// Etapa 249 — Clientes → Feedbacks. Transcreve o vídeo gravado pela extensão e escreve o PLANO DE AÇÃO (simples e direto)
// que vai pro grupo do cliente numa mensagem de texto separada, logo depois do vídeo. O resumo fica SEMPRE em revisão antes de sair (você confere e
// edita no Hub), mas mesmo assim o prompt trava a IA no que foi dito: nada de inventar número, prazo ou promessa.
// Primeiro tenta com o áudio pequeno (mandado direto, rápido). Se o Gemini recusar o formato do áudio, cai pro próprio
// vídeo pela File API do Google (aceita arquivo grande e o formato mp4 com certeza).
const FEEDBACK_PROMPT = (titulo: string, cliente: string) => `Você vai receber a gravação de tela narrada por um gestor de tráfego pago explicando algo para o cliente "${cliente}"${titulo ? ` (título: "${titulo}")` : ""}.

Faça duas coisas e responda SOMENTE em JSON:
1. "transcricao": transcreva em português tudo o que foi falado, fiel ao áudio. Não resuma, não corrija o sentido, não invente.
2. "resumo": escreva o PLANO DE AÇÃO que vai por mensagem de texto para o grupo do cliente, logo depois do vídeo.
   Regras do plano de ação:
   - Português do Brasil, simples e direto, como o próprio gestor escrevendo no WhatsApp.
   - Primeira linha: "*Plano de ação* 📋".
   - Depois, de 3 a 6 itens numerados ("1. ", "2. "…), um por linha, cada um com UMA ação curta e prática, começando por
     um verbo (ex.: "Pausar o criativo X", "Enviar fotos novas da loja até sexta"). Se foi dito quem faz, diga
     ("Cliente:" / "Nós:"). Sem explicação longa, sem introdução, sem despedida.
   - Use SOMENTE o que foi dito na gravação. Nunca invente ações, números, resultados, prazos ou promessas.
   - Pode usar *negrito* do WhatsApp com moderação. Sem títulos com #, sem tabela.
   - Se a gravação não tiver fala ou nenhuma ação, devolva "resumo" vazio (e "transcricao" vazia se não houver fala).`;

const FEEDBACK_SCHEMA = {
  responseMimeType: "application/json",
  responseSchema: {
    type: "OBJECT",
    properties: { transcricao: { type: "STRING" }, resumo: { type: "STRING" } },
    required: ["transcricao", "resumo"],
  },
};

export interface FeedbackSummary {
  transcricao: string;
  resumo: string;
}

function parseFeedback(json: GeminiResponse): FeedbackSummary {
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw || !raw.trim()) throw new Error("Gemini não retornou nada pra essa gravação.");
  const p = JSON.parse(raw) as Partial<FeedbackSummary>;
  return { transcricao: String(p.transcricao ?? "").trim(), resumo: String(p.resumo ?? "").trim() };
}

// File API do Gemini (upload resumable) — pra arquivos maiores que o envio direto aceita.
async function uploadToGeminiFiles(apiKey: string, url: string, mime: string): Promise<{ uri: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar o vídeo do Storage (HTTP ${res.status}).`);
  const bytes = Buffer.from(await res.arrayBuffer());

  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "feedback" } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new Error(`Gemini (upload) ${start.status}: ${await start.text()}`);

  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Length": String(bytes.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: bytes,
  });
  if (!up.ok) throw new Error(`Gemini (upload) ${up.status}: ${await up.text()}`);
  let file = ((await up.json()) as { file?: { name: string; uri: string; mimeType: string; state?: string } }).file;
  if (!file) throw new Error("Gemini não devolveu o arquivo enviado.");

  // Vídeo passa por processamento antes de poder ser usado (estado PROCESSING → ACTIVE).
  for (let i = 0; i < 20 && file.state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${apiKey}`);
    if (st.ok) file = (await st.json()) as typeof file;
  }
  if (file.state === "FAILED") throw new Error("O Gemini não conseguiu processar o vídeo.");
  return { uri: file.uri, mimeType: file.mimeType || mime };
}

export async function summarizeFeedback(params: {
  audio: { url: string; mime: string } | null;
  video: { url: string; mime: string } | null;
  titulo: string;
  cliente: string;
}): Promise<FeedbackSummary> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada no servidor.");
  const prompt = FEEDBACK_PROMPT(params.titulo, params.cliente);

  let audioError: Error | null = null;
  if (params.audio) {
    try {
      const res = await fetch(params.audio.url);
      if (!res.ok) throw new Error(`Falha ao baixar o áudio (HTTP ${res.status}).`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 15 * 1024 * 1024) {
        const json = await callGemini(apiKey, {
          contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: params.audio.mime.split(";")[0], data: buf.toString("base64") } }] }],
          generationConfig: FEEDBACK_SCHEMA,
        });
        return parseFeedback(json);
      }
    } catch (e) {
      audioError = e as Error;
      if (/sobrecarregado/.test(audioError.message)) throw audioError; // vídeo também ia falhar agora
    }
  }

  if (!params.video) throw audioError ?? new Error("Essa gravação não tem áudio pra transcrever.");
  const file = await uploadToGeminiFiles(apiKey, params.video.url, params.video.mime.split(";")[0]);
  const json = await callGemini(apiKey, {
    contents: [{ role: "user", parts: [{ text: prompt }, { fileData: { mimeType: file.mimeType, fileUri: file.uri } }] }],
    generationConfig: FEEDBACK_SCHEMA,
  });
  return parseFeedback(json);
}


// ---------- Etapa 271: Feedback por print ----------
// Prints do resultado (Meta/Gerenciador) + pontos de atenção do estrategista (escritos e/ou num áudio) → a mensagem de
// feedback pro grupo do cliente no WhatsApp.

// Exemplos reais do Anderson (06/11/2026) — o tom padrão. O campo "Meu jeito de escrever" (prefs feedback_modelos) soma mais.
const PRINT_FEEDBACK_EXEMPLOS = `Exemplo 1:
Bom dia turma.

Nessa semana, tivemos 40 leads a um custo de R$ 7,80
Exame é promoção desse mês, teve um bom desempenho.
Os videos que enviamos ontem, também começou a perfomar.
Agora vamos ir atrás de reduzir esse custo.

Caso a promoção do 200 reais de desconto, não melhore, já iniciamos a de presentes. Estamos acompanhando aqui de perto.

Exemplo 2:
A promoção atual, não teve um bom desempenho, o custo por lead está bem alto.

Estamos subindo os últimos testes, com esses videos. Caso não vingue, vamos já partir para os videos de presentes, que era para 2ª quinzena.

Exemplo 3:
Subimos novos testes, de multifocal e videos gerais, já deu uma respirada.
Falei para a Ana reativar boleto, tinha caido o desempenho no final de semana.
E estou enviando novos videos para a gente utilizar também.`;

const PRINT_FEEDBACK_PROMPT = (cliente: string, pontos: string, temAudio: boolean, modelos: string, metas: string) =>
  `Você é o gestor de tráfego escrevendo o feedback de resultados pro grupo de WhatsApp do cliente "${cliente}". ` +
  `O texto vai como legenda do print do resultado.\n\n` +
  (metas ? `Metas do cliente (pra você comparar com o print; não precisa citar se não ajudar): ${metas}.\n\n` : "") +
  `Material:\n- Print(s) do resultado da campanha (anexos de imagem). Leia os números direto dos prints.\n` +
  (pontos.trim() ? `- Pontos de atenção que o gestor quer passar (escritos):\n"""${pontos.trim()}"""\n` : "") +
  (temAudio ? `- Um áudio do gestor falando os pontos de atenção (anexo). Transcreva e use.\n` : "") +
  `\nESCREVA EXATAMENTE NO JEITO DO GESTOR, como nestes feedbacks reais dele (copie o estilo, não o conteúdo):\n` +
  `"""\n${PRINT_FEEDBACK_EXEMPLOS}\n` +
  (modelos.trim() ? `\nMais exemplos dele:\n${modelos.trim().slice(0, 6000)}\n` : "") +
  `"""\n\nRegras:\n` +
  `- Curto: de 2 a 6 linhas, no máximo uns 500 caracteres. Frases simples, de conversa, como ele fala.\n` +
  `- Pode começar com uma saudação curta do jeito dele ("Bom dia turma.", "Boa tarde pessoal.") — conforme o caso.\n` +
  `- Traga o número principal do print (ex.: quantos leads/conversas e o custo por lead, em R$ com vírgula).\n` +
  `- Diga o que foi bem ou mal e o que vamos fazer agora, usando os pontos de atenção do gestor. Se tiver plano B, diga ` +
  `("Caso não melhore, ...").\n` +
  `- SEM títulos, SEM negrito, SEM listas/tópicos, SEM emojis, SEM despedida formal, SEM jargão (nada de CTR, CPM, ROAS).\n` +
  `- NUNCA invente número nem ação: só o que dá pra ler nos prints e o que o gestor disse.\n\n` +
  `Responda em JSON: {"transcricao": "<transcrição do áudio, ou vazio se não tiver áudio>", "resumo": "<a mensagem pronta>"}.`;

async function fetchInline(url: string, mime: string): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar um anexo do Storage (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { inlineData: { mimeType: mime.split(";")[0], data: buf.toString("base64") } };
}

export async function writePrintFeedback(params: {
  cliente: string;
  pontos: string;
  prints: Array<{ url: string; mime: string }>;
  audio: { url: string; mime: string } | null;
  modelos?: string;
  cpaMeta?: number | null;
  investMeta?: number | null;
}): Promise<FeedbackSummary> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada no servidor.");
  if (params.prints.length === 0) throw new Error("Anexe pelo menos um print do resultado.");
  const parts: unknown[] = [{ text: PRINT_FEEDBACK_PROMPT(
      params.cliente,
      params.pontos,
      !!params.audio,
      params.modelos ?? "",
      [
        params.cpaMeta != null ? `CPA ideal (custo por lead/conversa) R$ ${params.cpaMeta.toFixed(2).replace(".", ",")}` : "",
        params.investMeta != null ? `investimento mensal R$ ${params.investMeta.toFixed(2).replace(".", ",")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    ) }];
  for (const p of params.prints.slice(0, 8)) parts.push(await fetchInline(p.url, p.mime || "image/png"));
  if (params.audio) parts.push(await fetchInline(params.audio.url, params.audio.mime || "audio/webm"));
  const json = await callGemini(apiKey, { contents: [{ role: "user", parts }], generationConfig: FEEDBACK_SCHEMA });
  return parseFeedback(json);
}
