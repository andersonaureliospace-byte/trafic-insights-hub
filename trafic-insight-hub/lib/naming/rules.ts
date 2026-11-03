// Padrão de nomes (Etapa 140; regras novas na Etapa 241 = POP 01 de Nomenclatura) — regras PURAS (sem Meta/banco), testáveis.
//
// Campanha:  TIPO | OBJETIVO | UNIDADE        TIPO: GERAL, EXAME ou PROMO · OBJETIVO = objetivo da campanha na Meta (ENGAJAMENTO, LEADS…)
//            Vaga: começa com [VAGA] (o resto é livre).
// Conjunto:  TIPO | OFERTA | VDO PROPRIO | LOCALIZAÇÃO OU KM | IDADE | GÊNERO | PLATAFORMA | INTERESSES | RESPONSÁVEL | DATA
//   - GERAL não leva oferta, com uma exceção: BOLETO (GERAL | BOLETO). CREDIARIO vira BOLETO.
//   - EXAME: tipo e oferta juntos na 1ª parte (EXAME R$ 15,00). PROMO: oferta numa parte própria (PROMO | ARMAÇÃO R$ 1,00).
//   - Valor sempre "R$ 15,00" (nada de "REAL"/"REAIS").
//   - VDO PROPRIO: só quando o vídeo é do cliente (o da franquia não leva nada). Vai depois da oferta.
//   - LOCALIZAÇÃO: com raio, só o km (8KM); uma cidade, o nome; várias, a primeira com "+" colado (AMPARO+).
//   - IDADE: min-max ("18-65+" quando o máximo é 65 ou mais). GÊNERO/PLATAFORMA: só quando é um só. INTERESSES: só se tiver.
//   - RESPONSÁVEL: identificação do gestor da conta (cadastro de Gestores). DATA: dia/mês do início da veiculação do conjunto (Brasília).
// Criativo: só o nome do arquivo. Exceção EXAME: EXAME R$ 15,00 | DD/MM (primeiro uso) | V01.
// "Cópia" não pode aparecer em nenhum nome.

export const CAMPAIGN_TYPES = ["GERAL", "EXAME", "PROMO"] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
export const ADSET_TYPES = ["GERAL", "EXAME", "PROMO"] as const;
export type AdsetType = (typeof ADSET_TYPES)[number];

// ---------- utilidades ----------

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Comparação: maiúsculas, sem acento, espaços colapsados.
export function normName(s: string): string {
  return stripAccents(s).toUpperCase().replace(/\s+/g, " ").trim();
}

export function splitParts(name: string): string[] {
  return name
    .split("|")
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p, i, arr) => !(p === "" && arr.length === 1));
}

const COPY_RE = /c[oó]pia|\bcopy\b/i;

export function hasCopy(name: string): boolean {
  return COPY_RE.test(name);
}

// Tira "- Cópia", "(Cópia 2)", "Cópia", "copy" etc. do texto.
export function stripCopy(name: string): string {
  return name
    .replace(/\s*[-–—]?\s*[\(\[]?\s*(c[oó]pia|copy)(\s*(de|of))?(\s*\d+)?\s*[\)\]]?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*\|\s*\|\s*/g, " | ")
    .trim();
}

// "PROMO", "OFERTAS", "CREDIARIO"… viram os 3 tipos oficiais. null = não reconhecido.
export function mapType(raw: string): CampaignType | null {
  const n = normName(raw).replace(/[^A-Z]/g, "");
  if (n === "GERAL") return "GERAL";
  if (n === "EXAME" || n === "EXAMES") return "EXAME";
  if (["OFERTA", "OFERTAS", "PROMO", "PROMOCAO", "PROMOCOES"].includes(n)) return "PROMO";
  return null;
}

// Tipo do CONJUNTO (GERAL, EXAME ou PROMO). Aceita só a 1ª palavra ("PROMO SETEMBRO" → PROMO, resto = "SETEMBRO").
export function mapAdsetType(raw: string): { type: AdsetType; rest: string } | null {
  const words = normName(raw).split(" ");
  const first = words[0]?.replace(/[^A-Z]/g, "") ?? "";
  const rest = raw.trim().split(/\s+/).slice(1).join(" ");
  if (first === "GERAL") return { type: "GERAL", rest };
  if (first === "EXAME" || first === "EXAMES") return { type: "EXAME", rest };
  if (["PROMO", "PROMOCAO", "PROMOCOES", "OFERTA", "OFERTAS"].includes(first)) return { type: "PROMO", rest };
  return null;
}

