// Padrão de nomes (Etapa 140) — regras PURAS (sem Meta/banco), testáveis.
//
// Campanha:  TIPO | OBJETIVO | UNIDADE            (TIPO: só GERAL, EXAME ou OFERTA)
// Conjunto:  TIPO | OFERTA | LOCALIZAÇÃO OU KM | IDADE | GENERO | PLATAFORMA | DIRECIONAMENTO | AND | DATA
//   - TIPO do conjunto: GERAL, EXAME ou PROMO (na campanha o terceiro tipo é OFERTA; no conjunto é PROMO)
//   - CREDIARIO / BOLETO: forma de pagamento, vai logo depois do tipo/oferta (GERAL | CREDIARIO; PROMO | OFERTA | BOLETO)
//   - VDO PROPRIO (vídeo gravado pelo cliente): vai DEPOIS da oferta/pagamento (PROMO | ARMAÇÃO 1 REAL | VDO PROPRIO; GERAL | VDO PROPRIO)
//   - OFERTA: só em PROMO e EXAME. Em GERAL NÃO leva oferta (some "ARMAÇÃO R$ 49,99", "R$ 49,99", "COBRIMOS OFERTAS"…)
//   - LOCALIZAÇÃO: se tem raio, só o km (ex.: 8KM — km + cidade vira só o km); só uma cidade → só o nome da cidade;
//     mais de uma cidade → primeiro nome com "+" (ex.: AMPARO & CIDADES VIZINHAS → AMPARO+). O "+" só quando há mais cidades.
//   - IDADE: min-max ("18-65+" quando o máximo é 65 ou mais)
//   - GENERO / PLATAFORMA: só aparecem quando é UM só (MULHER/HOMEM; INSTA/FACE). Ambos → omite.
//   - DIRECIONAMENTO: só "INTERESSES", e só quando o conjunto tem interesses
//   - AND: fixo (abreviação do nome do gestor)
//   - DATA: dia/mês da criação do conjunto (ex.: 17/10), horário de Brasília
// "Cópia" não pode aparecer em nenhum nome (campanha, conjunto, anúncio). Nome repetido pode.

export const CAMPAIGN_TYPES = ["GERAL", "EXAME", "OFERTA"] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
export const ADSET_TYPES = ["GERAL", "EXAME", "PROMO"] as const;
export type AdsetType = (typeof ADSET_TYPES)[number];
export const MANAGER_TAG = "AND";

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
  if (["OFERTA", "OFERTAS", "PROMO", "PROMOCAO", "PROMOCOES"].includes(n)) return "OFERTA";
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

export function checkCampaignName(name: string, unitName: string | null): NameCheck {
  const problems: string[] = [];
  let parts = splitParts(name);
  let needsInput = false;

  if (hasCopy(name)) {
    problems.push('Tem "cópia" no nome');
    parts = splitParts(stripCopy(name));
  }

  // "CREDIARIO | ..." / "BOLETO | ..." no começo: o tipo é GERAL e CREDIARIO/BOLETO vai logo depois (GERAL | CREDIARIO | ...).
  if (parts[0] && /^(CREDIARIOS?|BOLETOS?)$/.test(normName(parts[0]).replace(/[^A-Z]/g, ""))) {
    problems.push("TIPO deve ser GERAL — CREDIARIO/BOLETO vai depois do tipo");
    parts = ["GERAL", ...parts];
  }
  const type = parts[0] ? mapType(parts[0]) : null;
  if (!type) {
    problems.push("TIPO precisa ser GERAL, EXAME ou OFERTA");
    needsInput = true;
  } else if (normName(parts[0]) !== type) {
    problems.push(`TIPO "${parts[0]}" deve ser ${type}`);
  }

  let objective = parts[1] ?? "";
  let unit = parts[2] ?? "";
  if (parts.length > 3) {
    problems.push("Mais partes do que o padrão (TIPO | OBJETIVO | UNIDADE)");
    objective = parts.slice(1, -1).join(" ");
    unit = parts[parts.length - 1];
  }
  if (parts.length === 2 && unitName) {
    problems.push("Falta a UNIDADE");
    unit = unitName.toUpperCase();
  } else if (parts.length < 3) {
    problems.push("Faltam partes (TIPO | OBJETIVO | UNIDADE)");
    needsInput = true;
  }
  // Data colada na unidade ("IVS CIDADE - 08/07"): não faz parte do padrão da campanha.
  const withoutDate = unit.replace(/\s*[-–—]\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*$/, "").trim();
  if (withoutDate !== unit) {
    problems.push("UNIDADE com data no final (a campanha não leva data)");
    unit = withoutDate;
  }

  if (problems.length === 0) return OK;
  const suggestion = [type ?? parts[0] ?? "?", objective || "?", unit || "?"].join(" | ");
  if (suggestion.includes("?")) needsInput = true;
  // Etapa 192: "Cópia" sai sozinho. Se era o único problema, aplica a sugestão; senão só tira o "Cópia".
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
  key: "tipo" | "oferta" | "pagto" | "vdo" | "loc" | "idade" | "genero" | "plataforma" | "direc" | "and" | "data";
  text: string;
}

