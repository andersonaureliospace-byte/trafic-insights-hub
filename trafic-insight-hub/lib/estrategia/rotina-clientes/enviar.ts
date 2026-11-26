// Etapa 355: fila da Rotina da manhã — manda as mensagens programadas (Feedback → Programado) na ordem da fila
// (sensíveis → reclamando → inauguração → críticas → altas → médias → baixas), com alguns segundos entre um grupo e
// outro. Cada chamada manda o que couber no tempo; o resto vai numa nova chamada (a rota se chama de novo).
import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarSP } from "@/lib/estrategia/calc";
import { gravarAgendados, lerAgendados } from "@/lib/feedbacks/agendados";
import { enviarFeedback } from "@/lib/feedbacks/enviar";
import { ROTINA_TITULO } from "./gerar";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (id: string) => String(id).replace(/^act_/, "");

export async function enviarRotinaClientes(
  db: SupabaseClient,
  userId: string,
  opts: { deadlineMs: number },
): Promise<{ enviados: number; pulados: string[]; erros: string[]; restantes: number }> {
  const erros: string[] = [];
  const pulados: string[] = [];
  let enviados = 0;
  const inicioHojeUtc = `${calendarSP().today}T03:00:00.000Z`;
  const vencidas = (list: Awaited<ReturnType<typeof lerAgendados>>) =>
    list.filter((a) => a.rotina && Date.parse(a.quando) <= Date.now()).sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999));

  while (Date.now() < opts.deadlineMs - 8000) {
    // relê a fila a cada envio (alguém pode ter cancelado ou editado pelo Hub)
    const list = await lerAgendados(db, userId);
    const prox = vencidas(list)[0];
    if (!prox) break;
    await gravarAgendados(db, userId, list.filter((a) => a.id !== prox.id)); // tira antes de mandar (não manda 2x)

    // já teve feedback manual pro cliente hoje? então a rotina pula esse cliente
    const { data: fb } = await db.from("client_feedbacks").select("ad_account_id").eq("id", prox.id).eq("user_id", userId).maybeSingle();
    if (fb) {
      const { data: manual } = await db
        .from("client_feedbacks")
        .select("id, titulo")
        .eq("user_id", userId)
        .eq("status", "enviado")
        .gte("sent_at", inicioHojeUtc)
        .in("ad_account_id", [norm(fb.ad_account_id as string), `act_${norm(fb.ad_account_id as string)}`]);
      if ((manual ?? []).some((m) => m.id !== prox.id && !String(m.titulo ?? "").startsWith(ROTINA_TITULO))) {
        pulados.push(prox.cliente ?? prox.id);
        await db.from("client_feedbacks").update({ send_error: "Não enviada: o cliente já recebeu feedback manual hoje.", updated_at: new Date().toISOString() }).eq("id", prox.id);
        continue;
      }
    }
    try {
      await enviarFeedback(db, userId, prox.id, null);
      enviados++;
    } catch (e) {
      erros.push(`${prox.cliente ?? prox.id}: ${(e as Error).message.slice(0, 150)}`);
    }
    await sleep(4000 + Math.floor(Math.random() * 3000)); // 4 a 7 s entre um grupo e outro
  }
  const restantes = vencidas(await lerAgendados(db, userId)).length;
  return { enviados, pulados, erros, restantes };
}
