import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { keepNaming, renameEntity, stillDivergent, type NamingEntity } from "@/lib/naming/scan";
import { hasCopy } from "@/lib/naming/rules";

// Etapa 140: aceitar (ou editar e aceitar) um nome sugerido — renomeia na hora na Meta.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json()) as {
      id?: string;
      name?: string;
      entity?: NamingEntity;
      ad_account_id?: string | null;
      client_name?: string | null;
      edited?: boolean;
    };
    const id = body.id?.trim();
    const name = body.name?.replace(/\s+/g, " ").trim();
    if (!id || !/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: "id inválido" }, { status: 400 });
    if (!name || name.length > 380) return NextResponse.json({ ok: false, error: "Nome vazio ou longo demais." }, { status: 400 });
    if (hasCopy(name)) return NextResponse.json({ ok: false, error: 'O nome não pode ter "cópia".' }, { status: 400 });
    await renameEntity(token, id, name);
    // Nome EDITADO por você que continua fora da regra = personalização de propósito: guarda como personalizado (não volta pra lista).
    let locked = false;
    if (body.edited && (body.entity === "campaign" || body.entity === "adset" || body.entity === "ad")) {
      try {
        if (await stillDivergent(token, body.entity, id, name, body.client_name ?? null)) {
          await keepNaming(supabase, user.id, {
            id,
            entity: body.entity,
            ad_account_id: body.ad_account_id ?? null,
            client_name: body.client_name ?? null,
            name,
          });
          locked = true;
        }
      } catch (e) {
        console.error("naming: não consegui guardar como personalizado (o nome já foi trocado)", (e as Error).message);
      }
    }
    return NextResponse.json({ ok: true, locked });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
