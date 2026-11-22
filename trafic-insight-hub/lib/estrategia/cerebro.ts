// Etapa 344: "Cérebro" da IA do quadro Alertas — o que a IA sabe dos clientes antes de sugerir tarefas e escrever a ordem
// pro gestor. Fica em user_ui_prefs ("ia_cerebro"), editável em Acompanhamento → Alertas → 🧠 Cérebro da IA.
export const CEREBRO_KEY = "ia_cerebro";
export const ORDEM_PREFIX = "ord|"; // ordens pro gestor ficam em estr_tarefas (tipo "alerta") com esse origem_key

export const CEREBRO_PADRAO = [
  "Clientes da franquia IVS (Instituto Visão Solidária), rede de óticas. As campanhas do Meta buscam conversas no WhatsApp (leads); CPA = custo por conversa.",
  "Os criativos são padronizados entre as unidades da franquia.",
  "Ofertas: o nome de cada conjunto começa com a oferta.",
  "- GERAL: a oferta principal (todas as contas anunciam).",
  "- EXAME: exame de vista. Se o CPA do EXAME sobe, normalmente a saída é trocar o criativo.",
  "- PROMO: promoções.",
  "Otimização: CPA acima do ideal pede pausar conjuntos/criativos caros e subir criativos novos; investimento atrasado pede subir o orçamento diário.",
  "Prazos de otimização: inauguração e sensíveis até 09h, críticas até 10h, altas até 12h, médias até 15h, baixas até 16h.",
].join("\n");
