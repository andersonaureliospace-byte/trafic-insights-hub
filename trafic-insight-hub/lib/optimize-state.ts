// Etapa 226: marcação do cliente com 3 estados — Pendente → Otimizar → Otimizado (um clique avança).
// "Otimizado" vale só pro dia (volta a Pendente à meia-noite). "Otimizar" fica até você mudar.
export type OptState = "pendente" | "otimizar" | "otimizado";
export type OptFilter = "all" | "pending" | "to_optimize" | "optimized";

export const OPT_FILTERS: { id: OptFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Pendente" },
  { id: "to_optimize", label: "Otimizar" },
  { id: "optimized", label: "Otimizado" },
];
export const isOptFilter = (v: unknown): v is OptFilter => OPT_FILTERS.some((f) => f.id === v);

export function optState(optimized: boolean | null | undefined, toOptimize: boolean | null | undefined): OptState {
  return optimized ? "otimizado" : toOptimize ? "otimizar" : "pendente";
}
export const NEXT_STATE: Record<OptState, OptState> = { pendente: "otimizar", otimizar: "otimizado", otimizado: "pendente" };
export const optPatch = (s: OptState) => ({ optimized: s === "otimizado", to_optimize: s === "otimizar" });
export function matchesOptFilter(f: OptFilter, s: OptState): boolean {
  return f === "all" || (f === "pending" ? s === "pendente" : f === "to_optimize" ? s === "otimizar" : s === "otimizado");
}

export const OPT_LABEL: Record<OptState, string> = { pendente: "Pendente", otimizar: "Otimizar", otimizado: "Otimizado" };
export const OPT_DOT: Record<OptState, string> = {
  pendente: "bg-zinc-300 dark:bg-zinc-600",
  otimizar: "bg-amber-500",
  otimizado: "bg-emerald-500",
};
export const OPT_PILL: Record<OptState, string> = {
  pendente: "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300",
  otimizar: "border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300",
  otimizado: "border-emerald-400 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};
export const OPT_TITLE: Record<OptState, string> = {
  pendente: "Pendente — clique pra marcar como Otimizar",
  otimizar: "Otimizar — clique pra marcar como Otimizado (hoje)",
  otimizado: "Otimizado hoje — clique pra voltar a Pendente",
};
