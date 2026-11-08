import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { calendarSP } from "@/lib/estrategia/calc";
import { loadCarteira } from "@/lib/estrategia/auditorias/run";
import { ROTINA_COLS, TAREFA_COLS, addDaysYmd, gerarRotinas, type Rotina, type Tarefa } from "@/lib/estrategia/demandas";
import { resolveClientGroup } from "@/lib/feedbacks/core";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";

// Etapa 286: quadro Demandas.
//   GET  (?from&to)        → tarefas do período (+ abertas atrasadas), rotinas, clientes e gestores. Gera as tarefas das rotinas antes.
//   GET  ?resumo=1         → quantas tarefas abertas cada conta tem (pro Tráfego mostrar)
//   GET  ?grupo=<conta>    → grupo do WhatsApp do cliente
//   POST { action, ... }   → criar · atualizar · mover · concluir · excluir · rotina_salvar · rotina_excluir ·
//                            feedbacks_programar · mensagem
export const maxDuration = 60;

const norm = (id: string) => String(id ?? "").replace(/^act_/, "").trim();
const flat = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const isYmd = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const toWhats = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d && !d.startsWith("55") && d.length <= 11 ? `55${d}` : d;
};
const semTabela = (msg: string) => /estr_tarefas|estr_rotinas/.test(msg);

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const qs = new URL(request.url).searchParams;
    const hoje = calendarSP().today;

    if (qs.get("grupo")) {
      const g = await resolveClientGroup(supabase, user.id, norm(qs.get("grupo") as string));
      return NextResponse.json({ grupo: g });
    }

    if (qs.get("resumo") === "1") {
      const { data, error } = await supabase
        .from("estr_tarefas")
        .select("ad_account_id, data")
        .eq("user_id", user.id)
        .eq("status", "aberta")
        .lte("data", addDaysYmd(hoje, 6))
        .not("ad_account_id", "is", null);
      if (error) return NextResponse.json({ porConta: {}, semTabela: semTabela(error.message) });
      const porConta: Record<string, { abertas: number; atrasadas: number }> = {};
      for (const t of data ?? []) {
        const k = norm(t.ad_account_id as string);
        const c = (porConta[k] ??= { abertas: 0, atrasadas: 0 });
        c.abertas++;
        if ((t.data as string) < hoje) c.atrasadas++;
      }
      return NextResponse.json({ porConta });
    }

    const from = isYmd(qs.get("from")) ? (qs.get("from") as string) : hoje;
    const to = isYmd(qs.get("to")) ? (qs.get("to") as string) : addDaysYmd(from, 6);
    const carteira = await loadCarteira(supabase, user.id);
    try {
      await gerarRotinas(supabase, user.id, from < hoje ? hoje : from, to, carteira);
    } catch {
      /* sem tabela ainda: o select abaixo avisa */
    }
    const [noPeriodo, atrasadas, rotinas, gRow, fbAbertos, sensRow] = await Promise.all([
      supabase.from("estr_tarefas").select(TAREFA_COLS).eq("user_id", user.id).gte("data", from).lte("data", to).neq("status", "excluida").limit(3000),
      supabase.from("estr_tarefas").select(TAREFA_COLS).eq("user_id", user.id).lt("data", from).eq("status", "aberta").limit(1000),
      supabase.from("estr_rotinas").select(ROTINA_COLS).eq("user_id", user.id).order("created_at", { ascending: true }),
      supabase.from("user_ui_prefs").select("pref_value").eq("user_id", user.id).eq("pref_key", "gestores").maybeSingle(),
      supabase.from("estr_tarefas").select("ad_account_id").eq("user_id", user.id).eq("tipo", "feedback").eq("status", "aberta"),
      supabase.from("user_ui_prefs").select("pref_value").eq("user_id", user.id).eq("pref_key", "contas_sensiveis").maybeSingle(),
    ]);
    const sens = (sensRow.data?.pref_value && typeof sensRow.data.pref_value === "object" ? sensRow.data.pref_value : {}) as Record<string, boolean>;
    if (noPeriodo.error) {
      if (semTabela(noPeriodo.error.message)) return NextResponse.json({ semTabela: true, tarefas: [], rotinas: [], clientes: [], gestores: [], semFeedback: [], hoje, from, to });
      throw noPeriodo.error;
    }
    const gestoresCad = (Array.isArray(gRow.data?.pref_value) ? gRow.data.pref_value : []) as Array<{ name?: string }>;
    const gestores = [...new Set([...gestoresCad.map((g) => String(g?.name ?? "").trim()), ...carteira.map((a) => a.responsible ?? "")].filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );
    return NextResponse.json({
      hoje,
      from,
      to,
      tarefas: [...((atrasadas.data ?? []) as Tarefa[]), ...((noPeriodo.data ?? []) as Tarefa[])],
      rotinas: (rotinas.data ?? []) as Rotina[],
      // Etapa 287: prioridade (Asana) e conta sensível, pra mostrar nos cartões
      clientes: carteira.map((a) => ({ id: a.id, name: a.name, responsible: a.responsible, priority: a.priority, sensivel: !!(sens[a.id] || sens[`act_${a.id}`]) })),
      gestores,
      // clientes sem feedback programado (nenhuma tarefa de feedback aberta, em qualquer dia)
      semFeedback: (() => {
        const com = new Set((fbAbertos.data ?? []).map((t) => norm(String(t.ad_account_id ?? ""))));
        return carteira.filter((a) => !com.has(a.id)).map((a) => a.id);
      })(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const hoje = calendarSP().today;
    const action = String(body.action ?? "");

    // cria uma tarefa por conta (com o gestor da conta) — ou uma sem cliente
    if (action === "criar" || action === "feedbacks_programar") {
      const titulo = String(body.titulo ?? (action === "feedbacks_programar" ? "Feedback do cliente" : "")).trim().slice(0, 200);
      if (!titulo) throw new Error("Dê um título pra tarefa.");
      const data = isYmd(body.data) ? (body.data as string) : hoje;
      const contas = (Array.isArray(body.contas) ? body.contas : []).map((c) => norm(String(c))).filter(Boolean);
      const carteira = contas.length ? await loadCarteira(supabase, user.id) : [];
      const byId = new Map(carteira.map((a) => [a.id, a]));
      const tipo = action === "feedbacks_programar" ? "feedback" : body.tipo === "feedback" ? "feedback" : "manual";
      const base = { user_id: user.id, titulo, descricao: String(body.descricao ?? "").slice(0, 4000), tipo, data, ordem: Date.now() / 1e6 };
      const rows: Array<Record<string, unknown>> = contas.length
        ? contas.map((id) => ({ ...base, ad_account_id: id, client_name: byId.get(id)?.name ?? id, responsavel: byId.get(id)?.responsible ?? null }))
        : [{ ...base, ad_account_id: null, client_name: null, responsavel: String(body.responsavel ?? "").trim() || null }];
      const { data: ins, error } = await supabase.from("estr_tarefas").insert(rows).select("id");
      if (error) throw new Error(semTabela(error.message) ? "Rode o SQL supabase/migrations/0047_demandas.sql no Supabase." : error.message);
      return NextResponse.json({ ok: true, criadas: ins?.length ?? 0 });
    }

    const id = String(body.id ?? "");

    if (action === "atualizar") {
      const patch: Record<string, unknown> = { updated_at: now };
      if (typeof body.titulo === "string") patch.titulo = body.titulo.trim().slice(0, 200) || "Tarefa";
      if (typeof body.descricao === "string") patch.descricao = body.descricao.slice(0, 4000);
      if (isYmd(body.data)) patch.data = body.data;
      if (typeof body.responsavel === "string") patch.responsavel = body.responsavel.trim() || null;
      const { error } = await supabase.from("estr_tarefas").update(patch).eq("id", id).eq("user_id", user.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "mover") {
      if (!isYmd(body.data)) throw new Error("Dia inválido.");
      const { error } = await supabase
        .from("estr_tarefas")
        .update({ data: body.data, ordem: Number(body.ordem ?? 0), updated_at: now })
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "concluir") {
      const feito = body.feito !== false;
      const { data: t, error } = await supabase
        .from("estr_tarefas")
        .update({ status: feito ? "feita" : "aberta", done_at: feito ? now : null, updated_at: now })
        .eq("id", id)
        .eq("user_id", user.id)
        .select(TAREFA_COLS)
        .single();
      if (error) throw error;
      // feedback concluído → já programa o próximo
      if (feito && (t as Tarefa).tipo === "feedback" && isYmd(body.proxima)) {
        const x = t as Tarefa;
        await supabase.from("estr_tarefas").insert({
          user_id: user.id,
          titulo: x.titulo,
          descricao: x.descricao,
          tipo: "feedback",
          ad_account_id: x.ad_account_id,
          client_name: x.client_name,
          responsavel: x.responsavel,
          data: body.proxima,
          ordem: Date.now() / 1e6,
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "excluir") {
      const { error } = await supabase.from("estr_tarefas").update({ status: "excluida", updated_at: now }).eq("id", id).eq("user_id", user.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "rotina_salvar") {
      const r = (body.rotina ?? {}) as Partial<Rotina>;
      const row = {
        user_id: user.id,
        titulo: String(r.titulo ?? "").trim().slice(0, 200),
        descricao: String(r.descricao ?? "").slice(0, 4000),
        alvo: r.alvo === "cliente" || r.alvo === "nenhum" ? r.alvo : "todos",
        ad_account_id: r.alvo === "cliente" ? norm(String(r.ad_account_id ?? "")) || null : null,
        responsavel: r.alvo === "nenhum" ? String(r.responsavel ?? "").trim() || null : null,
        frequencia: r.frequencia === "diaria" || r.frequencia === "mensal" ? r.frequencia : "semanal",
        dias_semana: (Array.isArray(r.dias_semana) ? r.dias_semana : [1]).map(Number).filter((n) => n >= 0 && n <= 6),
        dia_mes: Math.min(31, Math.max(1, Number(r.dia_mes ?? 1))),
        ativa: r.ativa !== false,
      };
      if (!row.titulo) throw new Error("Dê um título pra rotina.");
      if (row.alvo === "cliente" && !row.ad_account_id) throw new Error("Escolha o cliente da rotina.");
      if (row.frequencia === "semanal" && row.dias_semana.length === 0) throw new Error("Escolha ao menos um dia da semana.");
      const q = r.id
        ? supabase.from("estr_rotinas").update(row).eq("id", r.id).eq("user_id", user.id)
        : supabase.from("estr_rotinas").insert(row);
      const { error } = await q;
      if (error) throw new Error(semTabela(error.message) ? "Rode o SQL supabase/migrations/0047_demandas.sql no Supabase." : error.message);
      // mudou a rotina: as tarefas futuras ainda abertas dela saem (o quadro gera de novo, já com a regra nova)
      if (r.id) {
        await supabase
          .from("estr_tarefas")
          .update({ status: "excluida", origem_key: null, updated_at: now })
          .eq("user_id", user.id)
          .eq("rotina_id", r.id)
          .eq("status", "aberta")
          .gt("data", hoje);
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "rotina_excluir") {
      await supabase.from("estr_tarefas").update({ status: "excluida", updated_at: now }).eq("user_id", user.id).eq("rotina_id", id).eq("status", "aberta").gte("data", hoje);
      const { error } = await supabase.from("estr_rotinas").delete().eq("id", id).eq("user_id", user.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "mensagem") {
      const text = String(body.text ?? "").trim().slice(0, 4000);
      if (!text) throw new Error("Escreva a mensagem.");
      const destino = String(body.destino ?? "");
      let to = "";
      if (destino === "grupo") to = String(body.groupId ?? "");
      else if (destino === "cliente") {
        const g = await resolveClientGroup(supabase, user.id, norm(String(body.ad_account_id ?? "")));
        if (!g) throw new Error("Esse cliente não tem grupo de WhatsApp vinculado.");
        to = g.id;
      } else if (destino === "gestor") {
        const { data: gRow } = await supabase.from("user_ui_prefs").select("pref_value").eq("user_id", user.id).eq("pref_key", "gestores").maybeSingle();
        const cad = (Array.isArray(gRow?.pref_value) ? gRow.pref_value : []) as Array<{ name?: string; whatsapp?: string }>;
        const hit = cad.find((g) => g?.name && flat(g.name) === flat(String(body.gestor ?? "")));
        to = toWhats(String(hit?.whatsapp ?? ""));
        if (to.length < 12) throw new Error("Esse gestor não tem WhatsApp cadastrado em Gestores.");
      }
      if (!to) throw new Error("Escolha pra quem enviar.");
      const inst = await requireWhatsappInstance(supabase, user.id);
      await sendText({ api_url: inst.api_url, token: inst.token }, to, text);
      return NextResponse.json({ ok: true });
    }

    throw new Error("Ação desconhecida.");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
