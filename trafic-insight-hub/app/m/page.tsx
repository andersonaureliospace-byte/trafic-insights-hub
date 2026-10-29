import { PushSetup } from "@/components/mobile/push-setup";
import { AlertasTab } from "@/components/painel/alertas-tab";

// Etapa 221: app no celular — tela inicial = Alertas (+ ligar notificações).
export default function MobileAlertasPage() {
  return (
    <>
      <PushSetup />
      <AlertasTab />
    </>
  );
}