const AGE_RE = /^\d{2}\s*-\s*\d{2}\+?$/;
const DATE_RE = /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/;
const GENDER_WORDS = new Set(["HOMEM", "MULHER", "HOMENS", "MULHERES", "MASCULINO", "FEMININO"]);
const PLATFORM_WORDS = new Set(["INSTA", "INSTAGRAM", "FACE", "FACEBOOK", "IG", "FB"]);

// Fica como pista de OFERTA só o que o sistema não consegue derivar sozinho (idade, data, gênero, localização… saem).
function isOfferPart(raw: string, locNorm: string | null, places: Set<string>): boolean {
  const n = normName(raw);
  if (!n) return false;
  if (AGE_RE.test(n) || DATE_RE.test(n) || GENDER_WORDS.has(n) || PLATFORM_WORDS.has(n)) return false;
  if (n === "INTERESSES" || n === "INTERESSE" || n === "AND" || n === "ANDERSON") return false;
  if (locNorm && n.replace(/\+$/, "") === locNorm.replace(/\+$/, "")) return false;
  if (/\b\d+\s*KM\b/.test(n)) return false; // "8KM", "EFAPI 8 km"
  if (/VIZINH/.test(n) || n.includes("&")) return false; // "AMPARO & CIDADES VIZINHAS"
  if (places.has(n.replace(/\+$/, ""))) return false; // cidade/região que o conjunto segmenta
  if (isGenericOffer(raw)) return false; // "ARMAÇÃO R$ 49,99", "R$ 49,99", "COBRIMOS OFERTAS"
  return true;
}

export interface AdsetFacts {
  name: string;
  createdTime: string | null;
  targeting: TargetingLike | null | undefined;
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

  // 0) CREDIARIO/BOLETO e VDO PROPRIO saem do texto (viram marcas em posição fixa)
  let payment: PaymentTag | null = null;
  let ownVideo = false;
  const cleaned = cur.map((raw) => {
    const t = extractTags(raw);
    payment = payment ?? t.payment;
    ownVideo = ownVideo || t.ownVideo;
    return t.rest;
  });

  // 1) TIPO (GERAL, EXAME ou PROMO) + pistas de oferta que já estão no nome
  const mapped = cleaned[0] ? mapAdsetType(cleaned[0]) : null;
  const offerBits: string[] = [];
  if (mapped?.rest && isOfferPart(mapped.rest, locNorm, places)) offerBits.push(mapped.rest);
  if (!mapped && cleaned[0] && isOfferPart(cleaned[0], locNorm, places)) offerBits.push(cleaned[0]);
  for (let i = 1; i < cleaned.length; i++) if (cleaned[i] && isOfferPart(cleaned[i], locNorm, places)) offerBits.push(cleaned[i]);
  const offer = offerBits.join(" ").trim();

