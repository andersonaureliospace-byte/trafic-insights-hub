// Etapa 70: dataset inicial do Gerador de Copy (IVS) — semeado por
// subcategoria (ver app/api/copy/subcategories/route.ts: cada subcategoria
// daqui que ainda não existe pro usuário é criada na primeira abertura da
// aba Copy, sem duplicar nem sobrescrever o que o usuário já tiver mexido).
// Os exemplos de `copy`/`oferta`/`cta`/`condicao` dos modelos são recortes
// reais de anúncio do Instituto Visão Solidária (analisados a pedido do
// usuário) — servem só de referência de padrão (few-shot) pra IA, nunca são
// usados literalmente numa geração. "Qualidade" (Geral), "Padrão" e
// "Armação 1 real" (Inauguração) ainda não têm modelo real — a geração pra
// elas conta só com a descrição de estrutura fixa no prompt (ver
// lib/ai/gemini.ts) até o usuário cadastrar exemplos próprios pela tela.
//
// Etapa 70 (ajuste): oferta/condicao/tom de cada subcategoria daqui foram
// fixados a partir do modelo real mais representativo (mesmo texto que já
// aparecia repetido em quase todas as variações daquela oferta) — deixa de
// ser a IA reinventando a condição a cada geração. "Neutro" (Geral) é nova,
// fixa (não pode ser apagada/renomeada pela tela) e representa comunicação
// sem gatilho/tom nenhum.
import type { CopyCategory, CopyExtraField } from "@/lib/copy/types";

export interface SeedReferenceModel {
  endereco_exemplo: string;
  copy: string;
  oferta: string;
  cta: string;
  condicao: string;
}

export interface SeedSubcategory {
  category: CopyCategory;
  name: string;
  extra_fields: CopyExtraField[];
  oferta: string;
  condicao: string;
  tom: string;
  fixed: boolean;
  models: SeedReferenceModel[];
}

const DATA_INAUGURACAO_FIELD: CopyExtraField = { key: "data_inauguracao", label: "Data da inauguração" };
const VALOR_EXAME_FIELD: CopyExtraField = { key: "valor", label: "Valor do exame" };

