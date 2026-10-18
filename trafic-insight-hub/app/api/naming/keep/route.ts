import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { keepNaming, releaseNaming, type NamingEntity } from "@/lib/naming/scan";

// Etapa 140c: "Manter personalizado" (o item sai da lista e o sistema não mexe mais no nome) e "Voltar ao padrão".
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as {
      action?: "keep" | "release";
      id?: string;
      entity?: NamingEntity;
      ad_account_id?: string | null;
      client_name?: string | null;
      name?: string | null;
    };
    const id = body.id?.trim();
    if (!id || !/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: "id inválido" }, { status: 400 });
    if (body.action === "release") {
      await releaseNaming(supabase, user.id, id);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "keep") {
      if (body.entity !== "campaign" && body.entity !== "adset" && body.entity !== "ad") {
        return NextResponse.json({ ok: false, error: "entity inválido" }, { status: 400 });
      }
      await keepNaming(supabase, user.id, {
        id,
        entity: body.entity,
        ad_account_id: body.ad_account_id ?? null,
        client_name: body.client_name ?? null,
        name: body.name ?? null,
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "action inválida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
