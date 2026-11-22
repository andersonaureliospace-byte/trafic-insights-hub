import { redirect } from "next/navigation";

// Etapa 340: a aba Feedbacks dentro de Clientes saiu — os feedbacks agora ficam na aba Feedback (menu de cima).
export default function FeedbacksPage() {
  redirect("/estrategia/feedback");
}
