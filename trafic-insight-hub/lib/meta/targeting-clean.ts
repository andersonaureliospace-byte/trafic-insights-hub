// Etapa 236: ajustes no público lido de um conjunto antes de mandar de volta pra Meta (criar cópia, mudar idade).
// A leitura às vezes devolve combinações que o Gerenciador aceita mas a gravação pela API recusa.
export function cleanTargeting(t: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...t };
  // "Para posicionar anúncios na página inicial do Explorar do Instagram, selecione também a seção Explorar do Instagram."
  const ig = out.instagram_positions;
  if (Array.isArray(ig) && ig.includes("explore_home") && !ig.includes("explore")) {
    out.instagram_positions = [...ig, "explore"];
  }
  return out;
}
