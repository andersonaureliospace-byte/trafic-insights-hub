import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { DEFAULT_PRIORITY_OPTIONS, type PriorityOption } from "@/lib/format";

const PREF_KEY = "priority_labels";
const VALID_IDS = new Set(DEFAULT_PRIORITY_OPTIONS.map((p) => p.id));

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("user_ui_prefs")
      .select("pref_value")
      .eq("user_id", user.id)
      .eq("pref_key", PREF_KEY)
      .maybeSingle();
    if (error) throw error;

    const saved = (data?.pref_value ?? []) as Partial<PriorityOption>[];
    const savedById = new Map(saved.filter((s) => s.id).map((s) => [s.id, s]));
    // Sempre parte dos 5 IDs fixos, na mesma ordem — só troca rótulo/cor se
    // o usuário tiver personalizado aquele item específico.
    const options = DEFAULT_PRIORITY_OPTIONS.map((def) => ({
      id: def.id,
      label: savedById.get(def.id)?.label || def.label,
      color: savedById.get(def.id)?.color || def.color,
    }));
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
