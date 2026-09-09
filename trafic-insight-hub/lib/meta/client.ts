// Cliente cru da Graph API do Meta. Sem estado — recebe o token em cada chamada.
// Portado do app anterior (src/lib/meta.functions.ts), mesma lógica de retry
// e paginação.

const GRAPH = "https://graph.facebook.com/v21.0";

export type DatePreset =
  | "today"
  | "yesterday"
  | "today_yesterday"
  | "last_3d"
  | "last_3d_plus_today"
  | "last_7d"
  | "this_month"
  | "maximum";

export type DateRangeInput = DatePreset | { since: string; until: string };

export function spDate(d: Date): string {
  // YYYY-MM-DD no fuso America/Sao_Paulo
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function presetParams(preset: DateRangeInput): Record<string, string> {
  if (typeof preset === "object" && preset && "since" in preset) {
    return { time_range: JSON.stringify({ since: preset.since, until: preset.until }) };
  }
  if (preset === "last_3d_plus_today") {
    const now = new Date();
    const until = spDate(now);
    const since = spDate(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000));
    return { time_range: JSON.stringify({ since, until }) };
  }
  if (preset === "today_yesterday") {
    const now = new Date();
    const until = spDate(now);
    const since = spDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    return { time_range: JSON.stringify({ since, until }) };
  }
  return { date_preset: preset };
}

export async function metaGet<T>(
  token: string,
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const url = `${GRAPH}${path}?${qs.toString()}`;
  const maxAttempts = 3;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return (await res.json()) as T;
      const text = await res.text();
      let transient = res.status >= 500 || res.status === 429;
      if (!transient) {
        try {
          const j = JSON.parse(text);
          if (j?.error?.is_transient) transient = true;
        } catch {
          /* not json */
        }
      }
      if (transient && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      throw new Error(`Meta API ${res.status}: ${text}`);
    } catch (e) {
      lastErr = e;
      if (attempt >= maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Meta API: falha desconhecida");
}

export async function metaGetAll<T>(
  token: string,
  path: string,
  params: Record<string, string>,
  maxPages = 5,
): Promise<T[]> {
  const out: T[] = [];
  const qs = new URLSearchParams({ ...params, access_token: token });
  let url = `${GRAPH}${path}?${qs.toString()}`;
  for (let i = 0; i < maxPages; i++) {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta API ${res.status}: ${text}`);
    }
    const json = (await res.json()) as { data?: T[]; paging?: { next?: string } };
    if (json.data) out.push(...json.data);
    if (!json.paging?.next) break;
    url = json.paging.next;
  }
  return out;
}

// Códigos clássicos de rate limit da Graph API (nível de app/conta/usuário) —
// "There have been too many calls..." e primos. Tratado à parte do
// transient/5xx comum porque pede um backoff bem mais longo pra ter chance
// de resolver (usado pelas ações em massa da Análise, Etapa 33).
function classifyPostError(status: number, text: string): { transient: boolean; rateLimited: boolean; msg: string } {
  let msg = text;
  let transient = status >= 500 || status === 429;
  let rateLimited = false;
  try {
    const j = JSON.parse(text);
    msg = j?.error?.error_user_msg || j?.error?.message || text;
    const code = j?.error?.code;
    if (j?.error?.is_transient) transient = true;
    if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80004) {
      rateLimited = true;
      transient = true;
    }
  } catch {
    // não é JSON, segue com o texto cru
  }
  return { transient, rateLimited, msg };
}

export async function metaPost<T>(
  token: string,
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const maxAttempts = 4;
  let lastMsg = "Meta API: falha desconhecida ao tentar de novo";
  let lastStatus = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${GRAPH}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (res.ok) return res.json() as Promise<T>;
    const text = await res.text();
    const { transient, rateLimited, msg } = classifyPostError(res.status, text);
    lastMsg = msg;
    lastStatus = res.status;
    if (transient && attempt < maxAttempts) {
      // Rate limit real da Meta pede mais tempo pra esvaziar o balde do que
      // um 5xx comum — por isso o backoff é bem maior nesse caso.
      const delay = rateLimited ? 3000 * attempt : 500 * attempt;
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    throw new Error(`Meta API ${res.status}: ${msg}`);
  }
  throw new Error(`Meta API ${lastStatus}: ${lastMsg}`);
}
