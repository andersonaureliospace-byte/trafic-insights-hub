import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getAccess, type HubAccess } from "@/lib/access";
import { getUserMetaToken } from "@/lib/current-user";

// Etapa 352: contexto de cada pedido nas rotas que o GESTOR também usa.
//   estrategista/master → banco com o login dele (a regra do banco já isola), ownerId = ele, sem filtro de contas
//   gestor → lê a carteira do estrategista dele (ownerId) pelo servidor, mas SÓ as contas em que é o Responsável
// Toda rota que usa isto filtra por ownerId e, quando `allowed` existe, pelas contas permitidas.

export interface HubCtx {
  access: HubAccess;
  db: SupabaseClient;
  ownerId: string;
  isGestor: boolean;
  allowed: Set<string> | null; // ids sem "act_"; null = todas da carteira
  token: () => Promise<string>; // token da Meta da carteira (gestor usa o do estrategista)
}

const norm = (id: string) => String(id).replace(/^act_/, "");

export async function getHubCtx(): Promise<HubCtx> {
  const access = await getAccess();
  if (access.role !== "gestor") {
    const db = (await createClient()) as unknown as SupabaseClient;
    return { access, db, ownerId: access.user.id, isGestor: false, allowed: null, token: () => getUserMetaToken(db as never, access.user.id) };
  }
  const db = createServiceClient();
  const nome = (access.gestorName ?? "").trim();
  if (!nome) throw new Error("Seu acesso de gestor está sem nome. Fale com o estrategista.");
  const { data, error } = await db
    .from("account_bindings")
    .select("ad_account_id, responsible, archived")
    .eq("user_id", access.ownerId);
  if (error) throw new Error(error.message);
  const allowed = new Set(
    (data ?? [])
      .filter((b) => !b.archived && String(b.responsible ?? "").trim().toLowerCase() === nome.toLowerCase())
      .map((b) => norm(b.ad_account_id as string)),
  );
  return { access, db, ownerId: access.ownerId, isGestor: true, allowed, token: () => getUserMetaToken(db as never, access.ownerId) };
}

// Mantém só as contas que essa pessoa pode ver (devolve sem "act_").
export function allowedIds(ctx: HubCtx, ids: string[]): string[] {
  const list = ids.map(norm).filter(Boolean);
  return ctx.allowed ? list.filter((id) => ctx.allowed!.has(id)) : list;
}

export const canSee = (ctx: HubCtx, id: string) => !ctx.allowed || ctx.allowed.has(norm(id));
