import type { Metadata } from "next";
import { PopNomenclatura } from "@/components/pop/nomenclatura";

// Etapa 241: POP 01 — Nomenclatura, link público (sem login) pra equipe. Sem menu e sem citar o Hub.
export const metadata: Metadata = {
  title: "POP 01 · Nomenclatura",
  description: "Como nomear campanhas, conjuntos e criativos — com o Monte o nome.",
  robots: { index: false, follow: false },
};

export default function PopPublico() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-[#0b0e14] dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white px-4 py-5 dark:border-white/10 dark:bg-[#10141c]">
        <div className="mx-auto max-w-4xl">
          <div className="font-mono text-xs text-blue-600 dark:text-blue-400">POP 01 · Procedimento Operacional Padrão</div>
          <h1 className="text-xl font-semibold tracking-tight text-balance">Nomenclatura de campanhas, conjuntos e criativos</h1>
          <p className="text-xs text-zinc-500">Vale pra todas as contas IVS · todo gestor segue</p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 py-6">
        <PopNomenclatura />
      </main>
    </div>
  );
}
