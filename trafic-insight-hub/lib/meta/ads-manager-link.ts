import { resolveRange, todayBrt } from "@/lib/meta/daily-range";

// Etapa 132: períodos do Painel que existem com o MESMO significado no Gerenciador (aparece o nome do período lá);
// os outros (ex.: "Últimos 3 dias + hoje") vão só com as datas.
const ADS_MANAGER_PRESET_NAMES = new Set(["today", "yesterday", "last_3d", "last_7d", "this_month"]);

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
// período que não dá pra converter) abre em "Ontem".
export function adsManagerUrl(accountId: string, preset?: string): string {
  const numericId = accountId.replace(/^act_/, "");
  // Etapa 132b: com o Business Manager da conta na URL (igual ao link que o próprio Gerenciador gera) ele não precisa
  // redirecionar pra descobrir o negócio — e é nesse redirecionamento que o filtro "vaga" podia se perder.
  const businessId = businessByAccount.get(numericId);
  const business = businessId ? `&business_id=${encodeURIComponent(businessId)}` : "";
  const today = todayBrt();
  const key = preset && resolveRange(preset, today) ? preset : "yesterday";
  const range = resolveRange(key, today)!;
  const label = ADS_MANAGER_PRESET_NAMES.has(key) ? `,${key}` : "";
  const date = encodeURIComponent(`${range.since}_${range.until}${label}`);
  // %1E (separador de registro) e as aspas já vêm codificados como o próprio Gerenciador gera — por isso o filtro é
  // montado na mão, sem passar por URLSearchParams (que codificaria de novo).
  const filter = "SEARCH_BY_CAMPAIGN_GROUP_NAME-STRING_SET%1ENOT_CONTAINS_ANY%1E[%22vaga%22]";
  return (
    `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${numericId}${business}` +
    `&date=${date}&comparison_date=&insights_date=${date}&insights_comparison_date=` +
    `&filter_set=${filter}&nav_source=no_referrer`
  );
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
