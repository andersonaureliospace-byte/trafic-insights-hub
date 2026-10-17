// Padrão de nomes (Etapa 140) — regras PURAS (sem Meta/banco), testáveis.
//
// Campanha:  TIPO | OBJETIVO | UNIDADE            (TIPO: só GERAL, EXAME ou OFERTA)
// Conjunto:  TIPO | OFERTA | LOCALIZAÇÃO OU KM | IDADE | GENERO | PLATAFORMA | DIRECIONAMENTO | AND | DATA
//   - LOCALIZAÇÃO: km do raio (ex.: 10KM) ou a cidade; mais de uma cidade/ponto → primeiro nome com "+" (ex.: CHAPECÓ+)
//   - IDADE: min-max ("18-65+" quando o máximo é 65 ou mais)
//   - GENERO / PLATAFORMA: só aparecem quando é UM só (MULHER/HOMEM; INSTA/FACE). Ambos → omite.
//   - DIRECIONAMENTO: só "INTERESSES", e só quando o conjunto tem interesses
//   - AND: fixo (abreviação do nome do gestor)
//   - DATA: dia/mês da criação do conjunto (ex.: 17/10), horário de Brasília
// "Cópia" não pode aparecer em nenhum nome (campanha, conjunto, anúncio). Nome repetido pode.

export const CAMPAIGN_TYPES = ["GERAL", "EXAME", "OFERTA"] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
export const MANAGER_TAG = "AND";
export const DEFAULT_OFFER = "R$ 49,99";

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
  if (["OFERTA", "OFERTAS", "PROMO", "PROMOCAO", "PROMOCOES", "CREDIARIO", "CREDIARIOS"].includes(n)) return "OFERTA";
  return null;
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
  autoFix: boolean; // true = só idade e/ou data divergem (ajuste automático, sem aprovação)
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
  return { ok: false, problems, suggestion, needsInput, autoFix: false };
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
  if (cities.length === 1) {
    const km = kmOf(cities[0].radius, cities[0].distance_unit);
    if (km) return `${km}KM`;
    return cities[0].name ? cities[0].name.toUpperCase() : null;
  }
  if (cities.length > 1) return cities[0].name ? `${cities[0].name.toUpperCase()}+` : null;
  if (pins.length > 0) {
    const km = kmOf(pins[0].radius, pins[0].distance_unit);
    if (km) return `${km}KM${pins.length > 1 ? "+" : ""}`;
    return pins[0].name ? `${pins[0].name.toUpperCase()}${pins.length > 1 ? "+" : ""}` : null;
  }
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
  key: "tipo" | "oferta" | "loc" | "idade" | "genero" | "plataforma" | "direc" | "and" | "data";
  text: string;
}

const AGE_RE = /^\d{2}\s*-\s*\d{2}\+?$/;
const DATE_RE = /^\d{1,2}\/\d{1,2}$/;
const GENDER_WORDS = new Set(["HOMEM", "MULHER", "HOMENS", "MULHERES", "MASCULINO", "FEMININO"]);
const PLATFORM_WORDS = new Set(["INSTA", "INSTAGRAM", "FACE", "FACEBOOK", "IG", "FB"]);

// Texto da oferta que já existe no nome (o que sobra depois de tirar os pedaços que o sistema consegue derivar sozinho).
function extractOffer(parts: string[], locNorm: string | null, places: Set<string>): string {
  const leftovers: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const raw = parts[i];
    const n = normName(raw);
    if (AGE_RE.test(n) || DATE_RE.test(n) || GENDER_WORDS.has(n) || PLATFORM_WORDS.has(n)) continue;
    if (n === "INTERESSES" || n === "INTERESSE" || n === "AND" || n === "ANDERSON") continue;
    if (locNorm && n.replace(/\+$/, "") === locNorm.replace(/\+$/, "")) continue;
    if (/^\d+\s*KM\+?$/.test(n)) continue;
    if (places.has(n.replace(/\+$/, ""))) continue; // cidade/região que o conjunto segmenta (nome antigo com a localização)
    leftovers.push(raw);
  }
  return leftovers.join(" ").trim();
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

  let tipo: string | null = cur[0] ? mapType(cur[0]) : null;
  if (!tipo) {
    tipo = "GERAL";
    needsInput = true;
    notes.push("Não deu pra saber o TIPO (GERAL, EXAME ou OFERTA) — confira");
  }
  const places = new Set<string>();
  const geo = facts.targeting?.geo_locations;
  for (const x of [...(geo?.cities ?? []), ...(geo?.custom_locations ?? []), ...(geo?.regions ?? [])]) {
    if (x.name) places.add(normName(x.name));
  }
  let offer = extractOffer(cur, locNorm, places);
  // nome antigo sem tipo reconhecido: a 1ª parte também é pista de oferta
  if (!mapType(cur[0] ?? "") && cur[0]) offer = `${cur[0]} ${offer}`.trim();
  if (!offer) {
    if (tipo === "EXAME") {
      needsInput = true;
      offer = "OFERTA DO EXAME";
      notes.push("EXAME precisa da oferta do exame no nome");
    } else {
      offer = DEFAULT_OFFER;
    }
  }

  const date = brtDayMonth(facts.createdTime);
  const parts: Part[] = [
    { key: "tipo", text: tipo },
    { key: "oferta", text: offer },
  ];
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
  const cur = splitParts(facts.name);
  const problems: string[] = [];

  if (hasCopy(facts.name)) problems.push('Tem "cópia" no nome');

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
      loc: "LOCALIZAÇÃO",
      idade: "IDADE",
      genero: "GÊNERO",
      plataforma: "PLATAFORMA",
      direc: "DIRECIONAMENTO",
      and: "AND",
      data: "DATA",
    };
    for (const k of diffKeys) problems.push(`${labels[k]} fora do padrão`);
    autoFix = problems.length > 0 && diffKeys.length > 0 && diffKeys.every((k) => k === "idade" || k === "data") && !hasCopy(facts.name) && !needsInput;
  } else {
    problems.push(`Estrutura fora do padrão (${cur.length} partes, esperado ${expected.length})`);
  }
  for (const n of notes) problems.push(n);
  return { ok: false, problems, suggestion, needsInput, autoFix };
}

// ---------- anúncio (só "sem cópia") ----------

export function checkAdName(name: string): NameCheck {
  if (!hasCopy(name)) return OK;
  const cleaned = stripCopy(name);
  return { ok: false, problems: ['Tem "cópia" no nome'], suggestion: cleaned || null, needsInput: !cleaned, autoFix: false };
}
