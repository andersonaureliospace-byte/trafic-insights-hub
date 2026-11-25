import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMasterId } from "@/lib/master";

// Etapa 353: Asana por estrategista. Cada um tem o próprio token (Personal Access Token) e o nome que aparece nas
// seções dele no projeto (ex.: "Anderson" → seções "Anderson - (Denner)", "Kauê (Anderson)"…).
// Guardado em user_ui_prefs, chave "asana_config" = { token, secao } (nunca volta inteiro pro navegador).
// Master sem configuração própria = como sempre foi (ASANA_ACCESS_TOKEN da Vercel + seções com "Anderson").

export const ASANA_CONFIG_KEY = "asana_config";

export interface AsanaScope {
  token: string | null;
  match: RegExp;
  isMaster: boolean;
}

const als = new AsyncLocalStorage<AsanaScope>();

export const currentAsana = (): AsanaScope | undefined => als.getStore();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function loadAsanaScope(db: SupabaseClient, userId: string): Promise<AsanaScope> {
  const [{ data }, master] = await Promise.all([
    db.from("user_ui_prefs").select("pref_value").eq("user_id", userId).eq("pref_key", ASANA_CONFIG_KEY).maybeSingle(),
    getMasterId(db),
  ]);
  const v = (data?.pref_value ?? {}) as { token?: string; secao?: string };
  const isMaster = userId === master;
  const secao = String(v.secao ?? "").trim();
  return {
    token: (v.token ?? "").trim() || (isMaster ? (process.env.ASANA_ACCESS_TOKEN ?? null) : null),
    match: secao ? new RegExp(escapeRe(secao), "i") : isMaster ? /anderson/i : /(?!)/, // estrategista sem seção = nenhuma
    isMaster,
  };
}

// Roda `fn` com o Asana do estrategista `userId` (token + seções).
export async function withAsanaFor<T>(db: SupabaseClient, userId: string, fn: () => Promise<T>): Promise<T> {
  const scope = await loadAsanaScope(db, userId);
  return als.run(scope, fn);
}
