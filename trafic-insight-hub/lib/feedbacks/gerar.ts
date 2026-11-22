// Etapa 330: feedback automático pelos números (sem print). Junta tudo o que o Hub sabe da conta — volume do período
// × o período anterior, hoje até agora, se já foi otimizada hoje, temperatura do cliente, conta sensível, prioridade (e
// se ela subiu ou desceu), últimos feedbacks, plano de ação, dia da semana / feriado — e a IA escreve DUAS coisas:
//   1. o feedback pro cliente: nada técnico, foco em volume (custo só como retorno nas contas boas), ~60 s;
//   2. o plano de ação objetivo ("fazer isso, isso e isso") pra anotar e, se precisar, mandar pro cliente.
import type { SupabaseClient } from "@supabase/supabase-js";
import { llmJson } from "@/lib/ai/llm";
import { calendarSP } from "@/lib/estrategia/calc";
import { proximoFeriado, feriadoEm } from "@/lib/estrategia/feriados";
import { direcao, PRIORIDADE_HIST_KEY, type HistPrioridade } from "@/lib/estrategia/prioridade-hist";
import { readStoredDaysMany } from "@/lib/meta/daily-store";
import { activitiesForAccounts } from "@/lib/estrategia/activities";

export type Temperatura = "tranquilo" | "atento" | "reclamando";
export interface ContextoCliente {
  temperatura?: Temperatura;
  retorno?: string; // ROAS / vendas que o cliente informou (texto livre)
  obs?: string;
  at?: string;
}
export const FEEDBACK_CONTEXTO_KEY = "feedback_contexto";

export interface GerarInput {
  adAccountId: string;
  dias: 2 | 3 | 7;
  pontos?: string;
  personalizacao?: string; // Etapa 334: instrução livre só desta vez (ex.: "última semana do mês")
  prints?: string[]; // Etapa 334: prints do resultado (data URLs) — a IA lê os números deles
  hoje?: { spend: number; results: number } | null; // vem do Acompanhamento (última atualização)
  token?: string | null; // Meta, pra ver se já otimizou hoje
}
export interface GerarResult {
  feedback: string;
  plano: string;
  resumoDados: string; // o que foi passado pra IA (aparece pequeno na tela, pra conferir)
}

const norm = (id: string) => String(id).replace(/^act_/, "");
const addDias = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const DIA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const ddmm = (ymd: string) => ymd.slice(8, 10) + "/" + ymd.slice(5, 7);
const PRIO_LABEL: Record<string, string> = { inauguracao: "Inauguração", critica: "Crítica", alta: "Alta", media: "Média", baixa: "Baixa" };

function momento(hoje: string, daysInMonth: number): string {
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay();
  const dia = Number(hoje.slice(8, 10));
  const linhas: string[] = [`Hoje é ${DIA_SEMANA[dow]}, ${ddmm(hoje)}.`];
  const fer = feriadoEm(hoje);
  const prox = proximoFeriado(hoje, 2);
  if (fer) linhas.push(`Hoje é feriado (${fer}).`);
  if (prox) {
    linhas.push(
      `Véspera de feriado (${prox.nome} ${prox.emDias === 1 ? "amanhã" : "depois de amanhã"}): tom de ACELERAR — estamos colocando os testes novos pra rodar agora, pra aproveitar o movimento do feriado.`,
    );
  }
  if (dow === 1) linhas.push("Segunda-feira: o fim de semana costuma ser mais fraco. Tom: já estamos otimizando rápido pra semana render.");
  else if (dow === 2) linhas.push("Terça-feira: mostrar que estamos acompanhando de perto os ajustes feitos no começo da semana.");
  else if (dow === 3) linhas.push("Quarta-feira: tom de ACELERAR os testes agora pra chegar no fim de semana com os melhores anúncios rodando.");
  else if (dow === 4) linhas.push("Quinta-feira: preparando o fim de semana; os testes da semana estão sendo avaliados e o que funciona ganha força.");
  else if (dow === 5) linhas.push("Sexta-feira: deixar tudo pronto pro fim de semana, com força no que está trazendo mais gente.");
  else linhas.push("Fim de semana: mensagem leve, mostrando que seguimos acompanhando mesmo no fim de semana.");
  if (dia <= 5) linhas.push("Começo de mês: mês novo, verba renovada e espaço pra testar as promoções do mês.");
  else if (dia >= daysInMonth - 4) linhas.push("Reta final do mês: aproveitar bem os últimos dias.");
  return linhas.join("\n");
}

