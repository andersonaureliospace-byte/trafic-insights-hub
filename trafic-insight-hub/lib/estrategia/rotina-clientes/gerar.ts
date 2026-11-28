// Etapa 355: Rotina da manhã — escolhe o cenário de cada cliente, a IA cria uma variação do texto aprovado e o Hub
// deixa a mensagem PRÉ-APROVADA em Feedback → Programado pras 7h50 (fila: sensíveis → reclamando → inauguração →
// críticas → altas → médias → baixas). Se ninguém mexer, sai no horário; dá pra editar ou cancelar até lá.
//   Seg e Qui: todas as contas, pela prioridade nova × a anterior.
//   Ter a Sex: só CPA ruim ontem + críticas, sensíveis e cliente reclamando (+ recuperação e recorde).
//   Sem envio no sábado, domingo e feriado. No máximo 1 mensagem automática por cliente por dia.
import type { SupabaseClient } from "@supabase/supabase-js";
import { llmJson } from "@/lib/ai/llm";
import { calendarSP } from "@/lib/estrategia/calc";
import { feriadoEm, proximoFeriado } from "@/lib/estrategia/feriados";
import { loadCarteira, loadConfig } from "@/lib/estrategia/auditorias/run";
import type { Acc } from "@/lib/estrategia/auditorias/checks";
import { PRIORIDADE_HIST_KEY, type HistPrioridade } from "@/lib/estrategia/prioridade-hist";
import { FEEDBACK_CONTEXTO_KEY, type ContextoCliente } from "@/lib/feedbacks/gerar";
import { readStoredDaysMany } from "@/lib/meta/daily-store";
import { addDaysYmd } from "@/lib/meta/daily-range";
import { resolveClientGroup } from "@/lib/feedbacks/core";
import { gravarAgendados, lerAgendados } from "@/lib/feedbacks/agendados";
import { hojeDaConta } from "@/lib/estrategia/hoje-conta";
import { getUserMetaToken } from "@/lib/current-user";
import { getWhatsappInstance } from "@/lib/whatsapp/instance";
import { sendText } from "@/lib/whatsapp/client";
import { toWhats } from "@/lib/estrategia/auditorias/gestores";
import { CENARIOS, MANTEVE, MUDANCA, SITUACAO, complementoDoDia, fraseFimDeSemana, fraseGestor, montarMensagem, FRASE_DETALHES, FRASE_GESTOR, type Cenario } from "./cenarios";

export const ROTINA_TITULO = "Rotina da manhã";
export const ROTINA_HORA_UTC = "10:50:00.000Z"; // 7h50 em Brasília (UTC-3 o ano todo)

type Estado = "semDado" | "semMeta" | "semConversa" | "muito" | "acima" | "neutro" | "bom";
const RUIM = new Set<Estado>(["semConversa", "muito", "acima"]);
const PESO: Record<string, number> = { baixa: 1, media: 2, alta: 3, critica: 4 };

interface Dia {
  spend: number;
  results: number;
  cpaSpend: number;
}

function estado(d: Dia | undefined, alvo: number | null): Estado {
  if (!d || d.spend <= 0) return "semDado";
  if (alvo == null || alvo <= 0) return "semMeta";
  if (d.results <= 0) return "semConversa";
  const cpa = (d.cpaSpend || d.spend) / d.results;
  if (cpa > alvo + 20) return "muito";
  if (cpa > alvo + 5) return "acima";
  if (cpa <= alvo) return "bom";
  return "neutro";
}

