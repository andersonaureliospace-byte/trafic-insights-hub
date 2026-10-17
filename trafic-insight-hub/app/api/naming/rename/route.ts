import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { renameEntity } from "@/lib/naming/scan";
import { hasCopy } from "@/lib/naming/rules";

// Etapa 140: aceitar (ou editar e aceitar) um nome sugerido — renomeia na hora na Meta.
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json()) as { id?: string; name?: string };
    const id = body.id?.trim();
    const name = body.name?.replace(/\s+/g, " ").trim();
    if (!id || !/^\d+$/.test(id)) return NextResponse.json({ ok: false, error: "id inválido" }, { status: 400 });
    if (!name || name.length > 380) return NextResponse.json({ ok: false, error: "Nome vazio ou longo demais." }, { status: 400 });
    if (hasCopy(name)) return NextResponse.json({ ok: false, error: 'O nome não pode ter "cópia".' }, { status: 400 });
    await renameEntity(token, id, name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
