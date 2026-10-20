// Banco de vídeos de GERAL (Etapa 160) — os nomes dos anúncios são o nome do vídeo ("GERAL | PREÇO ÚNICO"), igual em todas as contas
// (nomenclatura 100% organizada de outubro/2026 pra cá). Lista informada pelo Anderson; pra incluir vídeo novo, é só acrescentar aqui.
// Código puro (sem Meta), usado pelo servidor e pela tela.

export const VIDEO_BANK_GERAL: readonly string[] = [
  "GERAL | PREÇO ÚNICO",
  "GERAL | É ISSO MESMO",
  "GERAL | ARMAÇÕES A 49,99",
  "GERAL | DÁ UMA OLHADA",
  "GERAL | PROCURANDO ÓCULOS",
  "GERAL | JÁ PENSOU",
  "GERAL | VEM COMIGO",
  "GERAL | QUALIDADE E PREÇO JUSTO",
  "GERAL | QUALIDADE X PREÇO BAIXO",
  "GERAL | QUER COMPRAR SEU ÓCULOS",
  "GERAL | MAIS DE 10 MIL CLIENTES",
  "GERAL | OLHA QUE LINDA",
  "GERAL | EI PSIU",
  "GERAL | NÓS CONTAMOS COM MAIS",
  "GERAL | OLHA ESSE LUGAR QUE INCRÍVEL",
  "GERAL | FACHADA DA LOJA",
  "GERAL | PRECISANDO DE ÓCULOS DE GRAU",
  "GERAL | PROCURANDO ÓCULOS DE GRAU",
  "GERAL | CHEGOU A HORA",
  "GERAL | ESSE É O MELHOR LUGAR",
  "GERAL | JÁ ACONTECEU ISSO COM VOCÊ",
  "GERAL | JÁ TE DISSERAM",
  "GERAL | MAIS BARATO QUE ÓTICA",
  "GERAL | NÃO ACREDITO",
  "GERAL | VOCÊ SABIA",
  "GERAL | É SÓ AQUI",
  "GERAL | QUANTO VC ACHA QUE CUSTA",
  "GERAL | JÁ PENSOU EM COMPRAR",
  "GERAL | TÁ EMBAÇADO POR AI ?",
  "GERAL | OLHA ESSA ARMAÇÃO",
  "GERAL | OLHEM ESSA ARMAÇÃO",
];

// Sem acento, maiúsculo, só letras/números separados por 1 espaço ("GERAL | TÁ EMBAÇADO POR AI ?" → "GERAL TA EMBACADO POR AI").
export function normVideo(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const BANK = VIDEO_BANK_GERAL.map((label) => ({ label, key: normVideo(label) })).sort((a, b) => b.key.length - a.key.length);

export interface VideoMatch {
  key: string;
  label: string;
  inBank: boolean;
}

// Reconhece o vídeo pelo nome do anúncio. Só entram anúncios de GERAL no padrão "GERAL | ..." (os nomes antigos, tipo
// "[ADS Geral Branding] AD 14", ficam de fora). Casa com o MAIOR nome do banco que bate no começo (ex.: "… ÓCULOS DE GRAU" não vira
// "… ÓCULOS"), aceitando sufixos como " - Cópia" ou " v2". Nome "GERAL | …" que não está no banco entra como "fora da lista".
export function matchVideo(adName: string): VideoMatch | null {
  const n = normVideo(adName);
  if (!/^GERAL /.test(n) || !adName.includes("|")) return null;
  for (const v of BANK) {
    if (n === v.key || n.startsWith(`${v.key} `)) return { key: v.key, label: v.label, inBank: true };
  }
  const clean = adName.replace(/\s*[-–—]?\s*[([]?\s*(c[oó]pia|copy)(\s*(de|of))?(\s*\d+)?\s*[)\]]?/gi, "").replace(/\s{2,}/g, " ").trim();
  return { key: normVideo(clean), label: clean, inBank: false };
}
