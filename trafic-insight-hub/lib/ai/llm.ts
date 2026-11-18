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

// Manda o prompt e devolve o JSON que a IA respondeu (o prompt tem que pedir JSON).
export async function llmJson<T>(system: string, user: string, opts: { temperature?: number; maxTokens?: number } = {}): Promise<T> {
  const p = provider();
  const body: Record<string, unknown> = {
    model: p.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: opts.temperature ?? 0.7,
    max_completion_tokens: opts.maxTokens ?? 2000,
  };
  if (/gpt-oss/.test(p.model)) body.reasoning_effort = "low"; // raciocínio curto: mais rápido e gasta menos do limite grátis

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
    if (res.status === 429 && attempt === 3) {
      throw new Error(`${p.name}: limite do plano atingido (muitos pedidos seguidos ou cota do dia). Espere um minuto e tente de novo.`);
    }
    if (!RETRY.has(res.status) || attempt === 3) throw new Error(`${p.name} ${res.status}: ${last}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`${p.name}: ${last}`);
}
