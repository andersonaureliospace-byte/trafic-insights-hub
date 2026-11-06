"use client";

import { useEffect, useMemo, useState } from "react";
import { PAYMENT_TYPES } from "@/lib/format";
import { Btn } from "./ui";
import type { Linha } from "./use-carteira";

// Etapa 273: configurações do Saldo das contas, direto no Hub estratégico (antes ficava no Controle de Saldo do hub
// operacional, que está em standby). Mesma tabela pix_accounts — o alerta de saldo das Auditorias usa esses valores.
//   Tipo de conta · Saldo adicionado (valor que o cliente costuma colocar) · Limite (avisa abaixo disso; em branco = 20% do
//   saldo adicionado) · Sexta (avisa na sexta se o saldo não aguentar o fim de semana: X vezes o limite) · Saldo por fundos
//   (contas em que o saldo da Meta não bate: você informa o saldo real e o Hub vai somando/subtraindo) · Observação.

interface PixRow {
  ad_account_id: string;
  payment_type: string | null;
  base_amount: number | null;
  alert_threshold: number | null;
  friday_multiplier: number | null;
  notes: string | null;
  funds_balance_enabled: boolean | null;
  funds_balance_amount: number | null;
  funds_balance_updated_at: string | null;
}

const norm = (id: string) => String(id ?? "").replace(/^act_/, "");
const flat = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const num = (s: string): number | null => {
  const t = s.trim().replace(/[R$\s.]/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const show = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));
const cell = "h-8 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm tabular-nums dark:border-white/10 dark:bg-[#141924]";

