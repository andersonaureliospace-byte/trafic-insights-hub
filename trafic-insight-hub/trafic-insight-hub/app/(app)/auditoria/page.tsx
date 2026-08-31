import { PlaceholderPage } from "@/components/placeholder-page";

export default function AuditoriaPage() {
  return (
    <PlaceholderPage
      title="Auditoria"
      description="Checagens automáticas das contas de anúncio, alimentadas pelo n8n em horário fixo."
      items={["Localização dos conjuntos (Brasil sem restrição / expansão ligada)", "Erros de veiculação"]}
    />
  );
}
