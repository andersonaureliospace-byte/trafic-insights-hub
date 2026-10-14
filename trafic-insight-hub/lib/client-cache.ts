// Etapa 124: "backup" local de cada aba do Painel (localStorage do navegador).
// Regra: ao entrar numa aba, mostra na hora o que foi salvo; só busca na Meta se não tem nada salvo
// ou se o salvo está velho (FRESH_MS). O botão "↻ Atualizar" da própria aba sempre busca — e só dela.
// Se a Meta falhar, o que estava salvo continua na tela (nunca zera).
// Tudo em try/catch: navegador sem localStorage (janela privada, bloqueado) só perde o backup.

export const FRESH_MS = 60 * 60 * 1000;

const PREFIX = "tih_cache_v1:";

export type TabCache<T> = { at: number; data: T };

export function readTabCache<T>(key: string): TabCache<T> | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const p = JSON.parse(raw) as { at?: unknown; data?: unknown };
    if (typeof p.at !== "number" || p.data === undefined) return null;
    return { at: p.at, data: p.data as T };
  } catch {
    return null;
  }
}

export function writeTabCache<T>(key: string, data: T): number {
  const at = Date.now();
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(PREFIX + key, JSON.stringify({ at, data }));
  } catch {
    // cheio/bloqueado: segue sem backup
  }
  return at;
}

export function isFresh(c: { at: number } | null, maxAgeMs = FRESH_MS): boolean {
  return !!c && Date.now() - c.at < maxAgeMs;
}

// "14:32" (hoje) ou "ontem 14:32"/"05/10 14:32" — horário de Brasília.
export function fmtCacheTime(at: number): string {
  const tz = "America/Sao_Paulo";
  const hm = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(at);
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(t);
  if (day(at) === day(Date.now())) return hm;
  const dm = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" }).format(at);
  return `${dm} ${hm}`;
}

// Apaga um backup (ex.: depois de pausar/ativar algo na Meta, pro backup velho não mostrar o status antigo).
export function dropTabCache(key: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(PREFIX + key);
  } catch {
    // ignora
  }
}

// Apaga todos os backups que começam com um prefixo (ex.: "analise-").
export function dropTabCachePrefix(prefix: string): void {
  try {
    if (typeof window === "undefined") return;
    const full = PREFIX + prefix;
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(full)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // ignora
  }
}
