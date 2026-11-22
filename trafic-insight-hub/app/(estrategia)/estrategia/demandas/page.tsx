import { redirect } from "next/navigation";

// Etapa 340: Demandas (calendário) virou a aba Feedback.
export default function DemandasPage() {
  redirect("/estrategia/feedback");
}
