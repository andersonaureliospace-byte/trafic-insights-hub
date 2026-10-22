import { addDaysYmd, resolveRange, todayBrt } from "@/lib/meta/daily-range";

// Etapa 132: períodos do Painel que existem com o MESMO significado no Gerenciador (aparece o nome do período lá);
// os outros (ex.: "Últimos 3 dias + hoje") vão só com as datas.
// Etapa 132c: o nome do período no Gerenciador nem sempre é o mesmo id do Painel ("Ontem e hoje" = `last_2_days` lá).
const ADS_MANAGER_PRESET_NAMES: Record<string, string> = {
  today: "today",
  yesterday: "yesterday",
  // last_3d NÃO entra aqui de propósito: o Gerenciador não conhece esse nome de período e abre "Erro: falha ao carregar componente"
  // (testado em 19/10). "Últimos 3 dias" vai só com as datas.
  last_7d: "last_7d",
  this_month: "this_month",
  today_yesterday: "last_2_days",
};

// Etapa 132b: conta → Business Manager dono. Preenchido pelo Painel quando carrega a lista de contas do Meta (que já
// traz o `business` de cada uma), pra todo link de "abrir no Gerenciador" sair com o business_id sem mudar as telas.
const businessByAccount = new Map<string, string>();
export function registerAccountBusinesses(
  accounts: Array<{ account_id?: string; id?: string; business?: { id: string } | null }>,
): void {
  for (const a of accounts) {
    const raw = a.account_id ?? a.id;
    if (raw && a.business?.id) businessByAccount.set(raw.replace(/^act_/, ""), a.business.id);
  }
}

// Link direto pro Gerenciador de Anúncios de uma conta — usado em todo canto
// que mostra o nome da conta (Acompanhamento, Clientes, Visão Geral), pra
// abrir a conta certa no Facebook com um clique.
// Etapa 132: já abre (1) no MESMO período que o Painel está mostrando (`preset`, os mesmos ids do filtro de período —
// datas em fuso de Brasília) e (2) com o filtro "nome da campanha NÃO contém 'vaga'" aplicado. Sem `preset` (ou um
// período que não dá pra converter) abre em "Ontem". Etapa 194: abre na aba Anúncios, só com anúncios ativos.
export function adsManagerUrl(accountId: string, preset?: string): string {
  const numericId = accountId.replace(/^act_/, "");
  // Etapa 132b: com o Business Manager da conta na URL (igual ao link que o próprio Gerenciador gera) ele não precisa
  // redirecionar pra descobrir o negócio — e é nesse redirecionamento que o filtro "vaga" podia se perder.
  const businessId = businessByAccount.get(numericId);
  const business = businessId ? `&business_id=${encodeURIComponent(businessId)}` : "";
  const today = todayBrt();
  const key = preset && resolveRange(preset, today) ? preset : "yesterday";
  const range = resolveRange(key, today)!;
  const name = ADS_MANAGER_PRESET_NAMES[key];
  const label = name ? `,${name}` : "";
  // Etapa 132c: no `date=` do Gerenciador o dia final é EXCLUSIVO (Ontem = 16 → "16_17"; Ontem e hoje = "16_18"). Sem
  // somar 1 dia, os períodos que acabam hoje abriam sem o dia de hoje.
  const date = encodeURIComponent(`${range.since}_${addDaysYmd(range.until, 1)}${label}`);
  // %1E (separador de registro) e as aspas já vêm codificados como o próprio Gerenciador gera — por isso o filtro é
  // montado na mão, sem passar por URLSearchParams (que codificaria de novo).
  // Etapa 194: abre na aba ANÚNCIOS (não Campanhas) com dois filtros juntos — nome da campanha não contém "vaga" e anúncio
  // ATIVO (`ADGROUP_DELIVERY_STATUS` é o status de veiculação do anúncio, no vocabulário interno da Meta; o separador entre
  // filtros é %1D). Filtrar pelo anúncio já deixa só os conjuntos e campanhas que têm anúncio ativo.
  const filter =
    "SEARCH_BY_CAMPAIGN_GROUP_NAME-STRING_SET%1ENOT_CONTAINS_ANY%1E[%22vaga%22]" +
    "%1DADGROUP_DELIVERY_STATUS-STRING_SET%1EIN%1E[%22active%22]";
  return (
    `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${numericId}${business}` +
    `&date=${date}&comparison_date=&insights_date=${date}&insights_comparison_date=` +
    `&filter_set=${filter}&nav_source=no_referrer`
  );
}

// Etapa 140b: link direto pra UMA campanha, conjunto ou anúncio no Gerenciador (aba "Padrão de nomes" → conferir antes de aceitar).
export function adsManagerEntityUrl(accountId: string, entity: "campaign" | "adset" | "ad", entityId: string): string {
  const numericId = accountId.replace(/^act_/, "");
  const businessId = businessByAccount.get(numericId);
  const business = businessId ? `&business_id=${encodeURIComponent(businessId)}` : "";
  const tab = entity === "campaign" ? "campaigns" : entity === "adset" ? "adsets" : "ads";
  const selected = entity === "campaign" ? "selected_campaign_ids" : entity === "adset" ? "selected_adset_ids" : "selected_ad_ids";
  return `https://adsmanager.facebook.com/adsmanager/manage/${tab}?act=${numericId}${business}&${selected}=${encodeURIComponent(entityId)}&nav_source=no_referrer`;
}

// Link direto pra Cobranças e Pagamentos (billing hub) de uma conta — usado
// só em Controle de Saldo, que é justamente a tela que trata de saldo/
// pagamento. `business_id` vem do campo `business` da conta no Graph API
// (dono/Business Manager); quando a conta não pertence a nenhum Business
// Manager (ou o token não tem esse dado), o parâmetro é omitido e o link
// ainda funciona, só sem vir pré-filtrado pelo negócio.
export function billingHubUrl(accountId: string, businessId?: string | null): string {
  const numericId = accountId.replace(/^act_/, "");
  const params = new URLSearchParams({
    nav_entry_point: "ads_ecosystem_navigation_menu",
    placement: "ads_manager",
    asset_id: numericId,
    payment_account_id: numericId,
  });
  if (businessId) params.set("business_id", businessId);
  return `https://adsmanager.facebook.com/adsmanager/billing_hub/accounts/details?${params.toString()}`;
}
