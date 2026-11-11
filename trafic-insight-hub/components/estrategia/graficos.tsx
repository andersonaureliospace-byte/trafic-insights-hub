"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/estrategia/ui";
import { calendarSP } from "@/lib/estrategia/calc";
import type { Linha } from "@/components/estrategia/use-carteira";
import type { DailyCpaPoint } from "@/lib/meta/daily-cpa";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";

// Etapa 303: Acompanhamento → Gráficos. Uma faixa por conta com 3 gráficos dos últimos 3 dias fechados + hoje:
// resultado por dia (área), custo por resultado (barras + linha do CPA ideal) e valor investido (barras deitadas + meta/dia).

const W = 360;
const L = 44;
const R = 344;
const T = 26;
const B = 168;
const SLOT = (R - L) / 4;
const X = (i: number) => L + SLOT * (i + 0.5);

const brl = (v: number, d = 0) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const curto = (v: number) => (v >= 1000 ? `R$${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : `R$${Math.round(v)}`);

// Teto do eixo = 4 passos "redondos" (1, 2, 5, 10, 20, 50…), pra os rótulos saírem inteiros.
function nice(m: number): number {
  if (!(m > 0)) return 4;
  const raw = m / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
  return step * 4;
}

function rotulo(ymd: string, hoje: string): string {
  if (ymd === hoje) return "Hoje";
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

function suave(pts: { x: number; y: number }[]): string {
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(1)} ${p2.x} ${p2.y}`;
  }
  return d;
}

function Grade({ max, fmt }: { max: number; fmt: (v: number) => string }) {
  return (
    <>
      {[0, 1, 2, 3, 4].map((k) => {
        const y = B - (k / 4) * (B - T);
        return (
          <g key={k}>
            <line x1={L} x2={R} y1={y} y2={y} className="stroke-zinc-200 dark:stroke-white/[0.06]" />
            <text x={L - 8} y={y + 4} textAnchor="end" fontSize={11} className="fill-zinc-500 dark:fill-zinc-400">
              {fmt((max * k) / 4)}
            </text>
          </g>
        );
      })}
    </>
  );
}

function Quadro({ titulo, children, label }: { titulo: string; label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-2.5 pt-3 pb-1.5 dark:border-white/[0.08]">
      <div className="pl-1 text-[13px] font-semibold">{titulo}</div>
      <svg viewBox={`0 0 ${W} 200`} role="img" aria-label={label} className="block h-auto w-full">
        {children}
      </svg>
    </div>
  );
}

