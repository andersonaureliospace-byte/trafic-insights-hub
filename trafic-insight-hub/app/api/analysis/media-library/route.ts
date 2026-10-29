import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGet } from "@/lib/meta/client";

// Etapa 231 (teste): o que a Meta devolve da biblioteca de mídia — pastas do portfólio (testa versões novas da API, que é
// onde as pastas existem) e vídeos da conta. Só leitura.
export const maxDuration = 60;

async function raw(version: string, path: string, params: Record<string, string>, token: string) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(`https://graph.facebook.com/${version}${path}?${qs}`);
  const j = (await r.json()) as { data?: Array<Record<string, unknown>>; error?: { message?: string } };
  return j.error ? { ok: false, error: j.error.message ?? "erro" } : { ok: true, data: j.data ?? j };
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const url = new URL(request.url);
    const accountId = url.searchParams.get("accountId") ?? "";
    const version = url.searchParams.get("v") ?? "v25.0";
    const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
    const biz = await metaGet<{ data?: Array<{ id: string; name?: string }> }>(token, "/me/businesses", { fields: "id,name", limit: "100" });
    const out: Record<string, unknown> = {};
    for (const b of biz.data ?? []) {
      const f = await raw(version, `/${b.id}/creative_folders`, { fields: "id,name", limit: "50" }, token);
      out[b.name ?? b.id] = { id: b.id, folders: f };
    }
    if (accountId) out.__accountVideos = await raw(version, `/${act}/advideos`, { fields: "id,title,created_time", limit: "3" }, token);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