// Forma de pagamento (CREDIARIO/BOLETO) e "VDO PROPRIO" (vídeo gravado pelo cliente) — marcas que ficam em posição fixa no nome.
export type PaymentTag = "CREDIARIO" | "BOLETO";
const PAYMENT_RE: Array<[RegExp, PaymentTag]> = [
  [/\bcredi[aá]rios?\b/gi, "CREDIARIO"],
  [/\bboletos?\b/gi, "BOLETO"],
];
const OWN_VIDEO_RE = /\b(vdo|v[ií]deos?)\s+pr[oó]prios?\b/gi;
export const OWN_VIDEO_TEXT = "VDO PROPRIO";

export function extractTags(text: string): { payment: PaymentTag | null; ownVideo: boolean; rest: string } {
  let rest = text;
  let payment: PaymentTag | null = null;
  let ownVideo = false;
  for (const [re, tag] of PAYMENT_RE) {
    if (new RegExp(re.source, "i").test(rest)) {
      payment = payment ?? tag;
      rest = rest.replace(re, " ");
    }
  }
  if (new RegExp(OWN_VIDEO_RE.source, "i").test(rest)) {
    ownVideo = true;
    rest = rest.replace(OWN_VIDEO_RE, " ");
  }
  return { payment, ownVideo, rest: rest.replace(/\s+/g, " ").trim() };
}

// Textos genéricos que não contam como oferta ("ARMAÇÃO R$ 49,99", "R$ 49,99", "COBRIMOS OFERTAS").
export function isGenericOffer(text: string): boolean {
  const n = normName(text);
  if (!n) return true;
  if (/COBRIMOS\s+OFERTAS?/.test(n)) return true;
  if (/^(ARMACAO\s*)?(R\$\s*)?49[,.]\d{2}$/.test(n)) return true;
  return false;
}

export function brtDayMonth(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).formatToParts(d);
  const day = parts.find((p) => p.type === "day")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return day && month ? `${day}/${month}` : null;
}

// ---------- campanha ----------

export interface NameCheck {
  ok: boolean;
  problems: string[];
  suggestion: string | null; // nome sugerido (null = não ok e sem sugestão possível)
  needsInput: boolean; // true = a sugestão está incompleta, precisa ser editada antes de aceitar
  autoFix: boolean; // true = dá pra ajustar sozinho, sem aprovação (só idade/data divergem, e/ou tem "Cópia")
  // Etapa 192: nome que o ajuste automático aplica. Pode ser só o nome atual sem o "Cópia" quando o resto
  // ainda precisa de aprovação (aí o item continua na aba "Padrão de nomes" com a sugestão completa).
  autoName?: string | null;
}

const OK: NameCheck = { ok: true, problems: [], suggestion: null, needsInput: false, autoFix: false };


// Etapa 241: OBJETIVO = o objetivo da campanha na Meta (não o canal). Nome que vai no padrão, por objetivo da Meta.
export const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_AWARENESS: "RECONHECIMENTO",
  OUTCOME_TRAFFIC: "TRÁFEGO",
  OUTCOME_ENGAGEMENT: "ENGAJAMENTO",
  OUTCOME_LEADS: "LEADS",
  OUTCOME_APP_PROMOTION: "PROMOÇÃO DO APP",
  OUTCOME_SALES: "VENDAS",
  // objetivos antigos (campanhas criadas antes da Meta trocar os nomes)
  BRAND_AWARENESS: "RECONHECIMENTO",
  REACH: "RECONHECIMENTO",
  LINK_CLICKS: "TRÁFEGO",
  POST_ENGAGEMENT: "ENGAJAMENTO",
  PAGE_LIKES: "ENGAJAMENTO",
  VIDEO_VIEWS: "ENGAJAMENTO",
  MESSAGES: "ENGAJAMENTO",
  EVENT_RESPONSES: "ENGAJAMENTO",
  LEAD_GENERATION: "LEADS",
  CONVERSIONS: "VENDAS",
  PRODUCT_CATALOG_SALES: "VENDAS",
  STORE_VISITS: "TRÁFEGO",
  APP_INSTALLS: "PROMOÇÃO DO APP",
};
export const OBJECTIVES = ["RECONHECIMENTO", "TRÁFEGO", "ENGAJAMENTO", "LEADS", "PROMOÇÃO DO APP", "VENDAS"] as const;

