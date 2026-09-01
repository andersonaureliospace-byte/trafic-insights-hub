// Link direto pro Gerenciador de Anúncios de uma conta — usado em todo canto
// que mostra o nome da conta (Acompanhamento, Clientes, Visão Geral), pra
// abrir a conta certa no Facebook com um clique.
export function adsManagerUrl(accountId: string): string {
  const numericId = accountId.replace(/^act_/, "");
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${numericId}`;
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
