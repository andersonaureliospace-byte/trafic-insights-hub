import { redirect } from "next/navigation";

// Etapa 340: Alertas virou Cobranças (só o saldo e a configuração de pagamento).
export default function AlertasPage() {
  redirect("/estrategia/configuracoes/cobrancas");
}