// Etapa 241: campanha de vaga começa com [VAGA]. O resto do nome é livre.
const VAGA_WORD_RE = /\bvagas?\b/i;
export const VAGA_PREFIX = "[VAGA]";
export function isVagaName(name: string): boolean {
  return VAGA_WORD_RE.test(name);
}
export function checkVagaCampaignName(name: string): NameCheck {
  const problems: string[] = [];
  const base = hasCopy(name) ? stripCopy(name) : name;
  if (hasCopy(name)) problems.push('Tem "cópia" no nome');
  const startsOk = normName(base).startsWith(VAGA_PREFIX);
  if (!startsOk) problems.push("Campanha de vaga precisa começar com [VAGA]");
  if (problems.length === 0) return OK;
  const rest = startsOk
    ? base
    : `${VAGA_PREFIX} ${base
        .replace(/^\s*[\[(]?\s*vagas?\s*[\])]?\s*[|\-–—:]?\s*/i, "")
        .trim()}`;
  const suggestion = rest.trim();
  const autoName = hasCopy(name) && startsOk ? suggestion : null;
  return { ok: false, problems, suggestion, needsInput: false, autoFix: !!autoName, autoName };
}

export function checkCampaignName(name: string, unitName: string | null, objective?: string | null): NameCheck {
  if (isVagaName(name)) return checkVagaCampaignName(name);
  const problems: string[] = [];
  let parts = splitParts(name);
  let needsInput = false;

  if (hasCopy(name)) {
    problems.push('Tem "cópia" no nome');
    parts = splitParts(stripCopy(name));
  }

  // "BOLETO | ..." / "CREDIARIO | ..." no começo: campanha de boleto é GERAL.
  if (parts[0] && /^(CREDIARIOS?|BOLETOS?)$/.test(normName(parts[0]).replace(/[^A-Z]/g, ""))) {
    problems.push("TIPO deve ser GERAL — boleto é oferta do GERAL");
    parts = ["GERAL", ...parts.slice(1)];
  }
  const type = parts[0] ? mapType(parts[0]) : null;
  if (!type) {
    problems.push("TIPO precisa ser GERAL, EXAME ou PROMO");
    needsInput = true;
  } else if (normName(parts[0]) !== type) {
    problems.push(`TIPO "${parts[0]}" deve ser ${type}`);
  }

  let objectiveText = parts[1] ?? "";
  let unit = parts[2] ?? "";
  if (parts.length > 3) {
    problems.push("Mais partes do que o padrão (TIPO | OBJETIVO | UNIDADE)");
    objectiveText = parts[1] ?? "";
    unit = parts[parts.length - 1];
  }
  if (parts.length === 2 && unitName) {
    problems.push("Falta a UNIDADE");
    unit = unitName.toUpperCase();
  } else if (parts.length < 3) {
    problems.push("Faltam partes (TIPO | OBJETIVO | UNIDADE)");
    needsInput = true;
  }
  const expectedObjective = objective ? (OBJECTIVE_LABELS[objective] ?? null) : null;
  if (expectedObjective && objectiveText && normName(objectiveText) !== normName(expectedObjective)) {
    problems.push(`OBJETIVO deve ser ${expectedObjective} (objetivo da campanha)`);
  }
  if (expectedObjective) objectiveText = expectedObjective;
  // Data colada na unidade ("IVS CIDADE - 08/07"): não faz parte do padrão da campanha.
  const withoutDate = unit.replace(/\s*[-–—]\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*$/, "").trim();
  if (withoutDate !== unit) {
    problems.push("UNIDADE com data no final (a campanha não leva data)");
    unit = withoutDate;
  }

  if (problems.length === 0) return OK;
  const suggestion = [type ?? parts[0] ?? "?", objectiveText || "?", unit || "?"].join(" | ");
  if (suggestion.includes("?")) needsInput = true;
  const copyOnly = hasCopy(name) && problems.length === 1;
  const cleaned = hasCopy(name) ? stripCopy(name) : "";
  const autoName = copyOnly && !needsInput ? suggestion : cleaned || null;
  return { ok: false, problems, suggestion, needsInput, autoFix: !!autoName, autoName };
}

// ---------- conjunto ----------

