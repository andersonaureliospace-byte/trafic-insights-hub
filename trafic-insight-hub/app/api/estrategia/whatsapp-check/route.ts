import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGetAll } from "@/lib/meta/client";

// Etapa 331: diagnóstico da conferência "WhatsApp do conjunto ≠ ficha". Mostra, pra uma conta:
//   - o WhatsApp da ficha;
//   - os avisos de WhatsApp já gerados (últimos 15 dias, enviados ou na fila);
//   - cada conjunto ativo com o que a Meta devolve: destino, promoted_object e o WhatsApp do 1º anúncio.
// GET ?account=662434509922357
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const acc = (new URL(request.url).searchParams.get("account") ?? "").replace(/^act_/, "");
    if (!/^\d+$/.test(acc)) throw new Error("Informe ?account=ID da conta.");
    const token = await getUserMetaToken(supabase, user.id);

    const [{ data: bind }, { data: avisos }] = await Promise.all([
      supabase.from("account_bindings").select("*").eq("user_id", user.id).in("ad_account_id", [acc, `act_${acc}`]).limit(1).maybeSingle(),
      supabase
        .from("estr_digest_items")
        .select("line, created_at, sent_at, group_name, dedupe_key")
        .eq("user_id", user.id)
        .eq("check_id", "whatsapp")
        .in("ad_account_id", [acc, `act_${acc}`])
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const rows = await metaGetAll<Record<string, unknown>>(
      token,
      `/act_${acc}/adsets`,
      {
        fields:
          "id,name,effective_status,updated_time,created_time,destination_type,promoted_object,ads.limit(1){id,name,creative{object_story_spec,asset_feed_spec,call_to_action_type}}",
        effective_status: JSON.stringify(["ACTIVE"]),
        limit: "100",
      },
      3,
    );
    const conjuntos = rows.map((r) => {
      const ad = ((r.ads as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [])[0];
      const txt = JSON.stringify(ad?.creative ?? {});
      const nums = [...new Set(txt.match(/whatsapp[^"]*"\s*:\s*"[^"]+"/gi) ?? [])].slice(0, 5);
      return {
        nome: r.name,
        criado: r.created_time,
        atualizado: r.updated_time,
        destino: r.destination_type ?? null,
        promoted_object: r.promoted_object ?? null,
        whatsapp_no_anuncio: nums,
      };
    });
    return NextResponse.json({ conta: acc, cliente: bind?.client_name ?? null, ficha: bind?.whatsapp_contact ?? null, ficha2: bind?.whatsapp_contact_2 ?? null, avisos: avisos ?? [], conjuntos });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
