import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGet } from "@/lib/meta/client";

// Etapa 231 (teste): o que a Meta devolve da biblioteca de mídia — pastas do portfólio, mídias do portfólio e vídeos da conta.
// Só leitura. Serve pra decidir como a troca de vídeo do "Duplicar conjunto" vai funcionar.
type R = { ok: boolean; data?: unknown; error?: string };
async function tryGet(token: string, path: string, params: Record<string, string>): Promise<R> {
  try {
    return { ok: true, data: await metaGet(token, path, params) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const accountId = new URL(request.url).searchParams.get("accountId") ?? "";
    const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
    const biz = await tryGet(token, "/me/businesses", { fields: "id,name", limit: "10" });
    const out: Record<string, unknown> = { businesses: biz };
    const list = ((biz.data as { data?: Array<{ id: string; name?: string }> } | undefined)?.data ?? []).slice(0, 3);
    for (const b of list) {
      const folders = await tryGet(token, `/${b.id}/creative_folders`, { fields: "id,name,media_library_url", limit: "25" });
      const firstFolder = ((folders.data as { data?: Array<{ id: string }> } | undefined)?.data ?? [])[0];
      out[`biz_${b.id}`] = {
        name: b.name,
        folders,
        folderDetail: firstFolder ? await tryGet(token, `/${firstFolder.id}`, { fields: "id,name,media_library_url,parent_folder_id,creation_time" }) : null,
        folderVideos: firstFolder ? await tryGet(token, `/${firstFolder.id}/videos`, { fields: "id,title,picture", limit: "5" }) : null,
        creatives: await tryGet(token, `/${b.id}/creatives`, { limit: "5" }),
        videos: await tryGet(token, `/${b.id}/videos`, { fields: "id,title,picture,created_time", limit: "5" }),
      };
    }
    if (accountId) out.accountVideos = await tryGet(token, `/${act}/advideos`, { fields: "id,title,picture,created_time,length", limit: "5" });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
