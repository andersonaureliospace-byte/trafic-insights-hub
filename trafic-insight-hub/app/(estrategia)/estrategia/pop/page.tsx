import Link from "next/link";

// Etapa 240: Procedimentos Operacionais Padrão (POP) — lista. Cada POP é uma página própria.
const POPS = [
  {
    href: "/estrategia/pop/nomenclatura",
    n: "01",
    title: "Nomenclatura",
    desc: "Como nomear campanhas, conjuntos e anúncios. É o padrão que o alerta de nomenclatura confere.",
    tag: "Ativo",
  },
];

export default function PopIndex() {
  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-200 px-4 py-4 lg:px-6 dark:border-white/10">
        <h1 className="text-lg font-semibold tracking-tight">POP</h1>
        <p className="text-xs text-zinc-500">Procedimentos Operacionais Padrão: como a equipe faz cada tarefa, do mesmo jeito.</p>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:p-6 xl:grid-cols-3">
        {POPS.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="group flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:border-blue-500 dark:border-white/10 dark:bg-[#121722] dark:hover:border-blue-400"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-zinc-500">POP {p.n}</span>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 uppercase dark:text-emerald-300">{p.tag}</span>
            </div>
            <div className="text-base font-semibold group-hover:text-blue-700 dark:group-hover:text-blue-300">{p.title}</div>
            <p className="text-sm text-zinc-500">{p.desc}</p>
          </Link>
        ))}
        <div className="flex flex-col justify-center gap-1 rounded-xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-500 dark:border-white/10">
          <span className="font-medium">Próximos POPs</span>
          <span className="text-xs">Entram aqui conforme forem criados.</span>
        </div>
      </div>
    </div>
  );
}
