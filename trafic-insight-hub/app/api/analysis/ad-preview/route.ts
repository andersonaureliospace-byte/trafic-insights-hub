import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGet } from "@/lib/meta/client";

// Etapa 229: prévia de UM anúncio, como a Meta mostra (Feed, Stories, Reels…). A Meta devolve um <iframe>; daqui
// sai só o endereço dele (a tela monta o próprio iframe, sem colar HTML de fora).
const FORMATS = new Set([
  "MOBILE_FEED_STANDARD",
  "INSTAGRAM_STANDARD",
  "INSTAGRAM_STORY",
  "INSTAGRAM_REELS",
  "FACEBOOK_STORY_MOBILE",
  "FACEBOOK_REELS_MOBILE",
  "DESKTOP_FEED_STANDARD",
]);

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json()) as { adId?: string; format?: string };
    const adId = String(body.adId ?? "").trim();
    const format = FORMATS.has(String(body.format)) ? String(body.format) : "MOBILE_FEED_STANDARD";
    if (!adId) throw new Error("Anúncio obrigatório.");
    const d = await metaGet<{ data?: Array<{ body?: string }> }>(token, `/${adId}/previews`, { ad_format: format });
    const html = d.data?.[0]?.body ?? "";
    const src = /src="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&") ?? null;
    if (!src || !/^https:\/\/([a-z0-9-]+\.)*(facebook|instagram)\.com\//.test(src)) {
      throw new Error("A Meta não tem prévia desse anúncio nesse formato.");
    }
    return NextResponse.json({ src, format });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