export function ConfigSaldo({ linhas, onClose }: { linhas: Linha[]; onClose: (changed: boolean) => void }) {
  const [rows, setRows] = useState<Record<string, PixRow> | null>(null);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState<string>("todos");
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mudou, setMudou] = useState(false);

  useEffect(() => {
    fetch("/api/pix-accounts", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        const m: Record<string, PixRow> = {};
        for (const p of (d.pixAccounts ?? []) as PixRow[]) m[norm(p.ad_account_id)] = p;
        setRows(m);
      })
      .catch((e) => setErro((e as Error).message));
  }, []);

  // grava pelo id que já está na tabela (com ou sem "act_"), senão pelo id da conta como o Hub guarda
  async function patch(l: Linha, campos: Partial<PixRow> & { funds_balance_watermark?: string }) {
    const cur = rows?.[l.id];
    const adId = cur?.ad_account_id ?? l.rawId;
    setSalvando(l.id);
    setErro(null);
    try {
      const d = await fetch("/api/pix-accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_account_id: adId, ...campos }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setRows((m) => ({ ...(m ?? {}), [l.id]: { ...(m?.[l.id] ?? emptyRow(adId)), ...campos } as PixRow }));
      setMudou(true);
    } catch (e) {
      setErro(`${l.name}: ${(e as Error).message}`);
    }
    setSalvando(null);
  }

  const lista = useMemo(() => {
    const t = flat(q).split(/\s+/).filter(Boolean);
    return [...linhas]
      .filter((l) => t.every((x) => flat(`${l.name} ${l.responsible ?? ""} ${l.id}`).includes(x)))
      .filter((l) => {
        if (tipo === "todos") return true;
        const pt = rows?.[l.id]?.payment_type ?? null;
        return tipo === "sem" ? !pt : pt === tipo;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [linhas, q, tipo, rows]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose(mudou);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, mudou]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Configurações de saldo">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#121722]">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-5 py-3 dark:border-white/10">
          <h2 className="mr-auto text-base font-semibold">💳 Configurações de saldo</h2>
          <select aria-label="Tipo de conta" value={tipo} onChange={(e) => setTipo(e.target.value)} className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]">
            <option value="todos">Todos os tipos</option>
            {PAYMENT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
            <option value="sem">Sem tipo definido</option>
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pesquisar conta…"
            aria-label="Pesquisar conta"
            className="h-8 w-56 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
          />
          <button onClick={() => onClose(mudou)} aria-label="Fechar" className="rounded px-2 text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">×</button>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="sticky top-0 bg-white dark:bg-[#121722]">
              <tr className="border-b border-zinc-200 text-left text-[11px] tracking-wide text-zinc-500 uppercase dark:border-white/10">
                <th className="px-4 py-2 font-semibold">Conta</th>
                <th className="px-2 py-2 font-semibold">Tipo de conta</th>
                <th className="px-2 py-2 text-right font-semibold" title="Quanto o cliente costuma adicionar de saldo (Pix/boleto)">Saldo adicionado</th>
                <th className="px-2 py-2 text-right font-semibold" title="Avisa quando o saldo ficar abaixo disso. Em branco = 20% do saldo adicionado">Limite (avisa abaixo)</th>
                <th className="px-2 py-2 font-semibold" title="Na sexta, avisa se o saldo for menor que X vezes o limite (pra aguentar o fim de semana)">Sexta (× limite)</th>
                <th className="px-2 py-2 font-semibold" title="Pra contas em que o saldo da Meta não bate (ex.: híbrida): você informa o saldo real e o Hub soma pagamentos e desconta gastos a partir daí">Saldo por fundos</th>
                <th className="px-2 py-2 pr-4 font-semibold">Observação</th>
              </tr>
            </thead>
            <tbody>
              {rows == null && !erro ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">Carregando…</td>
                </tr>
              ) : null}
              {rows != null && lista.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">Nenhuma conta nesse filtro.</td>
                </tr>
              ) : null}
              {rows != null
                ? lista.map((l) => {
                    const p = rows[l.id];
                    const temSaldo = p?.payment_type === "pix" || p?.payment_type === "hybrid" || p?.payment_type === "boleto";
                    const limitePadrao = p?.base_amount != null ? p.base_amount * 0.2 : null;
                    return (
                      <tr key={l.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-white/5">
                        <td className="px-4 py-2">
                          <div className="font-semibold">{l.name}</div>
                          <div className="text-xs text-zinc-500">
                            {l.responsible ?? "sem responsável"}
                            {salvando === l.id ? " · salvando…" : ""}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <select
                            aria-label={`Tipo de conta de ${l.name}`}
                            value={p?.payment_type ?? ""}
                            onChange={(e) => void patch(l, { payment_type: e.target.value || null })}
                            className={cell}
                          >
                            <option value="">—</option>
                            {PAYMENT_TYPES.map((t) => (
                              <option key={t.id} value={t.id}>{t.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            key={`b-${p?.base_amount ?? ""}`}
                            defaultValue={show(p?.base_amount)}
                            placeholder="R$"
                            inputMode="decimal"
                            aria-label={`Saldo adicionado de ${l.name}`}
                            disabled={!temSaldo}
                            onBlur={(e) => {
                              const v = num(e.target.value);
                              if (v !== (p?.base_amount ?? null)) void patch(l, { base_amount: v });
                            }}
                            className={`${cell} text-right disabled:opacity-40`}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            key={`t-${p?.alert_threshold ?? ""}`}
                            defaultValue={show(p?.alert_threshold)}
                            placeholder={limitePadrao != null ? `${brl(limitePadrao)} (20%)` : "R$"}
                            inputMode="decimal"
                            aria-label={`Limite de ${l.name}`}
                            disabled={!temSaldo}
                            onBlur={(e) => {
                              const v = num(e.target.value);
                              if (v !== (p?.alert_threshold ?? null)) void patch(l, { alert_threshold: v });
                            }}
                            className={`${cell} text-right disabled:opacity-40`}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            key={`f-${p?.friday_multiplier ?? ""}`}
                            defaultValue={show(p?.friday_multiplier)}
                            placeholder="ex.: 2"
                            inputMode="decimal"
                            aria-label={`Multiplicador de sexta de ${l.name}`}
                            disabled={!temSaldo}
                            onBlur={(e) => {
                              const v = num(e.target.value);
                              if (v !== (p?.friday_multiplier ?? null)) void patch(l, { friday_multiplier: v });
                            }}
                            className={`${cell} w-20 disabled:opacity-40`}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                            <input
                              type="checkbox"
                              checked={!!p?.funds_balance_enabled}
                              onChange={(e) => void patch(l, { funds_balance_enabled: e.target.checked })}
                            />
                            Ligado
                          </label>
                          {p?.funds_balance_enabled ? (
                            <div className="mt-1">
                              <input
                                key={`s-${p?.funds_balance_amount ?? ""}`}
                                defaultValue={show(p?.funds_balance_amount)}
                                placeholder="Saldo real hoje (R$)"
                                inputMode="decimal"
                                aria-label={`Saldo real de ${l.name}`}
                                onBlur={(e) => {
                                  const v = num(e.target.value);
                                  if (v !== (p?.funds_balance_amount ?? null))
                                    void patch(l, { funds_balance_amount: v, funds_balance_watermark: new Date().toISOString() });
                                }}
                                className={`${cell} w-36 text-right`}
                              />
                              {p.funds_balance_updated_at ? (
                                <div className="mt-0.5 text-[11px] text-zinc-500">atualizado {new Date(p.funds_balance_updated_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-2 pr-4">
                          <input
                            key={`n-${p?.notes ?? ""}`}
                            defaultValue={p?.notes ?? ""}
                            aria-label={`Observação de ${l.name}`}
                            onBlur={(e) => {
                              const v = e.target.value.trim() || null;
                              if (v !== (p?.notes ?? null)) void patch(l, { notes: v });
                            }}
                            className={cell}
                          />
                        </td>
                      </tr>
                    );
                  })
                : null}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-200 p-3 dark:border-white/10">
          <span className="mr-auto text-xs text-zinc-500">
            {erro ? <span className="text-red-600">{erro}</span> : "Salva sozinho ao sair do campo. Cartão não tem saldo (não entra no alerta)."}
          </span>
          <Btn primary onClick={() => onClose(mudou)}>Pronto</Btn>
        </div>
      </div>
    </div>
  );
}

function emptyRow(adId: string): PixRow {
  return {
    ad_account_id: adId,
    payment_type: null,
    base_amount: null,
    alert_threshold: null,
    friday_multiplier: null,
    notes: null,
    funds_balance_enabled: false,
    funds_balance_amount: null,
    funds_balance_updated_at: null,
  };
}
