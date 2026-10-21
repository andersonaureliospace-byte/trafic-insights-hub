import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { normVideo } from "@/lib/meta/video-bank";
import { listVideoBankRows } from "@/lib/meta/video-bank-store";

// Etapa 177: lista de vídeos de GERAL (Configurações → Vídeos gerais).
// GET    -> a lista (na ordem).
// POST   -> { name } adiciona um vídeo; { names: string[] } adiciona vários de uma vez (um por linha na tela).
// PATCH  -> { id, name } renomeia.
// DELETE -> ?id=... exclui.
// Os números dos vídeos novos/renomeados só aparecem depois do próximo "Atualizar" em Painel → Vídeos (o retrato é refeito de madrugada).

// "preço único" -> "GERAL | preço único"; "GERAL|X" -> "GERAL | X". O resto do texto fica como foi digitado.
function normalizeName(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  const rest = t.replace(/^geral\s*\|\s*/i, "").trim();
  if (!rest) throw new Error("Escreva o nome do vídeo.");
  const name = `GERAL | ${rest}`;
  if (name.length > 120) throw new Error("Nome grande demais (máx. 120 letras).");
  return name;
}

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    return NextResponse.json({ rows: await listVideoBankRows(supabase, user.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as { name?: string; names?: string[] };
    const raw = Array.isArray(body.names) ? body.names : [String(body.name ?? "")];
    const wanted = raw.map((n) => String(n).trim()).filter(Boolean);
    if (wanted.length === 0) throw new Error("Escreva o nome do vídeo.");

    const rows = await listVideoBankRows(supabase, user.id);
    const seen = new Set(rows.map((r) => normVideo(r.name)));
    let pos = rows.reduce((m, r) => Math.max(m, r.position), 0);
    const toAdd: { user_id: string; name: string; position: number }[] = [];
    const skipped: string[] = [];
    for (const w of wanted) {
      const name = normalizeName(w);
      const key = normVideo(name);
      if (seen.has(key)) {
        skipped.push(name);
        continue;
      }
      seen.add(key);
      toAdd.push({ user_id: user.id, name, position: ++pos });
    }
    if (toAdd.length === 0) throw new Error(wanted.length === 1 ? "Esse vídeo já está na lista." : "Todos esses vídeos já estão na lista.");
    const { error } = await supabase.from("video_bank").insert(toAdd);
    if (error) throw error;
    return NextResponse.json({ ok: true, added: toAdd.length, skipped });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as { id?: string; name?: string };
    const id = String(body.id ?? "");
    if (!id) throw new Error("id é obrigatório.");
    const name = normalizeName(String(body.name ?? ""));
    const rows = await listVideoBankRows(supabase, user.id);
    if (rows.some((r) => r.id !== id && normVideo(r.name) === normVideo(name))) throw new Error("Já existe um vídeo com esse nome.");
    const { error } = await supabase.from("video_bank").update({ name }).eq("user_id", user.id).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true, name });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) throw new Error("id é obrigatório.");
    const { error } = await supabase.from("video_bank").delete().eq("user_id", user.id).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
