"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PopNomenclatura } from "@/components/pop/nomenclatura";

// Etapa 240/241: POP 01 — Nomenclatura, dentro do Hub. O conteúdo é o mesmo do link público (/pop/nomenclatura).
function PublicLink() {
  const [url, setUrl] = useState("/pop/nomenclatura");
  const [ok, setOk] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- endereço completo só existe no navegador
    setUrl(`${window.location.origin}/pop/nomenclatura`);
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-600/5 p-3 dark:bg-blue-500/10">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold">Link público (sem login) pra mandar pros gestores</div>
        <code className="block font-mono text-xs break-all text-blue-700 dark:text-blue-300">{url}</code>
      </div>
      <a href="/pop/nomenclatura" target="_blank" rel="noopener noreferrer" className="h-8 rounded-lg border border-zinc-300 px-3 text-xs leading-8 font-medium dark:border-white/10">
        Abrir
      </a>
      <button
        onClick={() => {
          void navigator.clipboard
            .writeText(url)
            .then(() => {
              setOk(true);
              setTimeout(() => setOk(false), 1500);
            })
            .catch(() => {});
        }}
        className="h-8 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700"
      >
        {ok ? "Copiado" : "Copiar link"}
      </button>
    </div>
  );
}

export default function PopNomenclaturaPage() {
  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-200 px-4 py-4 lg:px-6 dark:border-white/10">
        <div className="text-xs text-zinc-500">
          <Link href="/estrategia/pop" className="hover:underline">POP</Link> / 01
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Nomenclatura de campanhas, conjuntos e criativos</h1>
        <p className="text-xs text-zinc-500">Vale pra todas as contas IVS · todo gestor segue</p>
      </div>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 lg:p-6">
        <PublicLink />
        <PopNomenclatura />
      </div>
    </div>
  );
}
