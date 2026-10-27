// Etapa 213: catálogo das automações — o que cada uma faz e quando roda (horário de Brasília).
// Aparece em Auditoria → Alertas → "Automações". Os horários são os do fluxo do n8n "Pausas e avisos automáticos"
// (n8n-workflows/pausas-e-avisos-automaticos.json): se mudar o horário lá, atualize aqui também.
// `id` = nome usado no Registro das automações (lib/automation-labels.ts); `mode` separa as rodadas da mesma automação.

export interface AutomationInfo {
  id: string;
  mode?: string;
  group: "Pausas e orçamento" | "Avisos" | "Verificações" | "Fim de semana" | "Retratos e sincronização";
  name: string;
  when: string;
  what: string;
  whatsapp: boolean; // manda aviso pro grupo do WhatsApp
}

export const AUTOMATION_CATALOG: AutomationInfo[] = [
  // ---------- Pausas e orçamento (uma cadeia: backup → criativos → fila → conjuntos) ----------
  {
    id: "pause-backup",
    group: "Pausas e orçamento",
    name: "Backup (reativação)",
    when: "01h10, 04h10, 07h10, 11h10, 13h40, 16h10, 19h10 e 22h10 — abre a cadeia de pausas",
    what: "Reativa criativos e conjuntos pausados pela automação nas últimas 6h que ganharam conversa depois da pausa.",
    whatsapp: false,
  },
  {
    id: "creatives-pause",
    group: "Pausas e orçamento",
    name: "Pausa de criativos — 1ª etapa (análise)",
    when: "Logo depois do Backup (mesmos 8 horários)",
    what: "Analisa os criativos ativos: custo por conversa R$4+ acima do CPA ideal em ontem + hoje, sem histórico bom nos 7 dias, entra na fila pra pausar. Freio de 70% por conjunto (quem passa de 3x o ideal sempre entra). No fim de semana, primeiro reduz o conjunto pra R$10.",
    whatsapp: false,
  },
  {
    id: "creatives-pause-queue",
    group: "Pausas e orçamento",
    name: "Pausa de criativos — 2ª etapa (fila)",
    when: "Logo depois da 1ª etapa",
    what: "Pausa os criativos da fila (4 por vez) e avisa quais foram pausados. O que não der tempo fica pra próxima chamada.",
    whatsapp: false,
  },
  {
    id: "adsets-pause",
    group: "Pausas e orçamento",
    name: "Pausa / corte de conjuntos",
    when: "Logo depois da pausa de criativos (mesmos 8 horários)",
    what: "Pausa ou corta o orçamento de conjuntos com CPA acima da meta nos últimos 3 e 7 dias. Conjunto com menos de 48h, ou que saiu do standby há menos de 48h, não é mexido por desempenho.",
    whatsapp: false,
  },
  {
    id: "budget-plan",
    group: "Pausas e orçamento",
    name: "Plano de aumento de investimento",
    when: "Todo dia às 03h45",
    what: "Monta o plano de aumento olhando os últimos 3 dias (sem hoje). Não mexe na Meta.",
    whatsapp: false,
  },
  {
    id: "budget-apply",
    group: "Pausas e orçamento",
    name: "Aplicar aumento de investimento",
    when: "Todo dia das 06h01 às 06h11, a cada 2 min",
    what: "Aplica o plano: até R$1 acima da meta (ou abaixo) +R$10; até R$2 acima +R$5. Teto de R$30 por dia.",
    whatsapp: false,
  },
  {
    id: "bulk-status",
    group: "Pausas e orçamento",
    name: "Prioridade em massa",
    when: "Segunda e quinta à 01h",
    what: "Atualiza a prioridade de todos os clientes no Traffic pelo CPA dos últimos 3 dias, sem contar hoje.",
    whatsapp: false,
  },
  // ---------- Avisos ----------
  {
    id: "cpa-alert",
    group: "Avisos",
    name: "CPA acima da meta",
    when: "06h (ontem, +R$4), 12h (hoje, +R$20) e 18h30 (hoje, +R$10)",
    what: "Lista as contas com CPA acima do ideal pelo corte de cada horário, da mais crítica pra menos.",
    whatsapp: true,
  },
  {
    id: "low-budget",
    group: "Avisos",
    name: "Invest. diário ≤ 55% do Ritmo",
    when: "07h e 16h",
    what: "Avisa as contas com orçamento diário em 55% ou menos do Ritmo. Só avisa, não mexe.",
    whatsapp: true,
  },
  {
    id: "balance-alert",
    group: "Avisos",
    name: "Saldo / pagamento / sexta",
    when: "Segunda a sábado 07h30, 12h30, 16h30 e 19h30",
    what: "Saldo baixo, erro no pagamento e, na sexta, o saldo pro fim de semana.",
    whatsapp: true,
  },
  {
    id: "balance-evening",
    group: "Avisos",
    name: "Saldo para amanhã",
    when: "Segunda a sexta às 19h",
    what: "Contas Pix/Híbrida em que o saldo menos o Ritmo de amanhã fica abaixo do limite.",
    whatsapp: true,
  },
  {
    id: "morning-summary",
    group: "Avisos",
    name: "Resumo das 7h",
    when: "Todo dia às 07h05",
    what: "Soma pontos de cada conta (status, CPA, investimento, saldo, pagamento…) e lista as que precisam de atenção.",
    whatsapp: true,
  },
  {
    id: "no-delivery",
    group: "Avisos",
    name: "Conta sem anúncio ativo / sem entrega",
    when: "De hora em hora, das 08h20 às 20h20",
    what: "Avisa conta sem nenhum anúncio ativo ou sem entrega.",
    whatsapp: true,
  },
  // ---------- Verificações ----------
  {
    id: "audit",
    mode: "errors",
    group: "Verificações",
    name: "Erros de veiculação",
    when: "De hora em hora no minuto 50 (menos 08h, 10h e 14h)",
    what: "Anúncio reprovado, com problema ou pendência de cobrança: avisa no WhatsApp (cada erro uma vez só). Conjunto ativo sem anúncio ativo é pausado sem aviso.",
    whatsapp: true,
  },
  {
    id: "audit",
    mode: "recent",
    group: "Verificações",
    name: "Localização — conjuntos novos",
    when: "A cada 30 min (conjuntos criados/alterados nos últimos 45 min)",
    what: "Conjunto com Brasil inteiro é pausado; expansão de público ligada é desligada (o conjunto segue ativo).",
    whatsapp: false,
  },
  {
    id: "audit",
    mode: "location",
    group: "Verificações",
    name: "Localização — todos os conjuntos",
    when: "12h50 e 22h50",
    what: "Mesma regra da localização, varrendo todos os conjuntos ativos.",
    whatsapp: false,
  },
  {
    id: "naming-fix",
    group: "Verificações",
    name: "Padrão de nomes",
    when: "04h30, 07h30, 12h30, 17h30, 20h30 e 23h30",
    what: "Tira o \"Cópia\" dos nomes e acerta data e idade dos conjuntos sozinho. O resto fica na aba Padrão de nomes pra aprovar.",
    whatsapp: false,
  },
  {
    id: "exam-check",
    group: "Verificações",
    name: "Conta sem conjunto de EXAME",
    when: "09h05, 12h05, 15h05 e 18h05",
    what: "Conta marcada como \"precisa de exame\" sem nenhum conjunto de EXAME ativo.",
    whatsapp: false,
  },
  // ---------- Fim de semana ----------
  {
    id: "weekend-standby",
    group: "Fim de semana",
    name: "Standby de fim de semana",
    when: "Sábado 00h30 (roda 3x: 00h30, 00h40, 00h50)",
    what: "Conjuntos de bom desempenho (CPA 7 dias abaixo da meta) ou com mais de 3 dias ativos vão pra R$10, criativos intocados.",
    whatsapp: false,
  },
  {
    id: "weekend-release",
    group: "Fim de semana",
    name: "Volta do standby",
    when: "Domingo 05h00 e 05h20",
    what: "Todo conjunto em standby volta pra R$15 e fica protegido de pausa por 48h.",
    whatsapp: false,
  },
  // ---------- Retratos e sincronização ----------
  {
    id: "metrics-sync",
    group: "Retratos e sincronização",
    name: "Backup das métricas",
    when: "03h00 e 03h25",
    what: "Guarda as métricas dos dias fechados no Supabase (deixa as telas e automações mais rápidas).",
    whatsapp: false,
  },
  {
    id: "funds-balance",
    group: "Retratos e sincronização",
    name: "Saldo das contas (fundos)",
    when: "03h40, 06h40, 12h40, 17h40, 20h40 e 23h40",
    what: "Atualiza o saldo das contas pré-pagas.",
    whatsapp: false,
  },
  {
    id: "offers",
    group: "Retratos e sincronização",
    name: "Ofertas ativas",
    when: "05h20 e 12h00 (3 tentativas cada)",
    what: "Retrato das ofertas que rodaram no mês em cada conta IVS (conjunto com gasto no mês ou ligado agora).",
    whatsapp: false,
  },
  {
    id: "videos",
    group: "Retratos e sincronização",
    name: "Vídeos de Geral",
    when: "05h40 (4 tentativas até 05h55)",
    what: "Retrato dos vídeos de Geral nos últimos 30 dias: bom pra reativar, parado, pouco testado, caro, repetido.",
    whatsapp: false,
  },
  {
    id: "audience",
    group: "Retratos e sincronização",
    name: "Melhor público",
    when: "06h30 (4 tentativas até 06h45)",
    what: "Retrato do melhor público de cada conta.",
    whatsapp: false,
  },
  {
    id: "asana-descriptions",
    group: "Retratos e sincronização",
    name: "Descrições do Asana",
    when: "Segunda a sexta, das 08h às 18h, a cada 30 min",
    what: "Copia a descrição de cada cliente do Asana pro Traffic (aba Descrição).",
    whatsapp: false,
  },
];