  let tipo: AdsetType;
  if (mapped) tipo = mapped.type;
  else if (!offer) tipo = "GERAL";
  else {
    tipo = "PROMO";
    notes.push("TIPO deduzido como PROMO (o nome antigo não dizia) — confira");
  }

  const date = brtDayMonth(facts.createdTime);
  const parts: Part[] = [{ key: "tipo", text: tipo }];

  // 2) OFERTA: GERAL não leva; PROMO e EXAME precisam
  if (tipo !== "GERAL") {
    if (offer) parts.push({ key: "oferta", text: offer });
    else {
      needsInput = true;
      parts.push({ key: "oferta", text: tipo === "EXAME" ? "OFERTA DO EXAME" : "OFERTA" });
      notes.push(`${tipo} precisa da oferta no nome`);
    }
  }

  // 2b) forma de pagamento e vídeo próprio: logo depois da oferta (nessa ordem)
  if (payment) parts.push({ key: "pagto", text: payment });
  if (ownVideo) parts.push({ key: "vdo", text: OWN_VIDEO_TEXT });

  // 3) localização, idade, gênero, plataforma, direcionamento, AND, data
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
  parts.push({ key: "and", text: MANAGER_TAG });
  if (date) parts.push({ key: "data", text: date });
  else {
    needsInput = true;
    parts.push({ key: "data", text: "DD/MM" });
  }
  return { parts, needsInput, notes };
}

export function checkAdsetName(facts: AdsetFacts): NameCheck {
  const { parts: expected, needsInput, notes } = expectedAdsetParts(facts);
  const suggestion = expected.map((p) => p.text).join(" | ");
  const copy = hasCopy(facts.name);
  const cleanedName = copy ? stripCopy(facts.name) : facts.name;
  // Etapa 192: compara sem o "Cópia" (senão a última parte "21/10 — Cópia" contava como DATA errada).
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
    const labels: Record<Part["key"], string> = {
      tipo: "TIPO",
      oferta: "OFERTA",
      pagto: "PAGAMENTO",
      vdo: "VDO PROPRIO",
      loc: "LOCALIZAÇÃO",
      idade: "IDADE",
      genero: "GÊNERO",
      plataforma: "PLATAFORMA",
      direc: "DIRECIONAMENTO",
      and: "AND",
      data: "DATA",
    };
    for (const k of diffKeys) problems.push(`${labels[k]} fora do padrão`);
    autoFix = problems.length > 0 && diffKeys.every((k) => k === "idade" || k === "data") && !needsInput;
  } else {
    problems.push(`Estrutura fora do padrão (${cur.length} partes, esperado ${expected.length})`);
  }
  for (const n of notes) problems.push(n);
  // Etapa 192: só idade/data (com ou sem "Cópia") → aplica a sugestão completa. Quando o resto precisa de aprovação,
  // o automático ainda assim tira o "Cópia" e acerta a DATA (a parte DD/MM do nome vira a data de criação do
  // conjunto); o resto continua na aba "Padrão de nomes".
  let autoName: string | null = autoFix ? suggestion : null;
  if (!autoName) {
    const date = expected.find((p) => p.key === "data")?.text;
    const partial = cur.map((x) => (date && /^\d{1,2}\/\d{1,2}$/.test(x.trim()) ? date : x)).join(" | ");
    if (partial && normName(partial) !== normName(facts.name)) autoName = partial;
  }
  return { ok: false, problems, suggestion, needsInput, autoFix: !!autoName, autoName };
}

// ---------- anúncio (só "sem cópia") ----------

export function checkAdName(name: string): NameCheck {
  if (!hasCopy(name)) return OK;
  const cleaned = stripCopy(name);
  // Etapa 192: anúncio só tem a regra do "Cópia" — sai sozinho.
  return { ok: false, problems: ['Tem "cópia" no nome'], suggestion: cleaned || null, needsInput: !cleaned, autoFix: !!cleaned, autoName: cleaned || null };
}
