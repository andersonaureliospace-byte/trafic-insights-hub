// Painel > Análise: quando um criativo estoura o CPA, além de pausar o
// criativo o gestor também quer pausar o conjunto inteiro (fadiga de
// público/criativo) e já deixar o nome do conjunto marcado, pra achar fácil
// no Gerenciador de Anúncios na hora de recriar manualmente.
//
// ⚠️ Etapas 28/29 tentavam duplicar o conjunto automaticamente pela Graph
// API — mas criar um anúncio novo exige que a Página do criativo esteja
// compartilhada (dono ou parceiro) com o Portfólio de Negócios dono da
// conta, e nem toda conta do usuário tem isso (às vezes o cliente não
// libera, e não tem como contornar — é regra da própria Meta, não um
// detalhe técnico). Por isso simplificado (Etapa 30): só pausa + marca o
// nome, ação que nunca esbarra nessa permissão (não cria nada novo, só edita
// dois objetos que já existem) — recriar o conjunto do zero fica 100%
// manual, no Gerenciador de Anúncios.
import { metaPost } from "./client";
import { setEntitiesStatus } from "./status";

// Pedido explícito: acrescenta "AQUI" no final do nome do conjunto, sem
// duplicar se o botão for clicado de novo por engano.
const NAME_SUFFIX = " AQUI";

export interface PauseAdSetResult {
  newName: string;
}

export async function pauseAdSetAndTag(
  token: string,
  adId: string,
  adsetId: string,
  currentAdSetName: string,
): Promise<PauseAdSetResult> {
  const pauseResults = await setEntitiesStatus(
    token,
    [
      { id: adId, type: "ad" },
      { id: adsetId, type: "adset" },
    ],
    "PAUSED",
  );
  const failed = pauseResults.find((r) => !r.ok);
  if (failed) {
    throw new Error(`Não consegui pausar: ${failed.error}`);
  }

  const base = currentAdSetName || "Conjunto";
  const newName = base.endsWith(NAME_SUFFIX) ? base : `${base}${NAME_SUFFIX}`;
  try {
    await metaPost(token, `/${adsetId}`, { name: newName });
  } catch (e) {
    throw new Error(`Criativo e conjunto pausados, mas não consegui renomear o conjunto: ${(e as Error).message}`);
  }

  return { newName };
}
