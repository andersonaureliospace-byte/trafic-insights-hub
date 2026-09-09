import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { DEFAULT_PRIORITY_OPTIONS, type PriorityOption } from "@/lib/format";
import { getPriorityOptions } from "@/lib/priority-labels";

const PREF_KEY = "priority_labels";
const VALID_IDS = new Set(DEFAULT_PRIORITY_OPTIONS.map((p) => p.id));

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    // Etapa 55: lógica movida pra lib/priority-labels.ts, pra ser
    // reaproveitada também pela automação de atualização de status em massa.
    const options = await getPriorityOptions(supabase, user.id);
    return NextResponse.json({ options });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// Substitui a personalização inteira — só aceita rótulo/cor dos 5 IDs
// fixos (nunca cria, remove ou renomeia o ID em si).
export async function PUT(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const incoming = (body.options ?? []) as PriorityOption[];
    if (!Array.isArray(incoming)) throw new Error("options deve ser uma lista.");

    const clean: PriorityOption[] = [];
    for (const item of incoming) {
      if (!item?.id || !VALID_IDS.has(item.id)) continue;
      const label = String(item.label ?? "").trim();
      const color = String(item.color ?? "").trim();
      if (!label) throw new Error("Todos os rótulos precisam de um nome.");
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`Cor inválida para "${label}".`);
      clean.push({ id: item.id, label, color });
    }

    const { error } = await supabase.from("user_ui_prefs").upsert(
      {
        user_id: user.id,
        pref_key: PREF_KEY,
        pref_value: clean,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,pref_key" },
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
