import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("report_templates")
      .select("id, name, body, period_preset")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ templates: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const text = String(body.body ?? "").trim();
    const period_preset = String(body.period_preset ?? "yesterday");
    if (!name) throw new Error("Dê um nome pro modelo.");
    if (!text) throw new Error("O texto do relatório não pode ficar vazio.");

    const { data, error } = await supabase
      .from("report_templates")
      .insert({ user_id: user.id, name, body: text, period_preset })
      .select("id, name, body, period_preset")
      .single();
    if (error) throw error;
    return NextResponse.json({ template: data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const id = String(body.id ?? "");
    if (!id) throw new Error("id obrigatório.");
    const { error } = await supabase.from("report_templates").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