export interface TargetingLike {
  age_min?: number;
  age_max?: number;
  genders?: number[];
  geo_locations?: {
    cities?: Array<{ name?: string; radius?: number; distance_unit?: string }>;
    custom_locations?: Array<{ name?: string; radius?: number; distance_unit?: string }>;
    regions?: Array<{ name?: string }>;
  };
  publisher_platforms?: string[];
  flexible_spec?: Array<Record<string, unknown>>;
  interests?: unknown[];
}

function kmOf(radius: number | undefined, unit: string | undefined): number | null {
  if (!radius || radius <= 0) return null;
  const km = String(unit ?? "").toLowerCase().startsWith("mile") ? radius * 1.609344 : radius;
  return Math.round(km);
}

export function deriveLocation(t: TargetingLike | undefined | null): string | null {
  const geo = t?.geo_locations;
  if (!geo) return null;
  const pins = geo.custom_locations ?? [];
  const cities = geo.cities ?? [];
  const regions = geo.regions ?? [];
  // Tem raio (em qualquer cidade ou ponto) → só o km, a cidade some do nome (ex.: "EFAPI 8 km" → 8KM).
  const kms = [...cities, ...pins].map((x) => kmOf(x.radius, x.distance_unit)).filter((k): k is number => k != null);
  if (kms.length > 0) return `${kms[0]}KM`;
  if (cities.length === 1) return cities[0].name ? cities[0].name.toUpperCase() : null;
  if (cities.length > 1) return cities[0].name ? `${cities[0].name.toUpperCase()}+` : null; // "+" só quando há mais cidades
  if (pins.length > 0) return pins[0].name ? `${pins[0].name.toUpperCase()}${pins.length > 1 ? "+" : ""}` : null;
  if (regions.length > 0) return regions[0].name ? `${regions[0].name.toUpperCase()}${regions.length > 1 ? "+" : ""}` : null;
  return null;
}

export function deriveAge(t: TargetingLike | undefined | null): string {
  const min = t?.age_min ?? 18;
  const max = t?.age_max ?? 65;
  return `${min}-${max}${max >= 65 ? "+" : ""}`;
}

export function deriveGender(t: TargetingLike | undefined | null): string | null {
  const g = t?.genders ?? [];
  if (g.length === 1) return g[0] === 1 ? "HOMEM" : g[0] === 2 ? "MULHER" : null;
  return null;
}

export function derivePlatform(t: TargetingLike | undefined | null): string | null {
  const p = (t?.publisher_platforms ?? []).map((x) => x.toLowerCase());
  if (p.length === 0) return null; // posicionamentos automáticos = ambas
  const hasInsta = p.includes("instagram");
  const hasFace = p.some((x) => x === "facebook" || x === "messenger" || x === "audience_network");
  if (hasInsta && hasFace) return null;
  if (hasInsta) return "INSTA";
  if (hasFace) return "FACE";
  return null;
}

export function deriveHasInterests(t: TargetingLike | undefined | null): boolean {
  if ((t?.interests?.length ?? 0) > 0) return true;
  return (t?.flexible_spec ?? []).some((spec) => Object.values(spec).some((v) => Array.isArray(v) && v.length > 0));
}

interface Part {
  key: "tipo" | "oferta" | "vdo" | "loc" | "idade" | "genero" | "plataforma" | "direc" | "resp" | "data";
  text: string;
}

const AGE_RE = /^\d{2}\s*-\s*\d{2}\+?$/;
const DATE_RE = /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/;
const GENDER_WORDS = new Set(["HOMEM", "MULHER", "HOMENS", "MULHERES", "MASCULINO", "FEMININO"]);
const PLATFORM_WORDS = new Set(["INSTA", "INSTAGRAM", "FACE", "FACEBOOK", "IG", "FB"]);

