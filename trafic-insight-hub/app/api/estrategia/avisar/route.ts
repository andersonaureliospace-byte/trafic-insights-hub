import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";

// Etapa 272: Tráfego → Acompanhamento → "Avisar gestores". O navegador monta o relatório (contas escolhidas × métricas)
// e manda aqui: cada mensagem vai pro WhatsApp pessoal do gestor (cadastro em Gestores) ou pra um grupo escolhido.
//   POST { mensagens: [{ gestor?: string, groupId?: string, text: string }] }
export const maxDuration = 60;

const toWhats = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d && !d.startsWith("55") && d.length <= 11 ? `55${d}` : d;
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as { mensagens?: Array<{ gestor?: string; groupId?: string; text?: string }> };
    const msgs = (body.mensagens ?? []).filter((m) => String(m.text ?? "").trim()).slice(0, 30);
    if (msgs.length === 0) throw new Error("Nada pra enviar.");

    const { data: gRow } = await supabase.from("user_ui_prefs").select("pref_value").eq("user_id", user.id).eq("pref_key", "gestores").maybeSingle();
    const cadastro = new Map<string, string>();
    for (const x of (Array.isArray(gRow?.pref_value) ? gRow.pref_value : []) as Array<{ name?: string; whatsapp?: string }>) {
      if (x?.name) cadastro.set(norm(x.name), toWhats(String(x.whatsapp ?? "")));
    }
    const inst = await requireWhatsappInstance(supabase, user.id);
    const creds = { api_url: inst.api_url, token: inst.token };

    const resultados: Array<{ para: string; ok: boolean; erro?: string }> = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const para = m.groupId ? "grupo" : String(m.gestor ?? "");
      const to = m.groupId ? String(m.groupId) : cadastro.get(norm(String(m.gestor ?? ""))) ?? "";
      if (!m.groupId && to.length < 12) {
        resultados.push({ para, ok: false, erro: "sem WhatsApp cadastrado em Gestores" });
        continue;
      }
      try {
        if (i > 0) await sleep(1200);
        await sendText(creds, to, String(m.text).trim().slice(0, 4000));
        resultados.push({ para, ok: true });
      } catch (e) {
        resultados.push({ para, ok: false, erro: (e as Error).message.slice(0, 200) });
      }
    }
    return NextResponse.json({ ok: true, resultados });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
