import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { describeAsanaSync, syncAsanaPriorities, type AsanaSyncItem } from "@/lib/asana/priority-sync";

// Etapa 113: usado pelo diálogo manual "Atualizar status em massa" pra mandar as prioridades
// calculadas pro Asana (a automação das 01h chama a lib direto, sem passar por aqui).
export async function POST(request: Request) {
  try {
    await requireUser();
    const body = (await request.json()) as { items?: AsanaSyncItem[] };
    const items = (body.items ?? [])
      .filter((i) => i && typeof i.clientName === "string" && typeof i.priority === "string")
      .map((i) => ({ clientName: i.clientName, priority: i.priority }));
    const summary = await syncAsanaPriorities(items);
    return NextResponse.json({ summary, text: describeAsanaSync(summary) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