const SYSTEM = `Você é o estrategista de tráfego pago de uma agência e escreve para o grupo de WhatsApp do cliente (dono de loja).
Responda SOMENTE em JSON: {"feedback": "...", "plano": "..."}.

FEEDBACK — o texto que vai pro grupo do cliente
Objetivo: mostrar que estamos acompanhando de perto, com cuidado e carinho pelo resultado dele. Tem que soar HUMANO, caloroso,
próximo, como um parceiro conversando — nunca seco, frio, robótico ou de relatório. Quando a conta está mal: empatia + senso de
urgência + mostrar que já estamos agindo. Quando está bem: animação e confiança.

Como escrever (siga à risca):
- Abra com uma saudação calorosa pro grupo, de acordo com o horário e o dia ("Bom dia turma, excelente semana para todos.",
  "Boa tarde pessoal, tudo certo por aí?"). Pode situar o momento ("Estamos entrando na reta final do mês.").
- Conte o que você viu de um jeito qualitativo, como gente fala: "tivemos uma queda considerável na semana passada",
  "o movimento deu uma boa melhorada", "a semana começou mais devagar". NÃO despeje números: nada de "caiu de 147 para 67",
  nada de "hoje só 6 até agora", nada de porcentagem. No máximo UM número, e só se for notícia boa (ex.: "já são 40 pessoas chamando essa semana").
- Diga o que já fizemos, de forma humana e sem contar ajustes: "subimos mais testes no sábado", "hoje cedo o gestor de conta já deu
  uma boa otimizada". NUNCA diga quantos ajustes foram feitos.
- Diga o próximo passo em 1 frase simples, por exemplo: "Vamos focar em recuperar o volume rápido, reforçando o que ainda traz conversas e
  pausando o que não tem resultado."
- Feche com uma frase de compromisso e cuidado, por exemplo: "Estamos empenhados em agir rápido agora para melhorar o fluxo de mensagens."
- Português do Brasil, frases curtas, de conversa. NO MÁXIMO 110 palavras (cabe em 60 segundos). Pode quebrar em 3–5 linhas curtas.
- NADA técnico nem de marketing: proibido CPL, CPA, CPM, CTR, ROAS, "lead", "criativo", "conjunto", "campanha", "público",
  "segmentação", "algoritmo", "métricas", "otimização de lance". Use "pessoas chamando no WhatsApp", "conversas", "mensagens",
  "anúncios", "vídeos", "região", "investimento".
- Foco no VOLUME de conversas. Nunca fale de custo por contato. Só em conta BOA pode falar de retorno, em linguagem simples, e só se o
  cliente informou o retorno — nunca invente.
- Siga o MOMENTO (dia da semana, feriado, mês), o TOM e, acima de tudo, a PERSONALIZAÇÃO e os PONTOS DE ATENÇÃO do estrategista.
- Não repita frases dos últimos feedbacks. Não invente fatos: só o que está nos dados, nos prints ou no que o estrategista disse.
- Sem títulos, sem listas, sem negrito; no máximo 1 emoji (ou nenhum).

Exemplo do jeito certo (estilo, não copie o conteúdo):
"""
Bom dia turma, excelente semana para todos.
Estamos entrando na reta final do mês.
Dei uma olhada aqui nos seus anúncios, e tivemos uma queda considerável na semana passada. Mas subimos mais testes no sábado, e hoje cedo o gestor de conta já deu uma boa otimizada.
Vamos focar em recuperar o volume rápido, reforçando o que ainda traz conversas e pausando o que não tem resultado.
Estamos empenhados em agir rápido agora para melhorar o fluxo de mensagens.
"""
Exemplo do jeito ERRADO (seco e técnico — nunca escreva assim):
"""
Vi que os contatos caíram para 67 nos últimos 7 dias, bem abaixo dos 147 anteriores, e hoje só 6 até agora. Já fizemos 11 ajustes nos anúncios hoje.
"""

PLANO — plano de ação objetivo (pra anotar e, se precisar, mandar pro cliente)
- Primeira linha exatamente: "*Plano de ação* 📋"
- Depois 3 a 5 itens numerados ("1. ", "2. "…), um por linha, começando com verbo no infinitivo, curtos e concretos
  ("Pausar os anúncios que estão trazendo poucas conversas", "Subir 2 vídeos novos da promoção até terça").
- Pode indicar quem faz ("Cliente: enviar fotos novas da loja"). Linguagem simples, sem jargão. Nunca prometa resultado nem número.
- Priorize os pontos de atenção do estrategista e o plano já anotado; complete com ações que fazem sentido pros números.`;

