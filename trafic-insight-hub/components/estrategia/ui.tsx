"use client";

import type { ReactNode } from "react";
import type { Tone } from "@/lib/estrategia/calc";

// Etapa 238: peças visuais do Hub estratégico (cores de estado separadas do azul de destaque).

export const TONE: Record<Tone, string> = {
  ok: "bg-emerald-500/12 text-emerald-700 ring-emerald-600/25 dark:text-emerald-300 dark:ring-emerald-400/25",
  warn: "bg-amber-500/12 text-amber-700 ring-amber-600/25 dark:text-amber-300 dark:ring-amber-400/25",
  bad: "bg-red-500/12 text-red-700 ring-red-600/25 dark:text-red-300 dark:ring-red-400/25",
  info: "bg-blue-500/12 text-blue-700 ring-blue-600/25 dark:text-blue-300 dark:ring-blue-400/25",
  off: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-400",
};

export function Pill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums ring-1 ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export type Sev = "critico" | "alta" | "media" | "baixa" | "info" | "ok";
export const SEV_LABEL: Record<Sev, string> = { critico: "Crítico", alta: "Alta", media: "Média", baixa: "Baixa", info: "Info", ok: "OK" };
export const SEV_RANK: Record<Sev, number> = { critico: 4, alta: 3, media: 2, baixa: 1, info: 0, ok: -1 };
// "info" e "ok" aparecem na lista, mas não contam como alerta.
export const isAlertSev = (s: Sev) => s !== "info" && s !== "ok";
const SEV_CLASS: Record<Sev, string> = {
  critico: "bg-red-600 text-white",
  alta: "bg-orange-500 text-white",
  media: "bg-amber-400 text-zinc-900",
  baixa: "bg-zinc-400 text-zinc-900 dark:bg-zinc-600 dark:text-zinc-100",
  info: "bg-blue-600/15 text-blue-700 dark:text-blue-300",
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};
export function SevBadge({ sev }: { sev: Sev }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${SEV_CLASS[sev]}`}>{SEV_LABEL[sev]}</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-[#121722] ${className}`}>{children}</div>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  primary,
  small,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  small?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${small ? "h-7 px-2 text-xs" : "h-9 px-3 text-sm"} inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50 ${
        primary
          ? "bg-blue-600 text-white hover:bg-blue-700"
          : "border border-zinc-300 bg-white hover:bg-zinc-100 dark:border-white/10 dark:bg-[#141924] dark:hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

export const fmtBRL = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
export const fmtInt = (v: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Math.round(v));

export function fmtCpa(cpa: number | null): string {
  if (cpa == null) return "sem gasto";
  if (cpa === Infinity) return "sem conversa";
  return fmtBRL(cpa);
}

export function hhmm(ms: number): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

export function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `há ${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
}
