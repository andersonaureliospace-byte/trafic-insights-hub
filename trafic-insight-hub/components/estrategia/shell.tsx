"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SignOutButton } from "@/components/sign-out-button";

// Etapa 238: casca do Hub estratégico — menu lateral (Tráfego / Clientes, itens "em breve", Automações, link pro hub
// operacional pausado), botão de Modo escuro/claro e o filtro de Responsável compartilhado entre as telas.
// Filtro e lista de responsáveis ficam no Supabase (valem em qualquer navegador); o tema fica no navegador.

export interface EstrUi {
  resp: string; // "" = todos
  period: string;
  sort: string;
}

interface Ctx {
  ui: EstrUi;
  setUi: (patch: Partial<EstrUi>) => void;
  gestores: string[];
  saveGestores: (list: string[]) => Promise<void>;
}

const DEFAULT_UI: EstrUi = { resp: "", period: "u3", sort: "cpa" };
const EstrCtx = createContext<Ctx>({ ui: DEFAULT_UI, setUi: () => {}, gestores: [], saveGestores: async () => {} });
export const useEstr = () => useContext(EstrCtx);

const THEME_KEY = "estrategia_theme";

async function putPref(key: string, value: unknown) {
  await fetch("/api/estrategia/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) });
}

function Item({ href, children, icon }: { href: string; children: ReactNode; icon: ReactNode }) {
  const pathname = usePathname();
  const on = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 ${
        on
          ? "bg-blue-600/10 text-blue-700 ring-1 ring-blue-600/30 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-400/30"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
      }`}
    >
      <span aria-hidden className="w-4 text-center">{icon}</span>
      {children}
    </Link>
  );
}

function Soon({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return (
    <span className="flex cursor-default items-center gap-2.5 px-3 py-2 text-sm text-zinc-400 dark:text-zinc-600">
      <span aria-hidden className="w-4 text-center">{icon}</span>
      <span className="flex-1">{children}</span>
      <span className="rounded border border-zinc-200 px-1.5 text-[10px] dark:border-zinc-800">em breve</span>
    </span>
  );
}

export function EstrategiaShell({ email, children }: { email: string | null; children: ReactNode }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [ui, setUiState] = useState<EstrUi>(DEFAULT_UI);
  const [gestores, setGestores] = useState<string[]>([]);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- tema guardado neste navegador
      if (localStorage.getItem(THEME_KEY) === "light") setTheme("light");
    } catch {
      /* sem armazenamento: fica no escuro */
    }
    void (async () => {
      try {
        const [u, g] = await Promise.all([
          fetch("/api/estrategia/prefs?key=estrategia_ui", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/estrategia/prefs?key=gestores", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (u.value && typeof u.value === "object") setUiState((cur) => ({ ...cur, ...(u.value as Partial<EstrUi>) }));
        if (Array.isArray(g.value)) setGestores((g.value as unknown[]).filter((x): x is string => typeof x === "string"));
      } catch {
        /* segue com o padrão */
      }
    })();
  }, []);

  const setUi = useCallback((patch: Partial<EstrUi>) => {
    setUiState((cur) => {
      const next = { ...cur, ...patch };
      void putPref("estrategia_ui", next).catch(() => {});
      return next;
    });
  }, []);

  const saveGestores = useCallback(async (list: string[]) => {
    const clean = [...new Set(list.map((x) => x.trim()).filter(Boolean))];
    setGestores(clean);
    await putPref("gestores", clean);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* só nesta sessão */
    }
  }

  const value = useMemo(() => ({ ui, setUi, gestores, saveGestores }), [ui, setUi, gestores, saveGestores]);

  return (
    <EstrCtx.Provider value={value}>
      <div className={`${theme} flex min-h-screen flex-1 flex-col bg-zinc-50 text-zinc-900 lg:flex-row dark:bg-[#0b0e14] dark:text-zinc-100`}>
        <aside className="flex shrink-0 flex-col gap-1 border-b border-zinc-200 bg-white px-3 py-3 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:border-r lg:border-b-0 lg:py-5 dark:border-white/10 dark:bg-[#10141c]">
          <div className="px-3 pb-2">
            <div className="text-base font-bold tracking-tight text-blue-700 dark:text-blue-400">Trafic Insight Hub</div>
            <div className="text-xs text-zinc-500">Hub estratégico</div>
          </div>
          <div className="flex flex-wrap gap-1 lg:flex-col">
            <div className="hidden px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase lg:block">Estratégia</div>
            <Item href="/estrategia/trafego" icon="📈">Tráfego</Item>
            <Item href="/estrategia/clientes" icon="👥">Clientes</Item>
          </div>
          <div className="hidden flex-col gap-0.5 border-t border-zinc-200 pt-3 lg:mt-3 lg:flex dark:border-white/10">
            <div className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">Em breve</div>
            <Soon icon="📄">POP</Soon>
            <Soon icon="💬">Grupos</Soon>
            <Soon icon="📅">Agenda</Soon>
            <Soon icon="🗂">Relatórios</Soon>
          </div>
          <div className="flex flex-wrap items-center gap-1 lg:mt-auto lg:flex-col lg:items-stretch">
            <Item href="/estrategia/automacoes" icon="⚙">Automações</Item>
            <Link
              href="/painel"
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"
              title="O hub antigo continua no ar, só saiu do menu"
            >
              <span aria-hidden className="w-4 text-center">↩</span>
              <span className="flex-1">Hub operacional</span>
              <span className="rounded border border-zinc-200 px-1.5 text-[10px] dark:border-zinc-800">pausado</span>
            </Link>
            <button
              onClick={toggleTheme}
              className="mt-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"
            >
              {theme === "dark" ? "☀ Modo claro" : "☾ Modo escuro"}
            </button>
            <div className="hidden items-center justify-between gap-2 px-1 pt-2 text-xs text-zinc-500 lg:flex">
              <span className="truncate" title={email ?? ""}>{email}</span>
              <SignOutButton />
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </EstrCtx.Provider>
  );
}

// Cabeçalho das telas: título, subtítulo e, à direita, o filtro de Responsável + ações da tela.
export function PageHeader({ title, sub, children, noFilter }: { title: string; sub?: string; children?: ReactNode; noFilter?: boolean }) {
  const { ui, setUi, gestores } = useEstr();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-4 lg:px-6 dark:border-white/10">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {sub ? <p className="text-xs text-zinc-500">{sub}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {noFilter ? null : (
          <>
        <label htmlFor="estr-resp" className="text-xs text-zinc-500">Responsável</label>
        <select
          id="estr-resp"
          value={ui.resp}
          onChange={(e) => setUi({ resp: e.target.value })}
          className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
        >
          <option value="">Todos</option>
          {gestores.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
          <option value="__none">Sem responsável</option>
        </select>
          </>
        )}
        {children}
      </div>
    </div>
  );
}
