import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { calendarSP } from "@/lib/estrategia/calc";
import { llmJson } from "@/lib/ai/llm";
import { ORIGEM_PREFIX, origemKey } from "@/lib/estrategia/alerta-tarefas";

// Etapa 341: tarefas do quadro Alertas (Acompanhamento → Alertas).
//   GET                                  → tarefas abertas + as finalizadas hoje
//   POST { action: "narrar", ... }       → a IA transforma a sua narração em tarefa(s) do cliente
//   POST { action: "sugerir", ... }      → a IA sugere 1 ou mais tarefas pra cada alerta (não grava; você escolhe)
//   POST { action: "criar", tarefas }    → grava as tarefas escolhidas (sugeridas pela IA)
//   POST { action: "concluir", id, nota? } · { action: "reabrir", id } · { action: "excluir", id }
export const maxDuration = 60;

const COLS = "id, titulo, descricao, ad_account_id, client_name, responsavel, status, done_at, origem_key, created_at";
const norm = (id: string) => String(id ?? "").replace(/^act_/, "").trim();
const semTabela = (m: string) => /estr_tarefas/.test(m);

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const hoje = calendarSP().today;
    const desde = `${hoje}T03:00:00.000Z`; // 00h de hoje em Brasília
    const [abertas, feitas] = await Promise.all([
      supabase.from("estr_tarefas").select(COLS).eq("user_id", user.id).eq("tipo", "alerta").eq("status", "aberta").like("origem_key", `${ORIGEM_PREFIX}%`).limit(1000),
      supabase.from("estr_tarefas").select(COLS).eq("user_id", user.id).eq("tipo", "alerta").eq("status", "feita").like("origem_key", `${ORIGEM_PREFIX}%`).gte("done_at", desde).limit(1000),
    ]);
    if (abertas.error) {
      if (semTabela(abertas.error.message)) return NextResponse.json({ tarefas: [], semTabela: true });
      throw abertas.error;
    }
    return NextResponse.json({ tarefas: [...(abertas.data ?? []), ...(feitas.data ?? [])] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

interface AlertaIn {
  key: string;
  titulo: string;
  detalhe: string;
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const now = new Date().toISOString();

    if (action === "sugerir") {
      const cliente = String(body.client_name ?? "").slice(0, 200);
      const responsavel = String(body.responsavel ?? "").trim() || null;
      const alertas = (Array.isArray(body.alertas) ? body.alertas : []) as AlertaIn[];
      if (alertas.length === 0) return NextResponse.json({ tarefas: [] });
      const chaves = new Set(alertas.map((a) => a.key));
      const ctx = (body.contexto && typeof body.contexto === "object" ? body.contexto : {}) as Record<string, unknown>;
      const system = [
        "Você ajuda um ESTRATEGISTA de tráfego pago (Meta Ads) que coordena gestores de tráfego. Ele não mexe nas contas: ele cobra, orienta e confere o trabalho dos gestores e fala com o cliente quando precisa.",
        "Para CADA alerta da lista, sugira 1 ou 2 tarefas práticas pro estrategista fazer hoje.",
        "Regras: português do Brasil, título no imperativo, até 90 caracteres, específico pro alerta (cite o gestor pelo nome quando fizer sentido e os valores do alerta), nada genérico, nada que ele não consiga fazer hoje.",
        "Exemplos de tom: \"Cobrar o João pra pausar os conjuntos com CPA acima de R$ 12\", \"Pedir pro João subir o orçamento pra perto de R$ 90/dia\", \"Avisar o cliente pra colocar saldo na conta (R$ 40 restantes)\", \"Conferir com o João por que a conta está sem otimização há 3 dias\".",
        'Em "alerta", use a key do alerta que a tarefa resolve. No máximo 10 tarefas no total.',
        'Responda só JSON: {"tarefas":[{"titulo":"...","alerta":"..."}]}',
      ].join("\n");
      const userMsg = [
        `Cliente: ${cliente}${responsavel ? ` · gestor responsável: ${responsavel}` : " · sem gestor definido"}`,
        `Números: ${Object.entries(ctx)
          .filter(([, v]) => v != null && v !== "")
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ") || "—"}`,
        "Alertas:",
        ...alertas.map((a) => `- key=${a.key} · ${a.titulo}: ${a.detalhe}`),
      ].join("\n");
      const r = await llmJson<{ tarefas?: Array<{ titulo?: string; alerta?: string }> }>(system, userMsg, { temperature: 0.4, maxTokens: 1200 });
      const tarefas = (r.tarefas ?? [])
        .map((t) => ({ titulo: String(t.titulo ?? "").trim().slice(0, 200), alerta: chaves.has(String(t.alerta ?? "")) ? String(t.alerta) : "" }))
        .filter((t) => t.titulo)
        .slice(0, 10);
      return NextResponse.json({ tarefas });
    }

    if (action === "criar") {
      const conta = norm(String(body.ad_account_id ?? ""));
      if (!conta) throw new Error("Cliente não informado.");
      const lista = (Array.isArray(body.tarefas) ? body.tarefas : []) as Array<{ titulo?: string; alerta?: string }>;
      const tarefas = lista.map((t) => ({ titulo: String(t.titulo ?? "").trim().slice(0, 200), alerta: String(t.alerta ?? "") })).filter((t) => t.titulo).slice(0, 15);
      if (tarefas.length === 0) throw new Error("Escolha pelo menos uma tarefa.");
      const cpaHoje = body.cpaHoje === "inf" ? Infinity : typeof body.cpaHoje === "number" ? body.cpaHoje : null;
      const hoje = calendarSP().today;
      const rows = tarefas.map((t, i) => ({
        user_id: user.id,
        titulo: t.titulo,
        descricao: "Sugerida pela IA a partir do alerta.",
        tipo: "alerta",
        ad_account_id: conta,
        client_name: String(body.client_name ?? "").slice(0, 200) || conta,
        responsavel: String(body.responsavel ?? "").trim() || null,
        data: hoje,
        ordem: Date.now() / 1e6 + i,
        origem_key: origemKey(t.alerta, cpaHoje),
      }));
      const { data, error } = await supabase.from("estr_tarefas").insert(rows).select(COLS);
      if (error) throw new Error(semTabela(error.message) ? "Rode o SQL supabase/migrations/0047_demandas.sql no Supabase." : error.message);
      return NextResponse.json({ ok: true, tarefas: data ?? [] });
    }

    if (action === "narrar") {
      const texto = String(body.texto ?? "").trim().slice(0, 3000);
      if (!texto) throw new Error("Narre ou escreva a tarefa.");
      const conta = norm(String(body.ad_account_id ?? ""));
      if (!conta) throw new Error("Cliente não informado.");
      const cliente = String(body.client_name ?? "").slice(0, 200);
      const responsavel = String(body.responsavel ?? "").trim() || null;
      const alertas = (Array.isArray(body.alertas) ? body.alertas : []) as AlertaIn[];
      const chaves = new Set(alertas.map((a) => a.key));
      const cpaHoje = body.cpaHoje === "inf" ? Infinity : typeof body.cpaHoje === "number" ? body.cpaHoje : null;

      let tarefas: Array<{ titulo: string; alerta: string }> = [];
      if (body.semIa === true) {
        tarefas = [{ titulo: texto.slice(0, 200), alerta: alertas.length === 1 ? alertas[0].key : "" }];
      } else {
        const system = [
          "Você ajuda um estrategista de tráfego pago (Meta Ads) a anotar tarefas.",
          "Transforme a narração dele em tarefas curtas e objetivas, em português do Brasil.",
          "Regras: título no imperativo, até 90 caracteres, sem inventar nada que ele não disse; mantenha nomes (gestor, cliente) e valores citados.",
          "Se a narração tiver mais de uma tarefa, separe (no máximo 5). Se for uma só, devolva uma só.",
          'Em "alerta", coloque a chave (key) do alerta da lista que a tarefa resolve; se nenhum combinar, "".',
          'Responda só JSON: {"tarefas":[{"titulo":"...","alerta":"..."}]}',
        ].join("\n");
        const userMsg = [
          `Cliente: ${cliente}${responsavel ? ` · gestor responsável: ${responsavel}` : ""}`,
          "Alertas do cliente agora:",
          ...(alertas.length ? alertas.map((a) => `- key=${a.key} · ${a.titulo}: ${a.detalhe}`) : ["- (nenhum)"]),
          "",
          `Narração: """${texto}"""`,
        ].join("\n");
        const r = await llmJson<{ tarefas?: Array<{ titulo?: string; alerta?: string }> }>(system, userMsg, { temperature: 0.2, maxTokens: 800 });
        tarefas = (r.tarefas ?? [])
          .map((t) => ({ titulo: String(t.titulo ?? "").trim().slice(0, 200), alerta: chaves.has(String(t.alerta ?? "")) ? String(t.alerta) : "" }))
          .filter((t) => t.titulo)
          .slice(0, 5);
        if (tarefas.length === 0) tarefas = [{ titulo: texto.slice(0, 200), alerta: "" }];
      }

      const hoje = calendarSP().today;
      const rows = tarefas.map((t, i) => ({
        user_id: user.id,
        titulo: t.titulo,
        descricao: texto,
        tipo: "alerta",
        ad_account_id: conta,
        client_name: cliente || conta,
        responsavel,
        data: hoje,
        ordem: Date.now() / 1e6 + i,
        origem_key: origemKey(t.alerta, cpaHoje),
      }));
      const { data, error } = await supabase.from("estr_tarefas").insert(rows).select(COLS);
      if (error) throw new Error(semTabela(error.message) ? "Rode o SQL supabase/migrations/0047_demandas.sql no Supabase." : error.message);
      return NextResponse.json({ ok: true, tarefas: data ?? [] });
    }

    const id = String(body.id ?? "");
    if (!id) throw new Error("Tarefa não informada.");

    if (action === "concluir") {
      const patch: Record<string, unknown> = { status: "feita", done_at: now, updated_at: now };
      if (typeof body.nota === "string" && body.nota.trim()) {
        const { data: cur } = await supabase.from("estr_tarefas").select("descricao").eq("id", id).eq("user_id", user.id).maybeSingle();
        patch.descricao = `${String(cur?.descricao ?? "").trim()}\n${body.nota.trim()}`.trim().slice(0, 4000);
      }
      const { error } = await supabase.from("estr_tarefas").update(patch).eq("id", id).eq("user_id", user.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (action === "reabrir") {
      const { error } = await supabase.from("estr_tarefas").update({ status: "aberta", done_at: null, updated_at: now }).eq("id", id).eq("user_id", user.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (action === "excluir") {
      const { error } = await supabase.from("estr_tarefas").update({ status: "excluida", updated_at: now }).eq("id", id).eq("user_id", user.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    throw new Error("Ação desconhecida.");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
