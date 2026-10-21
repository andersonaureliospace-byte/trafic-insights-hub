// Banco de vídeos de GERAL (Etapa 160) — os nomes dos anúncios são o nome do vídeo ("GERAL | PREÇO ÚNICO"), igual em todas as contas
// (nomenclatura 100% organizada de outubro/2026 pra cá). Desde a Etapa 177 a lista vive no banco (tabela video_bank) e é editada em
// Configurações → Vídeos gerais; a lista abaixo é só a PADRÃO (usada se a tabela ainda não existir). Código puro (sem Meta).

export const DEFAULT_VIDEO_BANK: readonly string[] = [
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

export interface VideoMatch {
  key: string;
  label: string;
  inBank: boolean;
}

// Entrada da lista (nome → chave normalizada). Usada pra montar a lista de vídeos mesmo sem nenhum anúncio.
export function bankEntry(label: string): VideoMatch {
  return { key: normVideo(label), label, inBank: true };
}

// Monta o reconhecedor de vídeo a partir da lista de nomes. Reconhece o vídeo pelo nome do anúncio. Só entram anúncios de GERAL no padrão
// "GERAL | ..." (os nomes antigos, tipo "[ADS Geral Branding] AD 14", ficam de fora). Casa com o MAIOR nome da lista que bate no começo
// (ex.: "… ÓCULOS DE GRAU" não vira "… ÓCULOS"), aceitando sufixos como " - Cópia" ou " v2". Nome "GERAL | …" que não está na lista entra
// como "fora da lista".
export function createVideoMatcher(labels: readonly string[]): (adName: string) => VideoMatch | null {
  const bank = labels.map(bankEntry).sort((a, b) => b.key.length - a.key.length);
  return (adName: string) => {
    const n = normVideo(adName);
    if (!/^GERAL /.test(n) || !adName.includes("|")) return null;
    for (const v of bank) {
      if (n === v.key || n.startsWith(`${v.key} `)) return { key: v.key, label: v.label, inBank: true };
    }
    const clean = adName.replace(/\s*[-–—]?\s*[([]?\s*(c[oó]pia|copy)(\s*(de|of))?(\s*\d+)?\s*[)\]]?/gi, "").replace(/\s{2,}/g, " ").trim();
    return { key: normVideo(clean), label: clean, inBank: false };
  };
}
