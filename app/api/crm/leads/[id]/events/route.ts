import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("crm_lead_events")
      .select("id, event_type, from_status, to_status, note, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ events: data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
