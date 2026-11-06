"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Etapa 270: em qualquer tela do Hub, mostra o disparo que está rodando no servidor ("Disparo 3 de 30") e, de tempos em
// tempos, pede pro servidor reacender se a corrente dele tiver parado. O disparo não depende desta tela pra rodar.

interface Ativo {
  id: string;
  status: string;
  total: number;
  ok: number;
  erro: number;
}

export function DisparoMonitor() {
  const pathname = usePathname();
  const [ativos, setAtivos] = useState<Ativo[]>([]);

  useEffect(() => {
    let parado = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ciclo = async () => {
      let vivo = false;
      try {
        const d = await fetch("/api/estrategia/disparos?disparos=1&itens=0", { cache: "no-store" }).then((r) => r.json());
        const list = ((d.disparos ?? []) as Ativo[]).filter((x) => x.status === "rodando" || x.status === "pausado");
        if (!parado) setAtivos(list);
        vivo = list.length > 0;
        if (list.some((x) => x.status === "rodando")) {
          void fetch("/api/estrategia/disparos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "kick" }),
          }).catch(() => {});
        }
      } catch {
        /* tenta de novo */
      }
      if (!parado) timer = setTimeout(ciclo, vivo ? 20_000 : 120_000);
    };
    void ciclo();
    return () => {
      parado = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (ativos.length === 0 || pathname.startsWith("/estrategia/disparos")) return null;
  const a = ativos[0];
  const feito = a.ok + a.erro;
  return (
    <Link
      href="/estrategia/disparos"
      className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs font-medium shadow-lg hover:bg-zinc-50 dark:border-white/10 dark:bg-[#121722] dark:hover:bg-white/5"
    >
      <span className={`h-2 w-2 rounded-full ${a.status === "rodando" ? "animate-pulse bg-emerald-500" : "bg-amber-500"}`} />
      {a.status === "rodando" ? "Disparando" : "Disparo pausado"} · {feito} de {a.total}
      {a.erro ? <span className="text-red-600"> · {a.erro} erro{a.erro === 1 ? "" : "s"}</span> : null}
      {ativos.length > 1 ? <span className="text-zinc-500"> · +{ativos.length - 1}</span> : null}
    </Link>
  );
}
