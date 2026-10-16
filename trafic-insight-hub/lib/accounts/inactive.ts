// Etapa 131: clientes DESATIVADOS (account_bindings.active = false). Só a ficha em Clientes continua existindo; o resto
// (painéis, análises, alertas, auditoria, relatórios, sincronizações) ignora a conta.
// Tolerante a falha: se a coluna ainda não existe (SQL 0031 não rodado) ou a consulta der erro, devolve "ninguém
// desativado" — as automações seguem funcionando como sempre em vez de quebrar.
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

export async function inactiveAccountIds(db: Db, userId: string): Promise<Set<string>> {
  try {
    const { data, error } = await db
      .from("account_bindings")
      .select("ad_account_id")
      .eq("user_id", userId)
      .eq("active", false);
    if (error) return new Set();
    return new Set((data ?? []).map((r) => r.ad_account_id as string));
  } catch {
    return new Set();
  }
}
