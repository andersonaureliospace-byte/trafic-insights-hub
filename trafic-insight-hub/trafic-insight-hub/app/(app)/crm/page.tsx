import { PlaceholderPage } from "@/components/placeholder-page";

export default function CrmPage() {
  return (
    <PlaceholderPage
      title="CRM"
      description="Funil de leads por instância, com kanban e link público por token (/c/:token) pro cliente acompanhar sem login."
      items={["Lista de instâncias", "Kanban por instância", "Detalhe do lead", "Ingestão de leads via n8n"]}
    />
  );
}
