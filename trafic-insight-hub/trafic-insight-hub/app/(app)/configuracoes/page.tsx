import { PlaceholderPage } from "@/components/placeholder-page";

export default function ConfiguracoesPage() {
  return (
    <PlaceholderPage
      title="Configurações"
      description="Sem a aba Conta (trocar senha/e-mail foi removida) — só o que liga o painel às contas de anúncio e ao WhatsApp."
      items={["Meta (Facebook) — access token e conta padrão", "WhatsApp — conectar instância uazapi, QR code, grupo de alertas", "Status — personalizar rótulos de prioridade"]}
    />
  );
}
