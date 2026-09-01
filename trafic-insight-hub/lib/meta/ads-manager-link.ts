// Link direto pro Gerenciador de Anúncios de uma conta — usado em todo canto
// que mostra o nome da conta (Acompanhamento, Controle de Saldo, Visão
// Geral), pra abrir a conta certa no Facebook com um clique.
export function adsManagerUrl(accountId: string): string {
  const numericId = accountId.replace(/^act_/, "");
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${numericId}`;
}
