import { PlaceholderPage } from "@/components/placeholder-page";

export default function MensagensPage() {
  return (
    <PlaceholderPage
      title="Mensagens"
      description="Envio de WhatsApp via uazapi — entra depois do Painel e das Configurações (é lá que a instância uazapi é conectada)."
      items={["Envio", "Relatórios", "Templates", "Avisos", "Disparo agendado (único/recorrente)"]}
    />
  );
}
