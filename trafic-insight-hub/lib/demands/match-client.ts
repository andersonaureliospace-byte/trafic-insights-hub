// Etapa 68: casa o nome de cliente digitado à mão no WhatsApp
// (client_name_raw) com um cliente já cadastrado em account_bindings — pra
// linkar a demanda à conta certa mesmo com pequenas diferenças de escrita
// (maiúscula, acento, abreviação). Sem match nenhum, a demanda fica sem
// ad_account_id/client_name e a tela usa só o texto cru — pedido explícito:
// pode ter demanda de cliente que nem está cadastrado no Painel.

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ClientCandidate {
  ad_account_id: string;
  client_name: string;
}

export function matchClient(rawName: string, candidates: ClientCandidate[]): ClientCandidate | null {
  const target = normalize(rawName);
  if (!target) return null;

  const exact = candidates.find((c) => normalize(c.client_name) === target);
  if (exact) return exact;

  // Um contém o outro (nome digitado é abreviação, ou tem sufixo/prefixo a
  // mais, ex.: "IVS Rondonópolis" vs "Rondonópolis Marechal") — só considera
  // strings com tamanho mínimo pra não dar match falso em nomes curtos.
  const contains = candidates.find((c) => {
    const n = normalize(c.client_name);
    return n.length > 2 && target.length > 2 && (n.includes(target) || target.includes(n));
  });
  return contains ?? null;
}
