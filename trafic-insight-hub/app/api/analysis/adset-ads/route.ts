import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGetAll, spDate } from "@/lib/meta/client";

// Etapa 220: Análise → "Conjuntos da conta" — criativos de UM conjunto (só quando você abre o conjunto: 2 chamadas).
// Status de cada anúncio + gasto, conversas e custo por conversa (lead) no período do filtro (ontem + hoje ou 15 dias).
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json()) as { adsetId?: string; period?: "d2" | "d15" };
    const adsetId = String(body.adsetId ?? "").trim();
    if (!adsetId) throw new Error("Conjunto obrigatório.");
    const now = new Date();
    const today = spDate(now);
    const since = spDate(new Date(now.getTime() - (body.period === "d15" ? 14 : 1) * 86_400_000));

    const [ads, insights] = await Promise.all([
      metaGetAll<{ id: string; name?: string; effective_status?: string; status?: string; created_time?: string }>(token, `/${adsetId}/ads`, {
        fields: "id,name,effective_status,status,created_time",
        limit: "200",
      }),
      metaGetAll<{ ad_id?: string; spend?: string; impressions?: string; actions?: Array<{ action_type?: string; value?: string }> }>(
        token,
        `/${adsetId}/insights`,
        {
          fields: "ad_id,spend,impressions,actions",
          level: "ad",
          time_range: JSON.stringify({ since, until: today }),
          limit: "200",
          use_unified_attribution_setting: "true",
        },
      ),
    ]);

    const byAd = new Map(
      insights
        .filter((r) => r.ad_id)
        .map((r) => {
          const conv = (r.actions ?? []).find((a) => (a.action_type ?? "").includes("messaging_conversation_started"));
          return [r.ad_id as string, { spend: Number(r.spend ?? 0), impressions: Number(r.impressions ?? 0), conversations: conv?.value ? Number(conv.value) : 0 }];
        }),
    );
    const rows = ads
      .map((a) => {
        const m = byAd.get(a.id) ?? { spend: 0, impressions: 0, conversations: 0 };
        return {
          id: a.id,
          name: a.name || a.id,
          status: (a.effective_status || a.status || "").toUpperCase(),
          created_time: a.created_time ?? null,
          ...m,
          cpl: m.conversations > 0 ? m.spend / m.conversations : null,
        };
      })
      .filter((a) => a.status !== "DELETED" && a.status !== "ARCHIVED")
      .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name, "pt-BR"));
    return NextResponse.json({ ads: rows, period: { since, until: today } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
