"use client";

import { Suspense, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PushSetup } from "@/components/mobile/push-setup";
import { MobileClientes } from "@/components/mobile/mobile-clientes";
import { MobileConjuntos } from "@/components/mobile/mobile-conjuntos";
import { AlertasTab } from "@/components/painel/alertas-tab";

// Etapa 222: as 3 abas do app ficam montadas o tempo todo (cada uma carrega só na 1ª vez que é aberta). Trocar de aba
// só mostra/esconde — nada é buscado de novo. Pra atualizar, use os botões de atualizar de cada tela.
type Tab = "alertas" | "clientes" | "conjuntos";
const tabOf = (path: string): Tab =>
  path.startsWith("/m/clientes") ? "clientes" : path.startsWith("/m/conjuntos") ? "conjuntos" : "alertas";

function Inner() {
  const tab = tabOf(usePathname());
  const conta = useSearchParams().get("conta") ?? undefined;
  // Abas já abertas (ajustado durante a renderização, sem efeito).
  const [opened, setOpened] = useState<Record<Tab, boolean>>({ alertas: false, clientes: false, conjuntos: false });
  if (!opened[tab]) setOpened({ ...opened, [tab]: true });

  return (
    <>
      <div hidden={tab !== "alertas"}>
        {opened.alertas && (
          <>
            <PushSetup />
            <AlertasTab />
          </>
        )}
      </div>
      <div hidden={tab !== "clientes"}>{opened.clientes && <MobileClientes />}</div>
      <div hidden={tab !== "conjuntos"}>{opened.conjuntos && <MobileConjuntos conta={conta} />}</div>
    </>
  );
}

export function MobileShell() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Carregando…</p>}>
      <Inner />
    </Suspense>
  );
}
