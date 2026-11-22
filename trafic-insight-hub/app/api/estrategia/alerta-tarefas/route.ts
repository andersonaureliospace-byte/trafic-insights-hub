import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { calendarSP } from "@/lib/estrategia/calc";
import { llmJson } from "@/lib/ai/llm";
import { ORIGEM_PREFIX, origemKey } from "@/lib/estrategia/alerta-tarefas";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { CEREBRO_KEY, CEREBRO_PADRAO, ORDEM_PREFIX } from "@/lib/estrategia/cerebro";

// Etapa 341: tarefas do quadro Alertas (Acompanhamento → Alertas).
//   GET                                  → tarefas abertas + as finalizadas hoje
//   POST { action: "narrar", ... }       → a IA transforma a sua narração em tarefa(s) do cliente
//   POST { action: "sugerir", ... }      → a IA sugere 1 ou mais tarefas pra cada alerta (não grava; você escolhe)
//   POST { action: "criar", tarefas }    → grava as tarefas escolhidas (sugeridas pela IA)
//   POST { action: "ordem_gerar", ... }  → Etapa 344: a IA escreve a "ordem" pro gestor (usa o Cérebro e as ordens anteriores)
//   POST { action: "ordem_enviar", ... } → manda a ordem no WhatsApp do gestor (ou só salva) e ela fica pendente até o seu ✓
//   POST { action: "concluir", id, nota? } · { action: "reabrir", id } · { action: "excluir", id }
export const maxDuration = 60;

