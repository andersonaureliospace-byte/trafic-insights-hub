import { PlaceholderPage } from "@/components/placeholder-page";

export default function PainelPage() {
  return (
    <PlaceholderPage
      title="Painel"
      description="Próxima etapa da reconstrução. Vai mostrar só as contas marcadas em 'Contas exibidas' — nunca todas as contas do token do Meta."
      items={[
        "Seletor de contas exibidas (user_selected_accounts)",
        "KPI cards + evolução do CPA",
        "Acompanhamento de Resultados (grupos de foco, status em massa)",
        "Controle de Saldo / PIX",
        "Visão Geral por Campanhas / Conjuntos / Anúncios, com pausar/ativar",
      ]}
    />
  );
}
