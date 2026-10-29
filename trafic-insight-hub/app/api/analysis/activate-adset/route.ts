import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGet, metaPost } from "@/lib/meta/client";

// Etapa 231: "Ativar" depois de duplicar — liga o conjunto novo (os criativos já nascem ativos dentro dele) e, se pedido,
// a campanha. Com início no futuro, o conjunto fica "programado" até a hora.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json()) as { adsetId?: string; activateCampaign?: boolean };
    const adsetId = String(body.adsetId ?? "").trim();
    if (!adsetId) throw new Error("Conjunto obrigatório.");
    const a = await metaGet<{ campaign_id?: string; campaign?: { effective_status?: string } }>(token, `/${adsetId}`, {
      fields: "campaign_id,campaign{effective_status}",
    });
    let campaignStatus = (a.campaign?.effective_status ?? "").toUpperCase();
    if (body.activateCampaign && a.campaign_id && campaignStatus !== "ACTIVE") {
      await metaPost(token, `/${a.campaign_id}`, { status: "ACTIVE" });
      campaignStatus = "ACTIVE";
    }
    await metaPost(token, `/${adsetId}`, { status: "ACTIVE" });
    const after = await metaGet<{ effective_status?: string; start_time?: string }>(token, `/${adsetId}`, { fields: "effective_status,start_time" });
    return NextResponse.json({ ok: true, status: after.effective_status ?? null, startTime: after.start_time ?? null, campaignStatus });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
