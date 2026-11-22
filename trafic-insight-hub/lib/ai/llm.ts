// Etapa 330: cliente de IA "barato" pra textos (formato OpenAI /chat/completions).
// Padrão: Groq grátis (GROQ_API_KEY, modelo openai/gpt-oss-120b) — sem a trava de horário do Gemini grátis.
// Trocar de provedor é só mudar as variáveis na Vercel, sem mexer no código:
//   GROQ_API_KEY                         → Groq (padrão)
//   OPENAI_API_KEY                       → OpenAI (se não tiver a da Groq)
//   LLM_MODEL / LLM_BASE_URL (opcionais) → outro modelo / outro provedor compatível
const RETRY = new Set([429, 500, 502, 503]);

interface Provider {
  base: string;
  key: string;
  model: string;
  name: string;
}

function provider(): Provider {
  const groq = process.env.GROQ_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (groq) {
    return { name: "Groq", key: groq, base: process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1", model: process.env.LLM_MODEL || "openai/gpt-oss-120b" };
  }
  if (openai) {
    return { name: "OpenAI", key: openai, base: process.env.LLM_BASE_URL || "https://api.openai.com/v1", model: process.env.LLM_MODEL || "gpt-6-luna" };
  }
  throw new Error("Configure a GROQ_API_KEY (ou OPENAI_API_KEY) nas variáveis da Vercel.");
}

// Etapa 334: modelo que lê imagem (prints). Groq grátis: qwen/qwen3.8-27b (até 3 imagens). OpenAI: o mesmo modelo de texto.
function visionModel(p: Provider): string {
  if (process.env.LLM_VISION_MODEL) return process.env.LLM_VISION_MODEL;
  return p.name === "Groq" ? "qwen/qwen3.8-27b" : p.model;
}

// Manda o prompt e devolve o JSON que a IA respondeu (o prompt tem que pedir JSON).
// images: data URLs ("data:image/png;base64,...") — usa o modelo que lê imagem.
export async function llmJson<T>(
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number; images?: string[] } = {},
): Promise<T> {
  const p = provider();
  const imgs = (opts.images ?? []).slice(0, 3);
  const model = imgs.length ? visionModel(p) : p.model;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: imgs.length ? [{ type: "text", text: user }, ...imgs.map((url) => ({ type: "image_url", image_url: { url } }))] : user,
      },
    ],
    response_format: { type: "json_object" },
    temperature: opts.temperature ?? 0.7,
    max_completion_tokens: opts.maxTokens ?? 2000,
  };
  if (/gpt-oss/.test(model)) body.reasoning_effort = "low"; // raciocínio curto: mais rápido e gasta menos do limite grátis

  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${p.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = d.choices?.[0]?.message?.content ?? "";
      const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
      if (!json) throw new Error(`${p.name} não devolveu nada. Tente de novo.`);
      return JSON.parse(json) as T;
    }
    last = (await res.text()).slice(0, 300);
    // alguns modelos não aceitam o modo JSON: tenta de novo sem ele (o prompt já pede JSON)
    if (res.status === 400 && /response_format|json/i.test(last) && body.response_format) {
      delete body.response_format;
      attempt--;
      continue;
    }
    if (res.status === 429 && attempt === 3) {
      throw new Error(`${p.name}: limite do plano atingido (muitos pedidos seguidos ou cota do dia). Espere um minuto e tente de novo.`);
    }
    if (!RETRY.has(res.status) || attempt === 3) throw new Error(`${p.name} ${res.status}: ${last}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`${p.name}: ${last}`);
}

// Etapa 334: transcreve um áudio curto (pontos de atenção falados). Groq grátis: whisper-large-v3-turbo.
export async function transcrever(url: string, mime: string): Promise<string> {
  const p = provider();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar o áudio (HTTP ${res.status}).`);
  const blob = new Blob([await res.arrayBuffer()], { type: mime || "audio/webm" });
  const ext = (mime || "").includes("mp4") ? "m4a" : (mime || "").includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", blob, `audio.${ext}`);
  form.append("model", process.env.LLM_AUDIO_MODEL || (p.name === "Groq" ? "whisper-large-v3-turbo" : "whisper-1"));
  form.append("language", "pt");
  const r = await fetch(`${p.base}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${p.key}` }, body: form });
  if (!r.ok) throw new Error(`${p.name} (áudio) ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = (await r.json()) as { text?: string };
  return String(d.text ?? "").trim();
}