// Etapa 358: o fim de semana caiu bruscamente? (média de conversas de sáb+dom < metade da média de seg–sex anterior)
export const QUEDA_FDS_LIMITE = 0.5;
function domingoAnterior(hoje: string): string {
  const wd = new Date(`${hoje}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return addDaysYmd(hoje, -(wd === 0 ? 7 : wd));
}

export interface Escolha {
  acc: Acc;
  quedaFds?: boolean;
  cenario: number;
  ordem: number; // posição na fila
  motivo: string;
}

// Ordem da fila: sensíveis → cliente reclamando → inauguração → críticas → altas → médias → baixas → sem prioridade
function rank(acc: Acc, sens: boolean, recl: boolean): number {
  if (sens) return 0;
  if (recl) return 1;
  const p = acc.priority ?? "";
  return ({ inauguracao: 2, critica: 3, alta: 4, media: 5, baixa: 6 } as Record<string, number>)[p] ?? 7;
}

export function escolherCenario(input: {
  acc: Acc;
  diaSemana: number; // 1 = segunda … 5 = sexta
  sens: boolean;
  recl: boolean;
  ontem: Estado;
  sequenciaRuim: number; // dias ruins seguidos terminando ontem
  recuperacao: boolean;
  recorde: boolean;
  mudanca: { de: string | null; para: string | null } | null; // reclassificação da madrugada (seg/qui)
}): { n: number; motivo: string } | null {
  const { acc, diaSemana, sens, recl, ontem, sequenciaRuim, mudanca } = input;
  const prio = acc.priority ?? null;
  const ruim = RUIM.has(ontem);
  const bom = ontem === "bom";

  if (diaSemana === 1 || diaSemana === 4) {
    if (prio === "inauguracao") return { n: 17, motivo: "inauguração" };
    if (mudanca && mudanca.de && mudanca.para && PESO[mudanca.de] && PESO[mudanca.para] && mudanca.de !== mudanca.para) {
      const subiu = PESO[mudanca.para] > PESO[mudanca.de];
      if (subiu && bom) return { n: 19, motivo: `${mudanca.de} → ${mudanca.para}, ontem bom` };
      if (!subiu && ruim) return { n: 20, motivo: `${mudanca.de} → ${mudanca.para}, ontem ruim` };
      const n = MUDANCA[`${mudanca.de}>${mudanca.para}`];
      if (n) return { n, motivo: `${mudanca.de} → ${mudanca.para}` };
    }
    if (prio && MANTEVE[prio]) return { n: MANTEVE[prio], motivo: `manteve ${prio}` };
    return { n: 18, motivo: "sem prioridade" };
  }

  // Ter a Sex
  const crit = prio === "critica";
  if (crit || sens || recl) {
    if (crit && sens) return { n: 34, motivo: "crítica + sensível" };
    if (crit && recl) return { n: 35, motivo: "crítica + reclamando" };
    if (recl) return ruim ? { n: 33, motivo: "reclamando, ontem ruim" } : bom ? { n: 30, motivo: "reclamando, ontem bom" } : { n: 35, motivo: "reclamando" };
    if (sens) return ruim ? { n: 32, motivo: "sensível, ontem ruim" } : bom ? { n: 29, motivo: "sensível, ontem bom" } : { n: 34, motivo: "sensível" };
    return ruim ? { n: 31, motivo: "crítica, ontem ruim" } : bom ? { n: 28, motivo: "crítica, ontem bom" } : { n: 34, motivo: "crítica" };
  }
  if (ruim) {
    if (sequenciaRuim >= 3) return { n: 25, motivo: "3+ dias ruins" };
    if (sequenciaRuim === 2) return { n: 24, motivo: "2 dias ruins" };
    if (ontem === "semConversa") return { n: 23, motivo: "gastou sem conversas" };
    if (ontem === "muito") return { n: 22, motivo: "CPA ontem muito acima" };
    if (prio === "baixa") return { n: 26, motivo: "conta boa, dia ruim" };
    return { n: 21, motivo: "CPA ontem acima" };
  }
  if (input.recuperacao) return { n: 38, motivo: "recuperação" };
  if (input.recorde) return { n: 39, motivo: "recorde do mês" };
  return null;
}

// A IA só varia a abertura (+ complemento). As frases do gestor e de "mais detalhes" entram fixas depois.
async function variar(itens: Array<{ id: string; texto: string }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (itens.length === 0) return out;
  try {
    const r = await llmJson<{ itens?: Array<{ id?: string; texto?: string }> }>(
      `Você reescreve mensagens curtas de WhatsApp que uma agência de tráfego manda no grupo do cliente, de manhã.
Responda SOMENTE em JSON: {"itens":[{"id":"...","texto":"..."}]} — um item pra cada id recebido.
Regras: o texto SEMPRE começa com "Bom dia, pessoal!" (não troque a saudação). Depois dela, mantenha o MESMO sentido
e mais ou menos o mesmo tamanho (no máximo 20% maior); só troque algumas palavras pra não ficar igual entre clientes;
frases simples e claras, sem expressões vagas ou sem sentido; português do Brasil, tom humano e próximo;
NADA técnico (proibido CPA, CPL, lead, criativo, conjunto, campanha, público, algoritmo, métricas); não acrescente
frases novas, números, fatos nem promessas que não estejam no texto.`,
      JSON.stringify(itens),
      { temperature: 0.5, maxTokens: 4000 },
    );
    for (const it of r.itens ?? []) {
      const t = String(it.texto ?? "").trim();
      const base = itens.find((x) => x.id === it.id);
      if (!base || !t) continue;
      if (t.length > base.texto.length * 1.5 + 20) continue; // passou do tamanho: fica o texto aprovado
      if (/\b(cpa|cpl|lead|criativo|conjunto|campanha|algoritmo|m[ée]trica)/i.test(t)) continue;
      if (!t.startsWith("Bom dia, pessoal!")) continue; // saudação travada
      out.set(base.id, t);
    }
  } catch (e) {
    console.error("rotina-clientes: IA", (e as Error).message);
  }
  return out;
}

const tirarFrases = (t: string) => t.replace(FRASE_GESTOR, "").replace(FRASE_DETALHES, "").replace(/\s+/g, " ").trim();

export interface GerarResultado {
  pulado?: string;
  programadas: number;
  semGrupo: string[];
  jaTinham: number;
  semCenario: number;
  itens: Array<{ cliente: string; cenario: number; motivo: string; texto?: string; grupo?: string; ordem?: number }>;
}

// simular = modo teste: usa os dados reais, pode fingir outro dia da semana (diaSemana 1–5) e só DEVOLVE as mensagens —
// não grava em Feedback, não programa e não manda nada no WhatsApp.
export async function gerarRotinaClientes(
  db: SupabaseClient,
  ownerId: string,
  opts: { avisar?: boolean; simular?: boolean; diaSemana?: number } = {},
): Promise<GerarResultado> {
  const cal = calendarSP();
  const hoje = cal.today;
  const simular = opts.simular === true;
  const diaSemana = simular && opts.diaSemana && opts.diaSemana >= 1 && opts.diaSemana <= 5 ? opts.diaSemana : new Date(`${hoje}T12:00:00Z`).getUTCDay();
  const vazio: GerarResultado = { programadas: 0, semGrupo: [], jaTinham: 0, semCenario: 0, itens: [] };
  if (diaSemana === 0 || diaSemana === 6) return { ...vazio, pulado: "fim de semana" };
  if (feriadoEm(hoje) && !simular) return { ...vazio, pulado: `feriado (${feriadoEm(hoje)})` };

  const ontem = addDaysYmd(hoje, -1);
  const desde = addDaysYmd(hoje, -Math.max(cal.day, 14)); // mês até ontem (recorde) e a última semana inteira (fim de semana)
  const dom = domingoAnterior(hoje);
  const inicioHojeUtc = `${hoje}T03:00:00.000Z`;

  const [carteira, prefsRes, jaHoje] = await Promise.all([
    loadCarteira(db, ownerId),
    db.from("user_ui_prefs").select("pref_key, pref_value").eq("user_id", ownerId).in("pref_key", ["contas_sensiveis", FEEDBACK_CONTEXTO_KEY, PRIORIDADE_HIST_KEY]),
    db.from("client_feedbacks").select("ad_account_id, titulo, status").eq("user_id", ownerId).gte("created_at", inicioHojeUtc),
  ]);
  const pref = (k: string) => (prefsRes.data ?? []).find((r) => r.pref_key === k)?.pref_value as unknown;
  const sensMap = (pref("contas_sensiveis") ?? {}) as Record<string, boolean>;
  const ctxMap = (pref(FEEDBACK_CONTEXTO_KEY) ?? {}) as Record<string, ContextoCliente>;
  const hist = (pref(PRIORIDADE_HIST_KEY) ?? {}) as HistPrioridade;
  const norm = (id: string) => String(id).replace(/^act_/, "");
  const jaTem = new Set(
    (jaHoje.data ?? [])
      .filter((f) => String(f.titulo ?? "").startsWith(ROTINA_TITULO) || f.status === "enviado")
      .map((f) => norm(f.ad_account_id as string)),
  );

  const contas = carteira;
  const stored = await readStoredDaysMany(contas.map((a) => a.id), desde, ontem);

  // Ontem ainda não está no backup (a rotina da noite não terminou) → busca na Meta (1 pedido por conta que falta)
  const faltam = contas.filter((a) => !stored.get(a.id)?.has(ontem)).slice(0, 20);
  const ontemVivo = new Map<string, Dia>();
  if (faltam.length) {
    try {
      const token = await getUserMetaToken(db as never, ownerId);
      let i = 0;
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (i < faltam.length) {
            const a = faltam[i++];
            try {
              const r = await hojeDaConta(token, a.id, ontem);
              ontemVivo.set(a.id, { spend: r.spend, results: r.results, cpaSpend: r.spend });
            } catch {
              /* fica sem dado de ontem */
            }
          }
        }),
      );
    } catch {
      /* sem token: segue sem os dados que faltam */
    }
  }

  const escolhas: Escolha[] = [];
  let semCenario = 0;
  let jaTinham = 0;
  for (const acc of contas) {
    if (jaTem.has(acc.id)) {
      jaTinham++;
      continue;
    }
    const dias = stored.get(acc.id);
    const diaDe = (ymd: string): Dia | undefined => {
      const r = dias?.get(ymd);
      if (r) return { spend: r.spend, results: r.results, cpaSpend: r.cpaSpend };
      return ymd === ontem ? ontemVivo.get(acc.id) : undefined;
    };
    const eOntem = estado(diaDe(ontem), acc.cpaTarget);
    let seq = 0;
    for (let k = 1; k <= 3; k++) {
      if (RUIM.has(estado(diaDe(addDaysYmd(hoje, -k)), acc.cpaTarget))) seq++;
      else break;
    }
    const recuperacao = eOntem === "bom" && RUIM.has(estado(diaDe(addDaysYmd(hoje, -2)), acc.cpaTarget)) && RUIM.has(estado(diaDe(addDaysYmd(hoje, -3)), acc.cpaTarget));
    let recorde = false;
    const yRes = diaDe(ontem)?.results ?? 0;
    if (yRes > 0 && cal.day > 6) {
      let max = 0;
      for (let d = cal.monthStart; d < ontem; d = addDaysYmd(d, 1)) max = Math.max(max, diaDe(d)?.results ?? 0);
      recorde = yRes > max && max > 0;
    }
    // reclassificação das últimas ~20h (a automática roda seg/qui de madrugada)
    const ult = (hist[acc.id] ?? hist[`act_${acc.id}`] ?? [])[0];
    const mudanca = ult && Date.now() - Date.parse(ult.em) < 20 * 3600_000 ? { de: ult.de, para: ult.para } : null;
    const sens = !!(sensMap[acc.id] || sensMap[`act_${acc.id}`]);
    const recl = (ctxMap[acc.id] ?? ctxMap[`act_${acc.id}`])?.temperatura === "reclamando";
    const esc = escolherCenario({ acc, diaSemana, sens, recl, ontem: eOntem, sequenciaRuim: seq, recuperacao, recorde, mudanca });
    if (!esc || !CENARIOS[esc.n]) {
      semCenario++;
      continue;
    }
    // queda do fim de semana (só importa na segunda)
    let quedaFds = false;
    if (diaSemana === 1) {
      const res = (d: string) => diaDe(d)?.results ?? 0;
      const fds = (res(dom) + res(addDaysYmd(dom, -1))) / 2;
      const uteis = [2, 3, 4, 5, 6].map((k) => res(addDaysYmd(dom, -k))).reduce((a, b) => a + b, 0) / 5;
      quedaFds = uteis >= 3 && fds < uteis * QUEDA_FDS_LIMITE;
    }
    escolhas.push({ acc, cenario: esc.n, ordem: rank(acc, sens, recl), motivo: esc.motivo + (quedaFds ? " · fim de semana caiu" : ""), quedaFds });
  }
  escolhas.sort((a, b) => a.ordem - b.ordem || a.acc.name.localeCompare(b.acc.name, "pt-BR"));

  // grupo de cada cliente
  const semGrupo: string[] = [];
  const comGrupo: Array<Escolha & { grupo: { id: string; name: string } }> = [];
  for (const e of escolhas) {
    const g = await resolveClientGroup(db, ownerId, e.acc.id);
    if (g) comGrupo.push({ ...e, grupo: g });
    else semGrupo.push(e.acc.name);
  }

  // Etapa 357: a IA varia só a abertura; o complemento do dia entra fixo (texto aprovado) e a frase do gestor vem pela situação.
  const vespera = !!proximoFeriado(hoje, 1);
  const compDe = (n: number, e: Escolha) =>
    complementoDoDia({ diaSemana, diaMes: cal.day, diasNoMes: cal.daysInMonth, vesperaFeriado: vespera, contaBoa: SITUACAO[n] === "boa", quedaFds: e.quedaFds, semente: `${e.acc.id}${hoje}` });
  const bases = comGrupo.map((e, i) => ({ id: String(i), texto: CENARIOS[e.cenario].abertura }));
  const variacoes = await variar(bases);
  const textoFinal = (i: number) => {
    const e = comGrupo[i];
    const cen = CENARIOS[e.cenario];
    const abertura = tirarFrases(variacoes.get(String(i)) ?? bases[i].texto);
    return montarMensagem({ ...cen, abertura }, compDe(cen.n, e), fraseGestor(cen.n, `${e.acc.id}${hoje}`, abertura));
  };

  if (simular) {
    return {
      programadas: 0,
      semGrupo,
      jaTinham,
      semCenario,
      itens: comGrupo.map((e, i) => {
        const cen = CENARIOS[e.cenario];
        return {
          cliente: e.acc.name,
          cenario: cen.n,
          motivo: e.motivo,
          grupo: e.grupo.name,
          ordem: i + 1,
          texto: textoFinal(i),
        };
      }),
    };
  }

  const quando = `${hoje}T${ROTINA_HORA_UTC}`;
  const agendados = await lerAgendados(db, ownerId);
  const itens: GerarResultado["itens"] = [];
  let ordem = 0;
  for (let i = 0; i < comGrupo.length; i++) {
    const e = comGrupo[i];
    const cen = CENARIOS[e.cenario];
    const texto = textoFinal(i);
    const { data: row, error } = await db
      .from("client_feedbacks")
      .insert({
        user_id: ownerId,
        ad_account_id: e.acc.id,
        client_name: e.acc.name,
        titulo: `${ROTINA_TITULO} · ${cen.n}. ${cen.nome}`,
        status: "revisao",
        tipo: "print",
        prints: [],
        resumo: texto,
        wa_group_id: e.grupo.id,
        wa_group_name: e.grupo.name,
      })
      .select("id")
      .single();
    if (error || !row) {
      console.error("rotina-clientes: inserir", e.acc.name, error?.message);
      continue;
    }
    agendados.push({ id: row.id as string, quando, cliente: e.acc.name, rotina: true, ordem: ordem++ });
    itens.push({ cliente: e.acc.name, cenario: cen.n, motivo: e.motivo });
  }
  await gravarAgendados(db, ownerId, agendados);

  // Aviso no seu WhatsApp pra revisar (se o número estiver em Automações / Conexões → Avisos)
  if (opts.avisar !== false && itens.length > 0) {
    try {
      const [cfg, inst] = await Promise.all([loadConfig(db, ownerId), getWhatsappInstance(db as never, ownerId)]);
      const num = cfg.myWhatsapp ? toWhats(cfg.myWhatsapp) : "";
      if (num && inst?.api_url && inst.token) {
        await sendText(
          { api_url: inst.api_url, token: inst.token },
          num,
          `☀️ *Rotina da manhã* — ${itens.length} mensagens programadas pras 7h50.\nRevise em Feedback → Programado. Se não mexer, elas saem no horário.${semGrupo.length ? `\n\nSem grupo na ficha (não vão): ${semGrupo.join(", ")}` : ""}`,
        );
      }
    } catch (e) {
      console.error("rotina-clientes: aviso", (e as Error).message);
    }
  }

  return { programadas: itens.length, semGrupo, jaTinham, semCenario, itens };
}


// Etapa 357: simulação de TODOS os cenários (inclusive as trocas de prioridade), pra conferir as respostas.
// Não lê conta nenhuma nem grava nada: um exemplo de cada cenário, com a variação da IA e o complemento do dia escolhido.
export async function exemplosDeCenarios(diaSemana: number): Promise<Array<{ cenario: number; nome: string; texto: string }>> {
  const cal = calendarSP();
  const lista: Cenario[] = Object.values(CENARIOS).sort((a, b) => a.n - b.n);
  const variacoes = await variar(lista.map((c) => ({ id: String(c.n), texto: c.abertura })));
  return lista.map((c) => {
    const comp = complementoDoDia({ diaSemana, diaMes: cal.day, diasNoMes: cal.daysInMonth, vesperaFeriado: false, contaBoa: SITUACAO[c.n] === "boa", quedaFds: false });
    const abertura = tirarFrases(variacoes.get(String(c.n)) ?? c.abertura);
    return { cenario: c.n, nome: c.nome, texto: montarMensagem({ ...c, abertura }, comp, fraseGestor(c.n, `exemplo${c.n}`, abertura)) };
  }).concat(
    diaSemana === 1
      ? [2, 16].map((n) => {
          const c = CENARIOS[n];
          return {
            cenario: n,
            nome: `${c.nome} — segunda COM queda brusca no fim de semana`,
            texto: montarMensagem(c, fraseFimDeSemana(`fds${n}`), fraseGestor(n, `exemplo${n}`, c.abertura)),
          };
        })
      : [],
  );
}