// Etapa 241: valor sempre como "R$ 15,00" ("15 REAIS", "1 REAL", "R$15", "R$ 15" → R$ 15,00).
export function normalizeMoney(text: string): string {
  let t = text.replace(/(\d+(?:[.,]\d{1,2})?)\s*(reais|real)\b/gi, "R$ $1");
  t = t.replace(/R\$\s*((?:\d{1,3}(?:\.\d{3})+)|\d+)(?:,(\d{1,2})|\.(\d{1,2}))?(?![\d.,])/gi, (_m, int: string, d1?: string, d2?: string) => {
    const dec = (d1 ?? d2 ?? "00").padEnd(2, "0");
    const n = int.replace(/\./g, "").replace(/^0+(?=\d)/, "");
    return `R$ ${n.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
  });
  return t.replace(/\s+/g, " ").trim();
}

function stripOwnVideo(text: string): string {
  return text.replace(OWN_VIDEO_RE, " ").replace(/\s+/g, " ").trim();
}

// Fica como pista de OFERTA só o que o sistema não consegue derivar sozinho (idade, data, gênero, localização… saem).
function isOfferPart(raw: string, locNorm: string | null, places: Set<string>, respNorm: string | null): boolean {
  const n = normName(raw);
  if (!n) return false;
  if (AGE_RE.test(n) || DATE_RE.test(n) || GENDER_WORDS.has(n) || PLATFORM_WORDS.has(n)) return false;
  if (n === "INTERESSES" || n === "INTERESSE") return false;
  if (respNorm && n === respNorm) return false; // identificação do responsável
  if (locNorm && n.replace(/\s*\+$/, "") === locNorm.replace(/\+$/, "")) return false;
  if (/\b\d+\s*KM\b/.test(n)) return false; // "8KM", "EFAPI 8 km"
  if (/VIZINH/.test(n) || n.includes("&")) return false; // "AMPARO & CIDADES VIZINHAS"
  if (places.has(n.replace(/\s*\+$/, ""))) return false; // cidade/região que o conjunto segmenta
  if (isGenericOffer(raw)) return false; // "ARMAÇÃO R$ 49,99", "R$ 49,99", "COBRIMOS OFERTAS"
  return true;
}

export interface AdsetFacts {
  name: string;
  createdTime: string | null; // Etapa 245: início da veiculação do conjunto (start_time); sem ele, a criação
  targeting: TargetingLike | null | undefined;
  // Etapa 241: identificação do responsável da conta (cadastro de Gestores). null = não cadastrada (aceita a que estiver no nome).
  manager?: string | null;
}

export function expectedAdsetParts(facts: AdsetFacts): { parts: Part[]; needsInput: boolean; notes: string[] } {
  const notes: string[] = [];
  let needsInput = false;
  const nameNoCopy = hasCopy(facts.name) ? stripCopy(facts.name) : facts.name;
  const cur = splitParts(nameNoCopy);

  const loc = deriveLocation(facts.targeting);
  const locNorm = loc ? normName(loc) : null;
  const places = new Set<string>();
  const geo = facts.targeting?.geo_locations;
  for (const x of [...(geo?.cities ?? []), ...(geo?.custom_locations ?? []), ...(geo?.regions ?? [])]) {
    if (x.name) places.add(normName(x.name));
  }

  // Identificação do responsável que está no nome: a parte logo antes da data.
  const dateIdx = cur.findIndex((p) => DATE_RE.test(normName(p)));
  const curResp = dateIdx > 0 ? cur[dateIdx - 1] : null;
  const curRespOk = curResp && !AGE_RE.test(normName(curResp)) && normName(curResp).length <= 20 ? curResp.trim() : null;
  const manager = facts.manager?.trim() || null;
  const respNorm = normName(manager ?? curRespOk ?? "") || null;

  // BOLETO/CREDIARIO no nome (boleto é oferta do GERAL) e VDO PROPRIO (identificação: vídeo gravado pelo cliente)
  const tags = extractTags(cur.join(" | "));
  const payment = tags.payment;
  const ownVideo = tags.ownVideo;
  const cleaned = cur.map(stripOwnVideo);

  // 1) TIPO (GERAL, EXAME ou PROMO) + pistas de oferta que já estão no nome
  const mapped = cleaned[0] ? mapAdsetType(cleaned[0]) : null;
  const offerBits: string[] = [];
  if (mapped?.rest && isOfferPart(mapped.rest, locNorm, places, respNorm)) offerBits.push(mapped.rest);
  if (!mapped && cleaned[0] && isOfferPart(cleaned[0], locNorm, places, respNorm)) offerBits.push(cleaned[0]);
  for (let i = 1; i < cleaned.length; i++) if (cleaned[i] && isOfferPart(cleaned[i], locNorm, places, respNorm)) offerBits.push(cleaned[i]);
  let offer = normalizeMoney(offerBits.join(" ").replace(/\bcredi[aá]rios?\b/gi, "BOLETO"));

  let tipo: AdsetType;
  if (mapped) tipo = mapped.type;
  else if (payment) tipo = "GERAL";
  else if (!offer) tipo = "GERAL";
  else {
    tipo = "PROMO";
    notes.push("TIPO deduzido como PROMO (o nome antigo não dizia) — confira");
  }

  const date = brtDayMonth(facts.createdTime);
  const parts: Part[] = [];

  // 2) OFERTA. GERAL: só BOLETO (única oferta do GERAL). EXAME: tipo e oferta juntos ("EXAME R$ 15,00"). PROMO: parte própria.
  if (tipo === "GERAL") {
    parts.push({ key: "tipo", text: "GERAL" });
    if (payment) parts.push({ key: "oferta", text: "BOLETO" });
  } else if (tipo === "EXAME") {
    offer = offer.replace(/^EXAMES?\s+/i, "").trim();
    if (offer) parts.push({ key: "tipo", text: `EXAME ${offer}` });
    else {
      needsInput = true;
      parts.push({ key: "tipo", text: "EXAME R$ VALOR" });
      notes.push("EXAME precisa do valor ou da oferta junto (EXAME R$ 15,00)");
    }
  } else {
    parts.push({ key: "tipo", text: "PROMO" });
    if (offer) parts.push({ key: "oferta", text: offer });
    else {
      needsInput = true;
      parts.push({ key: "oferta", text: "OFERTA" });
      notes.push("PROMO precisa da oferta no nome");
    }
  }

  // 2b) vídeo próprio: logo depois da oferta (só quando o vídeo é do cliente; o da franquia não leva nada)
  if (ownVideo) parts.push({ key: "vdo", text: OWN_VIDEO_TEXT });

  // 3) localização, idade, gênero, plataforma, direcionamento, responsável, data
  if (loc) parts.push({ key: "loc", text: loc });
  else {
    needsInput = true;
    parts.push({ key: "loc", text: "LOCALIZAÇÃO" });
    notes.push("Não deu pra ler a localização do conjunto");
  }
  parts.push({ key: "idade", text: deriveAge(facts.targeting) });
  const gender = deriveGender(facts.targeting);
  if (gender) parts.push({ key: "genero", text: gender });
  const platform = derivePlatform(facts.targeting);
  if (platform) parts.push({ key: "plataforma", text: platform });
  if (deriveHasInterests(facts.targeting)) parts.push({ key: "direc", text: "INTERESSES" });
  const resp = manager ?? curRespOk;
  if (resp) parts.push({ key: "resp", text: resp.toUpperCase() });
  else {
    needsInput = true;
    parts.push({ key: "resp", text: "RESPONSÁVEL" });
  }
  if (date) parts.push({ key: "data", text: date });
  else {
    needsInput = true;
    parts.push({ key: "data", text: "DD/MM" });
  }
  return { parts, needsInput, notes };
}

const PART_LABELS: Record<Part["key"], string> = {
  tipo: "TIPO",
  oferta: "OFERTA",
  vdo: "VDO PROPRIO",
  loc: "LOCALIZAÇÃO",
  idade: "IDADE",
  genero: "GÊNERO",
  plataforma: "PLATAFORMA",
  direc: "DIRECIONAMENTO",
  resp: "RESPONSÁVEL",
  data: "DATA",
};

export function checkAdsetName(facts: AdsetFacts): NameCheck {
  const { parts: expected, needsInput, notes } = expectedAdsetParts(facts);
  const suggestion = expected.map((p) => p.text).join(" | ");
  const copy = hasCopy(facts.name);
  const cleanedName = copy ? stripCopy(facts.name) : facts.name;
  const cur = splitParts(cleanedName);
  const problems: string[] = [];

  if (copy) problems.push('Tem "cópia" no nome');

  let autoFix = false;
  if (cur.length === expected.length) {
    const diffKeys: Part["key"][] = [];
    expected.forEach((p, i) => {
      if (normName(cur[i]) !== normName(p.text)) diffKeys.push(p.key);
    });
    if (diffKeys.length === 0 && problems.length === 0) return OK;
    for (const k of diffKeys) problems.push(`${PART_LABELS[k]} fora do padrão`);
    autoFix = problems.length > 0 && diffKeys.every((k) => k === "idade" || k === "data") && !needsInput;
  } else {
    problems.push(`Estrutura fora do padrão (${cur.length} partes, esperado ${expected.length})`);
  }
  for (const n of notes) problems.push(n);
  let autoName: string | null = autoFix ? suggestion : null;
  if (!autoName) {
    const date = expected.find((p) => p.key === "data")?.text;
    const partial = cur.map((x) => (date && /^\d{1,2}\/\d{1,2}$/.test(x.trim()) ? date : x)).join(" | ");
    if (partial && normName(partial) !== normName(facts.name)) autoName = partial;
  }
  return { ok: false, problems, suggestion, needsInput, autoFix: !!autoName, autoName };
}

// ---------- criativo (anúncio) ----------
// Etapa 241: criativo leva só o nome do arquivo (sem GERAL, PROMO, EXAME…).
// Exceção: criativo de conjunto de EXAME = EXAME R$ 15,00 | DD/MM (primeiro uso) | V01 (variação).

const AD_TYPE_WORDS = new Set(["GERAL", "PROMO", "PROMOCAO", "PROMOCOES", "EXAME", "EXAMES", "OFERTA", "OFERTAS", "BOLETO", "BOLETOS", "CREDIARIO"]);
const VAR_RE = /^V\s*0*(\d{1,3})$/;

export interface AdContext {
  adsetName?: string | null;
  createdTime?: string | null;
}

export function checkAdName(name: string, ctx: AdContext = {}): NameCheck {
  const copy = hasCopy(name);
  const base = copy ? stripCopy(name) : name;
  const parts = splitParts(base);
  const problems: string[] = [];
  if (copy) problems.push('Tem "cópia" no nome');

  const adsetType = ctx.adsetName ? mapAdsetType(splitParts(ctx.adsetName)[0] ?? "")?.type ?? null : null;

  if (adsetType === "EXAME") {
    // valor: o do próprio nome, senão o do conjunto
    const fromName = parts[0] ? mapAdsetType(parts[0]) : null;
    const adsetFirst = mapAdsetType(splitParts(ctx.adsetName ?? "")[0] ?? "");
    const value = normalizeMoney((fromName?.type === "EXAME" ? fromName.rest : "") || adsetFirst?.rest || "");
    const date = parts.find((p) => DATE_RE.test(normName(p))) ?? brtDayMonth(ctx.createdTime ?? null);
    const v = parts.map((p) => normName(p).match(VAR_RE)).find(Boolean);
    let needsInput = false;
    const first = value ? `EXAME ${value}` : ((needsInput = true), "EXAME R$ VALOR");
    const variation = v ? `V${v[1].padStart(2, "0")}` : ((needsInput = true), "V01");
    const expected = [first, date ?? ((needsInput = true), "DD/MM"), variation].join(" | ");
    if (normName(base) !== normName(expected)) problems.push("Criativo de EXAME fora do padrão (EXAME R$ VALOR | DD/MM | V01)");
    if (problems.length === 0) return OK;
    const autoName = copy && problems.length === 1 ? base : null;
    return { ok: false, problems, suggestion: expected, needsInput, autoFix: !!autoName, autoName };
  }

  // Criativo comum: só o nome do arquivo.
  const firstWord = normName(parts[0] ?? "").split(" ")[0]?.replace(/[^A-Z]/g, "") ?? "";
  const typeParts = parts.filter((p) => AD_TYPE_WORDS.has(normName(p).replace(/[^A-Z]/g, "")));
  const startsWithType = AD_TYPE_WORDS.has(firstWord);
  if (typeParts.length > 0 || startsWithType) problems.push("Criativo leva só o nome do arquivo (sem GERAL, PROMO, EXAME…)");
  if (problems.length === 0) return OK;
  let rest = parts.filter((p) => !AD_TYPE_WORDS.has(normName(p).replace(/[^A-Z]/g, "")));
  if (rest.length > 0 && startsWithType && typeParts.length === 0) rest = [rest[0].trim().split(/\s+/).slice(1).join(" "), ...rest.slice(1)].filter(Boolean);
  const cleanedName = rest.join(" | ").trim();
  const autoName = copy && problems.length === 1 ? base : null;
  return {
    ok: false,
    problems,
    suggestion: cleanedName || "NOME DO ARQUIVO",
    needsInput: !cleanedName || problems.length > (copy ? 1 : 0),
    autoFix: !!autoName,
    autoName,
  };
}
