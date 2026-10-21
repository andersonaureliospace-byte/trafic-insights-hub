// Lista de vídeos de GERAL guardada no banco (Etapa 177) — editada em Configurações → Vídeos gerais.
// Se a tabela ainda não existe (migration 0036 não rodou), cai na lista padrão do código pra nada quebrar.

import type { createClient } from "@/lib/supabase/server";
import { DEFAULT_VIDEO_BANK } from "./video-bank";

type Db = Awaited<ReturnType<typeof createClient>>;

export interface VideoBankRow {
  id: string;
  name: string;
  position: number;
}

export async function listVideoBankRows(db: Db, userId: string): Promise<VideoBankRow[]> {
  const { data, error } = await db
    .from("video_bank")
    .select("id, name, position")
    .eq("user_id", userId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as VideoBankRow[];
}

// Só os nomes, na ordem da lista. Tabela inexistente -> lista padrão; tabela vazia -> vazia (o usuário apagou tudo).
export async function loadVideoBank(db: Db, userId: string): Promise<string[]> {
  try {
    return (await listVideoBankRows(db, userId)).map((r) => r.name);
  } catch {
    return [...DEFAULT_VIDEO_BANK];
  }
}
