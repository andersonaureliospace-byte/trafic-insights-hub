"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { WhatsappPanel, useWaOpen } from "@/components/estrategia/whatsapp-panel";

// Etapa 238: casca do Hub estratégico — menu lateral (Tráfego / Clientes, itens "em breve", Automações, link pro hub
// operacional pausado), botão de Modo escuro/claro e o filtro de Responsável compartilhado entre as telas.
// Filtro e lista de responsáveis ficam no Supabase (valem em qualquer navegador); o tema fica no navegador.

export interface EstrUi {
  resp: string; // "" = todos
  period: string;
  sort: string;
}

// Etapa 239: gestor = nome + WhatsApp. A lista antiga (só nomes) é lida e convertida sozinha.
export interface Gestor {
  name: string;
  whatsapp: string;
  tag: string; // Etapa 241: identificação do responsável na nomenclatura (ex.: AND)
}

interface Ctx {
  ui: EstrUi;
  setUi: (patch: Partial<EstrUi>) => void;
  gestores: string[]; // só os nomes (filtro e ficha do cliente)
  gestoresFull: Gestor[];
  saveGestores: (list: Gestor[]) => Promise<void>;
}

export function parseGestores(v: unknown): Gestor[] {
  if (!Array.isArray(v)) return [];
  const out: Gestor[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.trim()) out.push({ name: x.trim(), whatsapp: "", tag: "" });
    else if (x && typeof x === "object" && typeof (x as Gestor).name === "string" && (x as Gestor).name.trim()) {
      out.push({
        name: (x as Gestor).name.trim(),
        whatsapp: String((x as Gestor).whatsapp ?? "").trim(),
        tag: String((x as Gestor).tag ?? "").trim().toUpperCase(),
      });
    }
  }
  return out;
}

const DEFAULT_UI: EstrUi = { resp: "", period: "u3", sort: "cpa" };
const EstrCtx = createContext<Ctx>({ ui: DEFAULT_UI, setUi: () => {}, gestores: [], gestoresFull: [], saveGestores: async () => {} });
export const useEstr = () => useContext(EstrCtx);

const THEME_KEY = "estrategia_theme";

async function putPref(key: string, value: unknown) {
  await fetch("/api/estrategia/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) });
}

function Item({ href, children, small }: { href: string; children: ReactNode; small?: boolean }) {
  const pathname = usePathname();
  const on = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`rounded-md whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-blue-500 ${
        small ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-sm font-medium"
      } ${
        on
          ? "bg-blue-600/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </Link>
  );
}

export function EstrategiaShell({ email, children }: { email: string | null; children: ReactNode }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [ui, setUiState] = useState<EstrUi>(DEFAULT_UI);
  const [gestoresFull, setGestores] = useState<Gestor[]>([]);
  // Etapa 244: espelho do WhatsApp (esquerda, 1/3).
  const [waOpen, setWaOpen] = useWaOpen();
  const [waUnread, setWaUnread] = useState(0);

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
        setGestores(parseGestores(g.value));
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

  const saveGestores = useCallback(async (list: Gestor[]) => {
    const seen = new Set<string>();
    const clean = list
      .map((g) => ({ name: g.name.trim(), whatsapp: g.whatsapp.trim(), tag: (g.tag ?? "").trim().toUpperCase() }))
      .filter((g) => g.name && !seen.has(g.name.toLowerCase()) && seen.add(g.name.toLowerCase()));
    setGestores(clean);
    const res = await fetch("/api/estrategia/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "gestores", value: clean }),
    }).then((r) => r.json());
    if (res.error) throw new Error(res.error);
  }, []);

  const gestores = useMemo(() => gestoresFull.map((g) => g.name), [gestoresFull]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* só nesta sessão */
    }
  }

  const value = useMemo(() => ({ ui, setUi, gestores, gestoresFull, saveGestores }), [ui, setUi, gestores, gestoresFull, saveGestores]);

  return (
    <EstrCtx.Provider value={value}>
      <div className={`${theme} flex min-h-screen flex-1 flex-col bg-zinc-50 text-zinc-900 dark:bg-[#0b0e14] dark:text-zinc-100`}>
        {/* Etapa 243: um menu só, fino, no topo (o menu antigo do hub operacional e a barra lateral saíram). */}
        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur-xl dark:border-white/10 dark:bg-[#0b0e14]/85">
          <div className="flex h-12 items-center gap-2 overflow-x-auto px-3 lg:px-6">
            <span className="mr-2 text-sm font-bold tracking-tight whitespace-nowrap text-blue-700 dark:text-blue-400">Trafic Insight Hub</span>
            <nav className="flex items-center gap-0.5">
              <Item href="/estrategia/trafego">Tráfego</Item>
              <Item href="/estrategia/clientes">Clientes</Item>
              <Item href="/estrategia/pop">POP</Item>
            </nav>
            <span className="mx-1 h-4 w-px shrink-0 bg-zinc-200 dark:bg-white/10" />
            <nav className="flex items-center gap-0.5">
              <Item href="/estrategia/gestores" small>Gestores</Item>
              <Item href="/estrategia/automacoes" small>Automações</Item>
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Link
                href="/painel"
                title="O hub operacional (antigo) continua no ar"
                className="rounded-md px-2 py-1 text-xs whitespace-nowrap text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-white/5 dark:hover:text-zinc-200"
              >
                Hub operacional ↗
              </Link>
              <button
                onClick={toggleTheme}
                title={theme === "dark" ? "Modo claro" : "Modo escuro"}
                aria-label={theme === "dark" ? "Mudar pro modo claro" : "Mudar pro modo escuro"}
                className="h-8 w-8 rounded-md text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"
              >
                {theme === "dark" ? "☀" : "☾"}
              </button>
              <span className="hidden max-w-[12rem] truncate text-xs text-zinc-500 xl:inline" title={email ?? ""}>
                {email}
              </span>
              <SignOutButton />
            </div>
          </div>
        </header>
        {/* Etapa 244: WhatsApp à esquerda (1/3) e o quadro à direita (2/3). No celular/tablet em pé o WhatsApp abre por cima. */}
        <div className="flex min-h-0 flex-1">
          {waOpen ? (
            <aside className="fixed inset-y-0 left-0 z-40 w-[min(92vw,26rem)] border-r border-zinc-200 shadow-2xl lg:sticky lg:top-12 lg:z-10 lg:h-[calc(100vh-3rem)] lg:w-1/3 lg:shadow-none dark:border-white/10">
              <WhatsappPanel onClose={() => setWaOpen(false)} onUnread={setWaUnread} />
            </aside>
          ) : (
            <button
              onClick={() => setWaOpen(true)}
              title="Abrir o WhatsApp"
              className="fixed bottom-4 left-4 z-40 flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-lg lg:sticky lg:top-12 lg:bottom-auto lg:left-auto lg:h-[calc(100vh-3rem)] lg:flex-col lg:justify-start lg:rounded-none lg:px-1.5 lg:py-3 lg:shadow-none"
            >
              <span>💬</span>
              <span className="lg:[writing-mode:vertical-rl]">WhatsApp</span>
              {waUnread ? <span className="rounded-full bg-white px-1.5 text-[11px] font-bold text-emerald-700">{waUnread}</span> : null}
            </button>
          )}
          {waOpen ? <button aria-label="Fechar o WhatsApp" onClick={() => setWaOpen(false)} className="fixed inset-0 z-30 bg-black/40 lg:hidden" /> : null}
          <main className="min-w-0 flex-1">{children}</main>
        </div>
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
