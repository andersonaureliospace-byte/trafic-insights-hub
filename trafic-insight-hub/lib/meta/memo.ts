// Etapa 124: memória curta (por instância do servidor) pra não repetir na Meta a MESMA consulta feita
// segundos antes — várias abas/automações pedem a lista de contas, o status dos anúncios e as campanhas
// da mesma conta quase ao mesmo tempo. Também junta chamadas idênticas simultâneas numa só (dedupe).
// "staleOnError": se a Meta falhar (ex.: limite de requisições), devolve a última resposta boa (até maxStaleMs)
// em vez de erro — o "backup" pra tela não ficar vazia.
// Qualquer escrita na Meta (pausar/ativar/mudar orçamento) chama invalidateMetaMemo(): nada fica "velho"
// depois de uma ação.
const store = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export function tokenTag(token: string): string {
  return token.slice(-10);
}

export async function memoMeta<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts: { staleOnError?: boolean; maxStaleMs?: number } = {},
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = (async () => {
    try {
      const value = await fn();
      store.set(key, { at: Date.now(), value });
      return value;
    } catch (e) {
      const old = store.get(key);
      if (opts.staleOnError && old && Date.now() - old.at < (opts.maxStaleMs ?? 6 * 60 * 60 * 1000)) {
        console.error("memoMeta: usando resposta anterior (a Meta falhou)", key, (e as Error).message?.slice(0, 120));
        return old.value as T;
      }
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// Limpa tudo (ou só as chaves que começam com `prefix`). Chamado depois de qualquer escrita na Meta.
export function invalidateMetaMemo(prefix?: string): void {
  for (const k of [...store.keys()]) if (!prefix || k.startsWith(prefix)) store.delete(k);
}