export async function gerarFeedbackIA(db: SupabaseClient, userId: string, input: GerarInput): Promise<GerarResult> {
  const acc = norm(input.adAccountId);
  const cal = calendarSP();
  const hoje = cal.today;
  const ontem = addDias(hoje, -1);
  const n = input.dias;
  const iniAtual = addDias(hoje, -n);
  const iniAnt = addDias(hoje, -2 * n);
  const fimAnt = addDias(hoje, -n - 1);

  const [{ data: bind }, { data: prefRows }, { data: fbs }, stored] = await Promise.all([
    db.from("account_bindings").select("client_name, cpa_target, monthly_investment, priority").eq("user_id", userId).in("ad_account_id", [acc, `act_${acc}`]).limit(1).maybeSingle(),
    db
      .from("user_ui_prefs")
      .select("pref_key, pref_value")
      .eq("user_id", userId)
      .in("pref_key", ["contas_sensiveis", FEEDBACK_CONTEXTO_KEY, "notas_clientes", PRIORIDADE_HIST_KEY, "feedback_modelos"]),
    db
      .from("client_feedbacks")
      .select("resumo, sent_at, created_at, status")
      .eq("user_id", userId)
      .in("ad_account_id", [acc, `act_${acc}`])
      .not("resumo", "is", null)
      .order("created_at", { ascending: false })
      .limit(3),
    readStoredDaysMany([acc], iniAnt, ontem),
  ]);
  const pref = (k: string) => prefRows?.find((r) => r.pref_key === k)?.pref_value as unknown;
  const sensivel = !!((pref("contas_sensiveis") ?? {}) as Record<string, boolean>)[acc];
  const ctx = (((pref(FEEDBACK_CONTEXTO_KEY) ?? {}) as Record<string, ContextoCliente>)[acc] ?? {}) as ContextoCliente;
  const notas = ((((pref("notas_clientes") ?? {}) as Record<string, Array<{ texto: string; at: string }>>)[acc]) ?? []).slice(0, 2);
  const hist = (((pref(PRIORIDADE_HIST_KEY) ?? {}) as HistPrioridade)[acc] ?? []).filter((m) => Date.now() - Date.parse(m.em) < 10 * 86400_000);
  const modelos = typeof pref("feedback_modelos") === "string" ? (pref("feedback_modelos") as string) : "";

  const cliente = ((bind?.client_name as string | undefined) ?? "").trim() || acc;
  const ideal = bind?.cpa_target != null ? Number(bind.cpa_target) : null;
  const prio = (bind?.priority as string | null) ?? null;

  // números: dias fechados do backup
  const dias = stored.get(acc) ?? new Map();
  const soma = (de: string, ate: string) => {
    let spend = 0;
    let results = 0;
    let got = 0;
    for (let d = de; d <= ate; d = addDias(d, 1)) {
      const r = dias.get(d);
      if (r) {
        spend += r.spend;
        results += r.results;
        got++;
      }
    }
    return { spend, results, got };
  };
  const atual = soma(iniAtual, ontem);
  const ant = soma(iniAnt, fimAnt);
  const porDia: string[] = [];
  for (let d = iniAtual; d <= ontem; d = addDias(d, 1)) {
    const r = dias.get(d);
    const dow = DIA_SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()];
    porDia.push(`${dow} ${ddmm(d)}: ${r ? `${Math.round(r.results)} contatos` : "sem dado"}`);
  }
  const varVol = ant.results > 0 ? ((atual.results - ant.results) / ant.results) * 100 : null;
  const cpaAtual = atual.results > 0 ? atual.spend / atual.results : null;
  let situacao = "sem meta de custo cadastrada (avalie só pelo volume)";
  let boa = false;
  if (ideal != null && cpaAtual != null) {
    if (cpaAtual <= ideal) {
      situacao = "BOA (dentro da meta)";
      boa = true;
    } else if (cpaAtual <= ideal + 4) situacao = "ATENÇÃO (um pouco acima da meta)";
    else situacao = "RUIM (bem acima da meta)";
  } else if (ideal != null && atual.spend > 0 && atual.results === 0) situacao = "RUIM (investiu e ninguém chamou)";

  // já otimizou hoje? (alterações feitas por pessoas hoje, fora o Hub e a própria Meta)
  let otimHoje = "não deu pra verificar";
  if (input.token) {
    try {
      const { byAccount } = await activitiesForAccounts(input.token, [acc]);
      const hojeAt = (byAccount[acc] ?? []).filter((a) => a.relevant && calendarSP(new Date(a.time)).today === hoje);
      otimHoje = hojeAt.length
        ? `SIM, o gestor de conta já mexeu na conta hoje (não diga quantos ajustes): ${[...new Set(hojeAt.map((a) => a.what))].slice(0, 4).join("; ")}`
        : "ainda não teve ajuste hoje";
    } catch {
      /* segue sem */
    }
  }

  // tom
  const tom: string[] = [];
  if (sensivel) tom.push("Conta SENSÍVEL: aumente o tom de preocupação e urgência, mostre que é prioridade nossa.");
  if (ctx.temperatura === "reclamando") tom.push("Cliente RECLAMANDO: mais empatia (reconheça a frustração), mais concreto no que estamos fazendo e no próximo passo.");
  else if (ctx.temperatura === "atento") tom.push("Cliente ATENTO/cobrando: mostre acompanhamento próximo e ações claras.");
  else if (ctx.temperatura === "tranquilo") tom.push("Cliente tranquilo: tom leve, próximo e confiante.");
  if (prio === "critica") tom.push("Prioridade CRÍTICA: urgência alta.");
  else if (prio === "alta") tom.push("Prioridade ALTA: urgência moderada.");
  else if (prio === "inauguracao") tom.push("Loja em INAUGURAÇÃO: entusiasmo e cuidado redobrado.");
  const mud = hist[0];
  if (mud) {
    const dir = direcao(mud);
    const quando = ddmm(calendarSP(new Date(mud.em)).today);
    if (dir === "subiu") tom.push(`A prioridade SUBIU em ${quando} (${PRIO_LABEL[mud.de ?? ""] ?? "—"} → ${PRIO_LABEL[mud.para ?? ""] ?? "—"}): a conta piorou — mais urgência e ação.`);
    else if (dir === "desceu") tom.push(`A prioridade DESCEU em ${quando} (${PRIO_LABEL[mud.de ?? ""] ?? "—"} → ${PRIO_LABEL[mud.para ?? ""] ?? "—"}): a conta melhorou — tom mais calmo e animador, celebrando a melhora sem baixar a guarda.`);
  }
  if (!tom.length) tom.push("Tom padrão: próximo, atento e confiante.");

  const hora = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }).format(new Date()));
  const dados = [
    `Cliente: ${cliente}`,
    `Período analisado: últimos ${n} dias fechados (${ddmm(iniAtual)} a ${ddmm(ontem)})${atual.got < n ? ` — só ${atual.got} dia(s) com dado` : ""}.`,
    `(USO INTERNO — não cite esses números no feedback) Contatos no período: ${Math.round(atual.results)} | ${n} dias anteriores: ${Math.round(ant.results)}${varVol != null ? ` (${varVol > 0 ? "+" : ""}${varVol.toFixed(0)}%)` : ""}.`,
    `Dia a dia: ${porDia.join(" · ")}.`,
    input.hoje ? `Hoje até agora: ${Math.round(input.hoje.results)} contatos.` : "",
    `Situação da conta (USO INTERNO, não citar custo): ${situacao}${cpaAtual != null && ideal != null ? ` — custo ${brl(cpaAtual)} x meta ${brl(ideal)}` : ""}.`,
    `Prioridade atual: ${prio ? (PRIO_LABEL[prio] ?? prio) : "sem prioridade"}${sensivel ? " · conta sensível" : ""}.`,
    `Já otimizamos hoje? ${otimHoje}.`,
    boa && ctx.retorno ? `Retorno informado pelo cliente: ${ctx.retorno}` : "",
    ctx.obs ? `Observações sobre o cliente: ${ctx.obs}` : "",
  ].filter(Boolean);

  const userMsg = [
    `Agora são ${hora}h.`,
    "",
    "MOMENTO:",
    momento(hoje, cal.daysInMonth),
    "",
    "TOM:",
    tom.join("\n"),
    "",
    "DADOS:",
    dados.join("\n"),
    "",
    input.personalizacao?.trim() ? `PERSONALIZAÇÃO DESTE FEEDBACK (siga com prioridade máxima):\n"""${input.personalizacao.trim().slice(0, 800)}"""\n` : "",
    input.pontos?.trim() ? `PONTOS DE ATENÇÃO DO ESTRATEGISTA (prioridade máxima):\n"""${input.pontos.trim().slice(0, 1500)}"""\n` : "",
    input.prints?.length
      ? "PRINTS ANEXOS: são do Gerenciador de Anúncios. Leia neles como está o movimento (pra entender se melhorou ou piorou). Eles valem mais que os DADOS acima se houver diferença. Continue sem citar números técnicos.\n"
      : "",
    notas.length ? `PLANO DE AÇÃO JÁ ANOTADO (mais recente primeiro):\n${notas.map((x) => `- ${ddmm(calendarSP(new Date(x.at)).today)}: ${x.texto.slice(0, 500)}`).join("\n")}\n` : "",
    (fbs ?? []).length
      ? `ÚLTIMOS FEEDBACKS JÁ MANDADOS (não repita):\n${(fbs ?? []).map((f) => `- ${ddmm(String(f.sent_at ?? f.created_at).slice(0, 10))}: ${String(f.resumo).slice(0, 400)}`).join("\n")}\n`
      : "",
    modelos.trim() ? `JEITO DE ESCREVER DO ESTRATEGISTA (copie só o estilo; ignore qualquer menção a custo por lead):\n"""${modelos.trim().slice(0, 1500)}"""` : "",
  ]
    .filter((x) => x !== "")
    .join("\n");

  const r = await llmJson<{ feedback?: string; plano?: string }>(SYSTEM, userMsg, { temperature: 0.8, images: input.prints });
  const feedback = String(r.feedback ?? "").trim();
  if (!feedback) throw new Error("A IA não escreveu o feedback. Tente de novo.");
  return { feedback, plano: String(r.plano ?? "").trim(), resumoDados: [...dados, ...tom, input.personalizacao?.trim() ? `Personalização: ${input.personalizacao.trim()}` : "", input.prints?.length ? `${input.prints.length} print(s) lido(s) pela IA` : ""].filter(Boolean).join("\n") };
}