const COLS = "id, titulo, descricao, ad_account_id, client_name, responsavel, status, done_at, origem_key, created_at";
const norm = (id: string) => String(id ?? "").replace(/^act_/, "").trim();
const semTabela = (m: string) => /estr_tarefas/.test(m);
const flat = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const toWhats = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d && !d.startsWith("55") && d.length <= 11 ? `55${d}` : d;
};
type Db = Awaited<ReturnType<typeof requireUser>>["supabase"];
async function lerCerebro(supabase: Db, userId: string): Promise<string> {
  const { data } = await supabase.from("user_ui_prefs").select("pref_value").eq("user_id", userId).eq("pref_key", CEREBRO_KEY).maybeSingle();
  const v = data?.pref_value;
  return typeof v === "string" && v.trim() ? v.trim() : CEREBRO_PADRAO;
}
const fmtData = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const hoje = calendarSP().today;
    const desde = `${hoje}T03:00:00.000Z`; // 00h de hoje em Brasília
    const [abertas, feitas, ordens] = await Promise.all([
      supabase.from("estr_tarefas").select(COLS).eq("user_id", user.id).eq("tipo", "alerta").eq("status", "aberta").like("origem_key", `${ORIGEM_PREFIX}%`).limit(1000),
      supabase.from("estr_tarefas").select(COLS).eq("user_id", user.id).eq("tipo", "alerta").eq("status", "feita").like("origem_key", `${ORIGEM_PREFIX}%`).gte("done_at", desde).limit(1000),
      // ordens pro gestor: as pendentes (sem o ✓) e as que você deu ✓ hoje
      supabase
        .from("estr_tarefas")
        .select(COLS)
        .eq("user_id", user.id)
        .eq("tipo", "alerta")
        .like("origem_key", `${ORDEM_PREFIX}%`)
        .or(`status.eq.aberta,and(status.eq.feita,done_at.gte.${desde})`)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    if (abertas.error) {
      if (semTabela(abertas.error.message)) return NextResponse.json({ tarefas: [], semTabela: true });
      throw abertas.error;
    }
    return NextResponse.json({ tarefas: [...(abertas.data ?? []), ...(feitas.data ?? [])], ordens: ordens.data ?? [] });
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
      const cerebro = await lerCerebro(supabase, user.id);
      const r = await llmJson<{ tarefas?: Array<{ titulo?: string; alerta?: string }> }>(`${system}\n\nO QUE VOCÊ SABE DESSES CLIENTES (cérebro):\n${cerebro}`, `${userMsg}\n${String(body.extras ?? "")}`, {
        temperature: 0.4,
        maxTokens: 1200,
      });
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

    if (action === "ordem_gerar") {
      const conta = norm(String(body.ad_account_id ?? ""));
      if (!conta) throw new Error("Cliente não informado.");
      const cliente = String(body.client_name ?? "").slice(0, 200);
      const responsavel = String(body.responsavel ?? "").trim() || null;
      const alertas = (Array.isArray(body.alertas) ? body.alertas : []) as AlertaIn[];
      const ctx = (body.contexto && typeof body.contexto === "object" ? body.contexto : {}) as Record<string, unknown>;
      const [cerebro, anteriores] = await Promise.all([
        lerCerebro(supabase, user.id),
        supabase
          .from("estr_tarefas")
          .select("descricao, status, created_at, done_at")
          .eq("user_id", user.id)
          .eq("tipo", "alerta")
          .like("origem_key", `${ORDEM_PREFIX}%`)
          .in("ad_account_id", [conta, `act_${conta}`])
          .neq("status", "excluida")
          .gte("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
      const hist = (anteriores.data ?? []).map(
        (o) => `--- solicitação de ${fmtData(o.created_at as string)} (${o.status === "feita" ? "gestor já deu OK" : "ainda sem OK do gestor"}):\n${String(o.descricao ?? "").slice(0, 900)}`,
      );
      const system = [
        "Você escreve, em nome de um ESTRATEGISTA de tráfego pago, uma SOLICITAÇÃO curta pro gestor de tráfego responsável pela conta, pra ser enviada no WhatsApp.",
        "Formato EXATO (texto puro, sem markdown além do * no começo de cada item):",
        "CONTA: <nome curto da conta, em maiúsculas, sem o nome da franquia se for redundante>",
        "",
        "* <o que precisa fazer + o porquê com o número que mostra o problema>",
        "* <...>",
        "",
        "Quando fizer essas alterações, me dá o OK aqui.",
        "",
        "Regras:",
        "- Português do Brasil, tom direto e de chefe parceiro, frases curtas, sem termos difíceis. Valores arredondados (R$ 36, R$ 1.200).",
        "- Um item por problema; junte alertas parecidos (CPA de 3 dias, 2 dias e ontem viram um item só). No máximo 5 itens.",
        "- Diga O QUE fazer (ex.: otimizar urgente, subir criativos novos, pausar conjuntos caros, aumentar orçamento pra X/dia, trocar o criativo do EXAME), usando as ofertas e o histórico de otimizações quando ajudarem a apontar a provável otimização.",
        "- Se um problema JÁ estava numa solicitação anterior (histórico), escreva como REFORÇO, ex.: \"O investimento do mês ainda está baixo, precisa colocar mais.\" — e se a solicitação anterior ainda está sem OK, cobre isso com educação.",
        "- Não invente números nem fatos que não estão nos dados.",
        'Responda só JSON: {"mensagem":"..."}',
        "",
        "O QUE VOCÊ SABE DESSES CLIENTES (cérebro):",
        cerebro,
      ].join("\n");
      const userMsg = [
        `Conta: ${cliente}${responsavel ? ` · gestor: ${responsavel}` : ""}`,
        `Números: ${
          Object.entries(ctx)
            .filter(([, v]) => v != null && v !== "")
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ") || "—"
        }`,
        `Ofertas: ${String(body.ofertas ?? "") || "sem dados"}`,
        `Últimas otimizações na conta: ${String(body.otimizacoes ?? "") || "sem dados"}`,
        "Alertas de agora:",
        ...(alertas.length ? alertas.map((a) => `- ${a.titulo}: ${a.detalhe}`) : ["- (nenhum)"]),
        "",
        hist.length ? `Solicitações anteriores pra essa conta (mais nova primeiro):\n${hist.join("\n")}` : "Nenhuma solicitação anterior nos últimos 14 dias.",
      ].join("\n");
      const r = await llmJson<{ mensagem?: string }>(system, userMsg, { temperature: 0.4, maxTokens: 1200 });
      const mensagem = String(r.mensagem ?? "").trim();
      if (!mensagem) throw new Error("A IA não escreveu a solicitação. Tente de novo.");
      return NextResponse.json({ mensagem, reforco: hist.length > 0 });
    }

    if (action === "ordem_enviar") {
      const conta = norm(String(body.ad_account_id ?? ""));
      const mensagem = String(body.mensagem ?? "").trim().slice(0, 4000);
      if (!conta || !mensagem) throw new Error("Escreva a solicitação.");
      const responsavel = String(body.responsavel ?? "").trim() || null;
      let enviadoPara: string | null = null;
      if (body.enviar !== false) {
        if (!responsavel) throw new Error("Essa conta não tem gestor responsável. Defina na ficha do cliente.");
        const { data: gRow } = await supabase.from("user_ui_prefs").select("pref_value").eq("user_id", user.id).eq("pref_key", "gestores").maybeSingle();
        const cad = (Array.isArray(gRow?.pref_value) ? gRow.pref_value : []) as Array<{ name?: string; whatsapp?: string }>;
        const hit = cad.find((g) => g?.name && flat(g.name) === flat(responsavel));
        const to = toWhats(String(hit?.whatsapp ?? ""));
        if (to.length < 12) throw new Error(`O gestor ${responsavel} não tem WhatsApp cadastrado em Configurações → Gestores.`);
        const inst = await requireWhatsappInstance(supabase, user.id);
        await sendText({ api_url: inst.api_url, token: inst.token }, to, mensagem);
        enviadoPara = responsavel;
      }
      const keys = (Array.isArray(body.alertas) ? body.alertas : []).map((k) => String(k).replace(/[|,]/g, "")).filter(Boolean);
      const rand = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      const { data, error } = await supabase
        .from("estr_tarefas")
        .insert({
          user_id: user.id,
          titulo: enviadoPara ? `Solicitação enviada pro ${enviadoPara}` : "Solicitação pro gestor (salva sem enviar)",
          descricao: mensagem,
          tipo: "alerta",
          ad_account_id: conta,
          client_name: String(body.client_name ?? "").slice(0, 200) || conta,
          responsavel,
          data: calendarSP().today,
          ordem: Date.now() / 1e6,
          origem_key: `${ORDEM_PREFIX}${rand}|${keys.join(",")}`,
        })
        .select(COLS)
        .single();
      if (error) throw new Error(semTabela(error.message) ? "Rode o SQL supabase/migrations/0047_demandas.sql no Supabase." : error.message);
      return NextResponse.json({ ok: true, ordem: data, enviadoPara });
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