function GraficoResultado({ dias, hoje, nome }: { dias: DailyCpaPoint[]; hoje: string; nome: string }) {
  const id = useId().replace(/:/g, "");
  const max = nice(Math.max(1, ...dias.map((d) => d.results)) * 1.15);
  const pts = dias.map((d, i) => ({ x: X(i), y: +(B - (d.results / max) * (B - T)).toFixed(1) }));
  const linha = suave(pts);
  return (
    <Quadro titulo="Resultado por dia" label={`Resultados por dia de ${nome}`}>
      <defs>
        <linearGradient id={`ga${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#818cf8" stopOpacity="0.8" />
          <stop offset="1" stopColor="#818cf8" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <Grade max={max} fmt={(v) => String(Math.round(v))} />
      <path d={`${linha} L${pts[3].x} ${B} L${pts[0].x} ${B} Z`} fill={`url(#ga${id})`} />
      <path d={linha} fill="none" stroke="#818cf8" strokeWidth={2} />
      {dias.map((d, i) => (
        <g key={d.date}>
          <circle cx={pts[i].x} cy={pts[i].y} r={3.5} strokeWidth={2} stroke="#818cf8" className="fill-white dark:fill-[#121722]" />
          <text x={pts[i].x} y={pts[i].y - 10} textAnchor="middle" fontSize={12} fontWeight={700} className="fill-zinc-800 dark:fill-zinc-100">
            {d.results}
          </text>
          <text x={pts[i].x} y={188} textAnchor="middle" fontSize={11} className="fill-zinc-500 dark:fill-zinc-400">
            {rotulo(d.date, hoje)}
          </text>
        </g>
      ))}
    </Quadro>
  );
}

function GraficoCpa({ dias, hoje, nome, ideal }: { dias: DailyCpaPoint[]; hoje: string; nome: string; ideal: number | null }) {
  const id = useId().replace(/:/g, "");
  const cpas = dias.map((d) => (d.spend > 0 && d.results > 0 ? d.spend / d.results : null));
  const max = nice(Math.max(ideal ?? 0, 1, ...cpas.map((c) => c ?? 0)) * 1.15);
  const Y = (v: number) => B - (v / max) * (B - T);
  return (
    <Quadro titulo="Custo por resultado por dia" label={`Custo por resultado por dia de ${nome}`}>
      <defs>
        <linearGradient id={`gb${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="1" stopColor="#a5b4fc" stopOpacity="0.75" />
        </linearGradient>
        <linearGradient id={`gh${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f97316" />
          <stop offset="1" stopColor="#fdba74" stopOpacity="0.75" />
        </linearGradient>
      </defs>
      <Grade max={max} fmt={(v) => `R$ ${Math.round(v)}`} />
      {dias.map((d, i) => {
        const c = cpas[i];
        const semLead = d.spend > 0 && d.results === 0;
        const alto = c != null && ideal != null && c > ideal;
        const y = c != null ? Y(c) : B;
        return (
          <g key={d.date}>
            {c != null ? <rect x={X(i) - 18} y={y} width={36} height={B - y} rx={3} fill={`url(#${alto ? "gh" : "gb"}${id})`} /> : null}
            <text
              x={X(i)}
              y={c != null ? y - 6 : B - 6}
              textAnchor="middle"
              fontSize={c != null ? 12 : 10}
              fontWeight={700}
              className={alto || semLead ? "fill-orange-600 dark:fill-orange-300" : "fill-zinc-800 dark:fill-zinc-100"}
            >
              {c != null ? curto(c) : semLead ? "sem lead" : "—"}
            </text>
            <text x={X(i)} y={188} textAnchor="middle" fontSize={11} className="fill-zinc-500 dark:fill-zinc-400">
              {rotulo(d.date, hoje)}
            </text>
          </g>
        );
      })}
      {ideal != null && ideal > 0 ? (
        <>
          <line x1={L} x2={R} y1={Y(ideal)} y2={Y(ideal)} stroke="#ec4899" strokeWidth={1.5} strokeDasharray="5 4" />
          <text x={R} y={Y(ideal) - 5} textAnchor="end" fontSize={10} className="fill-pink-600 dark:fill-pink-300">
            CPA ideal
          </text>
        </>
      ) : null}
    </Quadro>
  );
}

function GraficoInvestido({ dias, hoje, nome, metaDia }: { dias: DailyCpaPoint[]; hoje: string; nome: string; metaDia: number | null }) {
  const id = useId().replace(/:/g, "");
  const max = Math.max(metaDia ?? 0, 1, ...dias.map((d) => d.spend)) * 1.05;
  const TRILHO = 236;
  return (
    <Quadro titulo="Valor investido por dia" label={`Valor investido por dia de ${nome}`}>
      <defs>
        <linearGradient id={`gi${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0ea5e9" stopOpacity="0.7" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      {dias.map((d, i) => {
        const w = d.spend > 0 ? Math.max(22, (d.spend / max) * TRILHO) : 0;
        const y = 22 + i * 40;
        const ehHoje = d.date === hoje;
        const pct = metaDia ? d.spend / metaDia : null;
        return (
          <g key={d.date}>
            <text x={48} y={y + 15} textAnchor="end" fontSize={11} className="fill-zinc-500 dark:fill-zinc-400">
              {rotulo(d.date, hoje)}
            </text>
            <rect x={56} y={y} width={TRILHO} height={22} rx={11} className="fill-zinc-100 dark:fill-white/[0.05]" />
            {w > 0 ? <rect x={56} y={y} width={w} height={22} rx={11} fill={`url(#gi${id})`} fillOpacity={ehHoje ? 0.55 : 1} /> : null}
            {w > TRILHO - 70 ? (
              <text x={56 + w - 10} y={y + 15} textAnchor="end" fontSize={12} fontWeight={700} fill="#ffffff">
                {curto(d.spend)}
              </text>
            ) : (
              <text x={56 + w + 6} y={y + 15} fontSize={12} fontWeight={700} className="fill-zinc-800 dark:fill-zinc-100">
                {curto(d.spend)}
              </text>
            )}
            {pct != null ? (
              <text
                x={352}
                y={y + 15}
                textAnchor="end"
                fontSize={11}
                fontWeight={600}
                className={ehHoje ? "fill-zinc-500 dark:fill-zinc-400" : pct < 0.85 ? "fill-orange-600 dark:fill-orange-300" : "fill-emerald-600 dark:fill-emerald-300"}
              >
                {Math.round(pct * 100)}%
              </text>
            ) : null}
          </g>
        );
      })}
      {metaDia ? (
        <>
          <line x1={56 + (metaDia / max) * TRILHO} x2={56 + (metaDia / max) * TRILHO} y1={16} y2={176} stroke="#10b981" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={56 + (metaDia / max) * TRILHO} y={192} textAnchor="middle" fontSize={10} className="fill-emerald-600 dark:fill-emerald-300">
            meta/dia {curto(metaDia)}
          </text>
        </>
      ) : null}
    </Quadro>
  );
}

type Ordem = "cpa" | "gasto" | "resultados" | "nome";

export function Graficos({ linhas }: { linhas: Linha[] }) {
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("cpa");
  const cal = calendarSP();

  const contas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const list = linhas
      .filter((l) => !q || l.name.toLowerCase().includes(q))
      .map((l) => {
        const dias = l.ult4 ?? null;
        const spend = (dias ?? []).reduce((a, d) => a + d.spend, 0);
        const results = (dias ?? []).reduce((a, d) => a + d.results, 0);
        const cpa = spend > 0 ? (results > 0 ? spend / results : Infinity) : null;
        const ideal = l.cpaTarget && l.cpaTarget > 0 ? l.cpaTarget : null;
        return { l, dias, spend, results, cpa, ideal, metaDia: l.monthly && l.monthly > 0 ? l.monthly / cal.daysInMonth : null };
      });
    const score = (c: (typeof list)[number]) => (c.cpa == null ? -1 : c.ideal ? c.cpa / c.ideal : c.cpa / 1000);
    return list.sort((a, b) =>
      ordem === "nome"
        ? a.l.name.localeCompare(b.l.name, "pt-BR")
        : ordem === "gasto"
          ? b.spend - a.spend
          : ordem === "resultados"
            ? b.results - a.results
            : score(b) - score(a),
    );
  }, [linhas, busca, ordem, cal.daysInMonth]);

  const semDados = linhas.length > 0 && linhas.every((l) => !l.ult4);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-zinc-500">Últimos 3 dias + hoje (parcial). Barra de CPA em laranja = acima do CPA ideal.</p>
        <label htmlFor="gr-busca" className="sr-only">Buscar conta</label>
        <input
          id="gr-busca"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar conta"
          className="h-8 w-44 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
        />
        <label htmlFor="gr-ordem" className="text-xs text-zinc-500">Ordenar</label>
        <select
          id="gr-ordem"
          value={ordem}
          onChange={(e) => setOrdem(e.target.value as Ordem)}
          className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
        >
          <option value="cpa">Pior CPA primeiro</option>
          <option value="gasto">Maior investimento</option>
          <option value="resultados">Mais resultados</option>
          <option value="nome">Nome</option>
        </select>
      </div>

      {semDados ? <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">Clique em Atualizar pra carregar os gráficos.</div> : null}

      {contas.map(({ l, dias, spend, results, cpa, ideal, metaDia }) => (
        <Card key={l.id} className="p-4">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {/* Etapa 303: atalho pro Gerenciador de Anúncios da conta */}
            <a
              href={adsManagerUrl(l.id)}
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir no Gerenciador de Anúncios"
              className="group inline-flex items-center gap-1.5 text-base font-bold hover:text-blue-600 hover:underline dark:hover:text-blue-400"
            >
              {l.name}
              <span aria-hidden className="text-sm font-normal text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-blue-400">↗</span>
            </a>
            <a
              href={adsManagerUrl(l.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-600 hover:border-blue-500 hover:text-blue-600 dark:border-white/15 dark:text-zinc-300 dark:hover:text-blue-300"
            >
              Gerenciador
            </a>
            <span className="text-xs text-zinc-500">
              {l.responsible ?? "Sem responsável"}
              {ideal ? ` · CPA ideal ${brl(ideal, 2)}` : " · sem CPA ideal na ficha"}
            </span>
            <span className="ml-auto text-xs text-zinc-500 tabular-nums">
              4 dias: <strong className="text-zinc-800 dark:text-zinc-100">{brl(spend)}</strong> · <strong className="text-zinc-800 dark:text-zinc-100">{results}</strong> resultados · CPA{" "}
              <strong className="text-zinc-800 dark:text-zinc-100">{cpa == null ? "—" : cpa === Infinity ? "sem lead" : brl(cpa, 2)}</strong>
            </span>
          </div>
          {dias ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <GraficoResultado dias={dias} hoje={cal.today} nome={l.name} />
              <GraficoCpa dias={dias} hoje={cal.today} nome={l.name} ideal={ideal} />
              <GraficoInvestido dias={dias} hoje={cal.today} nome={l.name} metaDia={metaDia} />
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-zinc-500">{l.nums === null ? "A Meta não respondeu pra essa conta." : "Sem dados ainda — clique em Atualizar."}</div>
          )}
        </Card>
      ))}
      {contas.length === 0 ? <div className="py-8 text-center text-sm text-zinc-500">Nenhuma conta nesse filtro.</div> : null}
    </div>
  );
}
