import { redirect } from "next/navigation";

// As Conexões (Meta, WhatsApp, Prioridade) agora ficam dentro do Hub estratégico: Configurações → Conexões.
export default function ConfiguracoesPage() {
  redirect("/estrategia/configuracoes/conexoes");
}