export const DEFAULT_SUBCATEGORIES: SeedSubcategory[] = [
  {
    category: "geral",
    name: "Neutro",
    extra_fields: [],
    oferta: "",
    condicao: "",
    tom: "neutro",
    fixed: true,
    models: [],
  },
  {
    category: "geral",
    name: "Cobrimos oferta",
    extra_fields: [],
    oferta: "Armação por R$ 49,99 na compra das lentes",
    condicao: "*: O valor promocional da armação é aplicado mediante a compra das lentes.",
    tom: "",
    fixed: false,
    models: [
      {
        endereco_exemplo: "R. XV de Novembro, 563 - Centro, BLUMENAU",
        copy:
          "🔵 Vai comprar óculos novo? Não feche negócio em BLUMENAU sem antes ver este vídeo!\n\n" +
          "👓 Nós desafiamos a concorrência: traga seu orçamento e nós cobrimos o valor! Qualquer armação da promoção sai por um preço único de R$ 49,99.\n\n" +
          "💰 Essa é a oportunidade definitiva para quem precisa trocar os óculos agora, não quer perder tempo com pesquisas e exige economia real.\n\n" +
          "BARATO QUE ÓTICA? SÓ AQUI NO INSTITUTO VISÃO SOLIDÁRIA 😍",
        oferta: "Armação por R$ 49,99 na compra das lentes",
        cta: "📲 Clique no botão abaixo para apresentar sua receita e finalizar seu pedido com a nossa equipe no WhatsApp",
        condicao: "*: O valor promocional da armação é aplicado mediante a compra das lentes.",
      },
      {
        endereco_exemplo: "R. XV de Novembro, 563 - Centro, BLUMENAU",
        copy:
          "🚨 Cansado de preços abusivos na hora de fazer seus óculos em BLUMENAU? Venha direto para quem garante o menor valor!\n\n" +
          "👓 O óculos completo mais barato está aqui: nós cobrimos qualquer oferta! Armações que custam 300, 500, até 1000 reais lá fora saem por APENAS R$ 49,99.\n\n" +
          "✨ Tenha a segurança do Instituto Visão Solidária e a certeza de fazer o melhor negócio. Feito para quem quer resolver logo e não perder tempo!\n\n" +
          "BARATO QUE ÓTICA? SÓ AQUI NO INSTITUTO VISÃO SOLIDÁRIA 😍",
        oferta: "Armação por R$ 49,99 na compra das lentes",
        cta: "📲 Pronto para comprar seus óculos? Clique agora e conclua seu atendimento com nossos consultores no WhatsApp.",
        condicao: "* Preço da armação a R$ 49,99 válido somente na aquisição das lentes.",
      },
    ],
  },
  {
    category: "geral",
    name: "Qualidade",
    extra_fields: [],
    oferta: "",
    condicao: "",
    tom: "",
    fixed: false,
    models: [],
  },
  {
    category: "promocao",
    name: "Armação por 1 real",
    extra_fields: [],
    oferta: "Voucher de R$ 1,00 na armação, na compra das lentes",
    condicao: "*: O valor promocional da armação é aplicado mediante a compra das lentes.",
    tom: "",
    fixed: false,
    models: [
      {
        endereco_exemplo: "R. Quintino Bocaiúva, 367 - Centro, Itatiba - SP",
        copy:
          "🔵 ATENÇÃO ITATIBA E REGIÃO 🔵\n\n" +
          "🚨 Cansado de pagar caro nos seus óculos novos? Pare tudo! 🚨\n\n" +
          "No INSTITUTO VISÃO SOLIDÁRIA você garante seu VOUCHER DE R$ 1,00 para economizar de verdade! ✅\n\n" +
          "São mais de 2.000 modelos de armações lindas para você escolher! 🔥🔥\n\n" +
          "+ BARATO QUE ÓTICA? SÓ AQUI NO INSTITUTO VISÃO SOLIDÁRIA 😍",
        oferta: "Voucher de R$ 1,00 na armação, na compra das lentes",
        cta: "📲 Clique no botão abaixo e resgate seu voucher no WhatsApp!",
        condicao: "*: O valor promocional da armação é aplicado mediante a compra das lentes.",
      },
      {
        endereco_exemplo: "R. Quintino Bocaiúva, 367 - Centro, Itatiba - SP",
        copy:
          "🚨 AVISO URGENTE PARA ITATIBA E REGIÃO 🚨\n\n" +
          "Espere antes de comprar seus óculos em qualquer outro lugar! 😱\n\n" +
          "No INSTITUTO VISÃO SOLIDÁRIA, liberamos um VOUCHER DE R$ 1,00 por tempo limitadíssimo! ✅\n\n" +
          "Venha conferir mais de 2 MIL opções de armações esperando por você! 😏🔥🔥\n\n" +
          "O menor preço da cidade você só encontra aqui 💙",
        oferta: "Voucher de R$ 1,00 na armação, na compra das lentes",
        cta: "👉 Clique em qualquer lugar da tela e chame no WhatsApp agora mesmo!",
        condicao: "*: O valor promocional da armação é aplicado mediante a compra das lentes.",
      },
    ],
  },
  {
    category: "promocao",
    name: "Compre um leve 3",
    extra_fields: [],
    oferta: "Compre 1 lente e leve a armação + tratamento antirreflexo de presente",
    condicao:
      '*A promoção "Compre 1 Leve 3" é válida exclusivamente na compra das lentes, onde o cliente ganha a armação e o tratamento antirreflexo. Consulte o regulamento.',
    tom: "",
    fixed: false,
    models: [
      {
        endereco_exemplo: "Rua Doutor Martiniano, 17 - Centro, GUARATINGUETÁ",
        copy:
          "🔵 Por que pagar mais caro se você pode ter o pacote completo por uma fração do preço?\n\n" +
          "👓 Chegou a promoção COMPRE 1 E LEVE 3! É simples e direto: você compra as suas lentes com a gente e leva NA HORA a armação + o tratamento antirreflexo de presente!\n\n" +
          "🚀 Chega de adiar o cuidado com a sua visão por causa de preços altos nas óticas tradicionais. Nossos estoques estão voando com essa condição imperdível e você precisa agir rápido para garantir o seu.\n\n" +
          "MAIS BARATO QUE ÓTICA TRADICIONAL? SÓ AQUI NO INSTITUTO VISÃO SOLIDÁRIA 😍",
        oferta: "Compre 1 lente e leve a armação + tratamento antirreflexo de presente",
        cta: "📲 Pegue sua receita, clique no botão agora mesmo e fale com nossos especialistas antes que as melhores armações acabem!",
        condicao:
          '*A promoção "Compre 1 Leve 3" é válida exclusivamente na compra das lentes, onde o cliente ganha a armação e o tratamento antirreflexo. Consulte o regulamento.',
      },
      {
        endereco_exemplo: "Rua Doutor Martiniano, 17 - Centro, GUARATINGUETÁ",
        copy:
          "🔵 O fim dos preços absurdos em óculos de grau chegou para você em GUARATINGUETÁ!\n\n" +
          "👓 Já imaginou pagar apenas pelas lentes e sair com os óculos completos? Na nossa super campanha COMPRE 1 LEVE 3, você adquire as lentes e nós te damos a armação e o antirreflexo!\n\n" +
          "🚀 Nossa loja está cheia porque entregamos qualidade premium, atendimento personalizado e um preço que você não vai encontrar em nenhum outro lugar. Quem compara, fecha negócio na mesma hora!\n\n" +
          "BARATO QUE ÓTICA? SÓ AQUI NO INSTITUTO VISÃO SOLIDÁRIA 😍",
        oferta: "Compre 1 lente e leve a armação + tratamento antirreflexo de presente",
        cta: "📲 Não perca essa chance de enxergar bem pagando o preço justo. Clique no botão, chame nossa equipe e garanta seu orçamento!",
        condicao:
          '*A promoção "Compre 1 Leve 3" é válida exclusivamente na compra das lentes, garantindo ao cliente a armação e o antirreflexo de presente. Consulte o regulamento na loja.',
      },
    ],
  },
  {
    category: "promocao",
    name: "Multifocal em dobro",
    extra_fields: [],
    oferta: "Lentes multifocais em dobro (compre uma, ganhe outra) + armação por R$ 49,99",
    condicao:
      "*O segundo par de lentes de presente e a armação por R$ 49,99 são ofertas vinculadas à compra do primeiro par de lentes.",
    tom: "",
    fixed: false,
    models: [
      {
        endereco_exemplo: "AV Bayer filho, 720, Centro",
        copy:
          "🚨 Oferta exclusiva para quem não quer perder tempo e já está pronto para renovar os óculos!\n\n" +
          "👓 A realidade que o seu bolso pediu: lentes multifocais em dobro (compre uma, ganhe outra) e armações de alto padrão por apenas R$ 49,99.\n\n" +
          "💡 Escolha inteligente para quem busca o máximo conforto visual e se recusa a pagar os preços inflacionados do mercado. Compre hoje, de forma prática e direta.\n\n" +
          "MAIS BARATO QUE ÓTICA? SÓ AQUI NO INSTITUTO VISÃO SOLIDÁRIA 😍",
        oferta: "Lentes multifocais em dobro (compre uma, ganhe outra) + armação por R$ 49,99",
        cta: "📲 Se você já tomou a decisão de economizar, clique aqui e envie sua receita direto no nosso WhatsApp!",
        condicao:
          "*O segundo par de lentes de presente e a armação por R$ 49,99 são ofertas vinculadas à compra do primeiro par de lentes.",
      },
      {
        endereco_exemplo: "Rua Piaui, 461, centro, LUIZ EDUARDO MAGALHAES",
        copy:
          "🔵 Político promete, mas em LUIZ EDUARDO MAGALHAES o Instituto Visão Solidária entrega resultados para quem quer fechar negócio agora!\n\n" +
          "👓 Lentes multifocais em dobro! Você compra o primeiro par e ganha o segundo de presente. E a armação? Preço único de R$ 49,99.\n\n" +
          "💰 Sem pegadinhas e sem enrolação. Maior campo de visão e conforto imediato, feito exclusivamente para clientes decididos que valorizam o próprio dinheiro.\n\n" +
          "MAIS BARATO QUE ÓTICA? SÓ AQUI NO INSTITUTO VISÃO SOLIDÁRIA 😍",
        oferta: "Lentes multifocais em dobro (compre uma, ganhe outra) + armação por R$ 49,99",
        cta: "📲 Já tem sua receita oftalmológica? Clique abaixo, acione nossos consultores no WhatsApp e conclua sua compra.",
        condicao:
          "* A bonificação do segundo par e o valor da armação a R$ 49,99 são válidos exclusivamente na aquisição das lentes.",
      },
    ],
  },
  {
    category: "exames",
    name: "Exame por R$ 49,99",
    extra_fields: [],
    oferta: "Exame de vista por R$ 49,99",
    condicao: "",
    tom: "",
    fixed: false,
    models: [
      {
        endereco_exemplo: "Rua Doutor Martiniano, 17 - Centro, GUARATINGUETÁ",
        copy:
          "🚨 AVISO PARA GUARATINGUETÁ E REGIÃO 🚨\n\n" +
          "🚨 Não compre seus óculos nem faça seu exame ainda sem ver essa condição do INSTITUTO VISÃO SOLIDÁRIA 😍\n\n" +
          "Chegou a oportunidade que você tanto esperava para cuidar da sua saúde visual!\n\n" +
          "Se você procura qualidade e preço justo, aqui o seu exame de vista sai a preço ÚNICO DE R$ 49,99 ✅\n\n" +
          "São mais de 2.000 modelos de armações para você escolher! 🔥🔥\n\n" +
          "BARATO QUE ÓTICA? SÓ AQUI NO INSTITUTO VISÃO SOLIDÁRIA 😍",
        oferta: "Exame de vista por R$ 49,99",
        cta: "📲 Clique no botão abaixo e fale conosco no WhatsApp!",
        condicao: "",
      },
      {
        endereco_exemplo: "Rua Doutor Martiniano, 17 - Centro, GUARATINGUETÁ",
        copy:
          "🚨 AVISO PARA GUARATINGUETÁ E REGIÃO 🚨\n\n" +
          "O INSTITUTO VISÃO SOLIDÁRIA tem a melhor condição da cidade para você! 😍\n\n" +
          "Já fez seu exame de vista este ano? 🤓\n\n" +
          "Aqui você não precisa pagar caro pela sua saúde visual. Você garante seu exame por APENAS R$ 49,99 ✅\n\n" +
          "E ainda confere + de 2 MIL armações de alta qualidade esperando por você! 🔥🔥\n\n" +
          "PREÇO MELHOR QUE DE ÓTICA? SÓ AQUI 😍",
        oferta: "Exame de vista por R$ 49,99",
        cta: "👉 Clique em qualquer lugar da tela e fale com nossa equipe!",
        condicao: "",
      },
    ],
  },
  {
    // Sem exemplo real nesse preço específico — adaptado do mesmo modelo
    // "PADRÃO" de Exame (que no material original usava um preço-placeholder
    // "POPULAR" pra ser substituído), só trocando o valor.
    category: "exames",
    name: "Exame por R$ 29,99",
    extra_fields: [],
    oferta: "Exame de vista por R$ 29,99",
    condicao: "",
    tom: "",
    fixed: false,
    models: [
      {
        endereco_exemplo: "Rua Doutor Martiniano, 17 - Centro, GUARATINGUETÁ",
        copy:
          "🚨 AVISO PARA GUARATINGUETÁ E REGIÃO 🚨\n\n" +
          "🚨 Não compre seus óculos nem faça seu exame ainda sem ver essa condição do INSTITUTO VISÃO SOLIDÁRIA 😍\n\n" +
          "Chegou a oportunidade que você tanto esperava para cuidar da sua saúde visual!\n\n" +
          "Se você procura qualidade e preço justo, aqui o seu exame de vista sai a preço ÚNICO DE R$ 29,99 ✅\n\n" +
          "São mais de 2.000 modelos de armações para você escolher! 🔥🔥\n\n" +
          "BARATO QUE ÓTICA? SÓ AQUI NO INSTITUTO VISÃO SOLIDÁRIA 😍",
        oferta: "Exame de vista por R$ 29,99",
        cta: "📲 Clique no botão abaixo e fale conosco no WhatsApp!",
        condicao: "",
      },
    ],
  },
  {
    category: "inauguracao",
    name: "Armação 1 real",
    extra_fields: [DATA_INAUGURACAO_FIELD],
    oferta: "",
    condicao: "",
    tom: "",
    fixed: false,
    models: [],
  },
  {
    category: "inauguracao",
    name: "Padrão",
    extra_fields: [DATA_INAUGURACAO_FIELD],
    oferta: "",
    condicao: "",
    tom: "",
    fixed: false,
    models: [],
  },
  {
    category: "inauguracao",
    name: "Exame",
    extra_fields: [DATA_INAUGURACAO_FIELD, VALOR_EXAME_FIELD],
    // oferta fica vazia de propósito — o valor do exame na inauguração vem
    // do campo extra "Valor do exame", preenchido a cada geração (varia por
    // unidade/data), não é fixo na subcategoria como nas outras.
    oferta: "",
    condicao: "",
    tom: "",
    fixed: false,
    models: [
      {
        endereco_exemplo: "R BARAO DO MONTE ALTO, 67 - CENTRO, GUARATINGUETÁ",
        copy:
          "🚨 AVISO PARA GUARATINGUETÁ E REGIÃO 🚨\n\n" +
          "🚨 Não compre seus óculos nem faça seu exame ainda... 06 de outubro, terça-feira é a grande inauguração do INSTITUTO VISÃO SOLIDÁRIA 😍\n\n" +
          "Chegou a oportunidade que você tanto esperava!\n\n" +
          "Se você procura qualidade e preço justo, o seu exame de vista sai a preço ÚNICO DE POPULAR ✅\n\n" +
          "São mais de 2.000 modelos de armações para você escolher! 🔥🔥\n\n" +
          "+ BARATO QUE ÓTICA? SÓ AQUI NO INSTITUTO VISÃO SOLIDÁRIA 😍",
        oferta: "Exame de vista por POPULAR (valor de abertura), no dia da inauguração (06 de outubro, terça-feira)",
        cta: "📲 Clique no botão abaixo e fale conosco no WhatsApp!",
        condicao: "",
      },
      {
        endereco_exemplo: "R BARAO DO MONTE ALTO, 67 - CENTRO, GUARATINGUETÁ",
        copy:
          "🚨 AVISO PARA GUARATINGUETÁ E REGIÃO 🚨\n\n" +
          "Segure a compra dos seus óculos... 06 de outubro, terça-feira inaugura o INSTITUTO VISÃO SOLIDÁRIA! 😍\n\n" +
          "Para comemorar a nossa chegada, o exame de vista sai por APENAS POPULAR ✅\n\n" +
          "São mais de 2.000 opções de armações incríveis para toda a família! 🔥🔥\n\n" +
          "MAIS BARATO QUE ÓTICA TRADICIONAL? SÓ NO INSTITUTO VISÃO SOLIDÁRIA 😍",
        oferta: "Exame de vista por POPULAR (valor de abertura), no dia da inauguração (06 de outubro, terça-feira)",
        cta: "📲 Clique no botão e fale direto com a nossa equipe!",
        condicao: "",
      },
    ],
  },
];
