import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGetAll } from "@/lib/meta/client";

// Etapa 195 — diagnóstico SÓ DE LEITURA: mostra quais anúncios ATIVOS da conta a trava de "várias mídias" reconhece.
// Uso (logado): /api/meta/multi-media?account=act_809801718127179
// Não altera nada na Meta nem no banco.

interface Row {
  id?: string;
  name?: string;
  adset_id?: string;
  creative?: {
    object_type?: string;
    asset_feed_spec?: { videos?: unknown[]; images?: unknown[]; ad_formats?: string[] };
  };
}

export async function GET(req: Request) {
  try {
    const { supabase, user } = await requireUser();
    const raw = new URL(req.url).searchParams.get("account")?.trim() ?? "";
    if (!/^(act_)?\d+$/.test(raw)) return NextResponse.json({ error: "Informe ?account=act_123..." }, { status: 400 });
    const id = raw.startsWith("act_") ? raw : `act_${raw}`;
    const { data: bind } = await supabase
      .from("account_bindings")
      .select("ad_account_id")
      .eq("user_id", user.id)
      .eq("ad_account_id", id)
      .maybeSingle();
    if (!bind) return NextResponse.json({ error: "Conta não vinculada ao seu usuário." }, { status: 403 });
    const token = await getUserMetaToken(supabase, user.id);
    const rows = await metaGetAll<Row>(
      token,
      `/${id}/ads`,
      {
        fields: "id,name,adset_id,creative{object_type,asset_feed_spec}",
        effective_status: JSON.stringify(["ACTIVE"]),
        limit: "200",
      },
      5,
    );
    const ads = rows.map((r) => {
      const spec = r.creative?.asset_feed_spec;
      const videos = spec?.videos?.length ?? 0;
      const images = spec?.images?.length ?? 0;
      return {
        id: r.id,
        name: r.name,
        adset_id: r.adset_id,
        object_type: r.creative?.object_type ?? null,
        videos,
        images,
        ad_formats: spec?.ad_formats ?? null,
        multi_media: videos + images > 1,
      };
    });
    return NextResponse.json({
      account: id,
      active_ads: ads.length,
      multi_media_count: ads.filter((a) => a.multi_media).length,
      multi_media: ads.filter((a) => a.multi_media),
      single_media_sample: ads.filter((a) => !a.multi_media).slice(0, 10),
    });
  } catch (e) {
    const msg = (e as Error).message || "erro";
    return NextResponse.json({ error: msg }, { status: msg === "UNAUTHENTICATED" ? 401 : 500 });
  }
}
