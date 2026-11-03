"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OBJECTIVES, normalizeMoney } from "@/lib/naming/rules";

// Etapa 241: POP 01 — Nomenclatura (conteúdo + "Monte o nome"). Usado no Hub (/estrategia/pop/nomenclatura) e no link
// público (/pop/nomenclatura). Segue as mesmas regras que lib/naming/rules.ts confere — se a regra mudar lá, mude aqui.
// Texto sem citar o Hub (pedido do Anderson): "o sistema".

interface Responsavel {
  name: string;
  tag: string;
}

const muted = "text-zinc-500";

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-baseline gap-2 text-base font-semibold">
        <span className="font-mono text-sm text-blue-600 dark:text-blue-400">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Box({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-[#121722] ${className}`}>{children}</div>;
}

function Name({ children, tone = "ok" }: { children: ReactNode; tone?: "ok" | "bad" }) {
  return (
    <code
      className={`block rounded-md px-2.5 py-1.5 font-mono text-[13px] break-all ${
        tone === "ok" ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-red-500/10 text-red-800 line-through decoration-red-500/50 dark:text-red-200"
      }`}
    >
      {children}
    </code>
  );
}

function Pieces({ parts }: { parts: Array<{ label: string; req: "sempre" | "às vezes"; ex: string }> }) {
  return (
    <div className="flex flex-wrap items-stretch gap-1.5">
      {parts.map((p, i) => (
        <div key={p.label} className="flex items-center gap-1.5">
          <div
            className={`flex flex-col rounded-lg border px-2.5 py-1.5 ${
              p.req === "sempre" ? "border-blue-500/40 bg-blue-600/8 dark:bg-blue-500/10" : "border-dashed border-zinc-300 dark:border-white/15"
            }`}
          >
            <span className="text-[10px] font-bold tracking-wide text-zinc-500 uppercase">{p.label}</span>
            <span className="font-mono text-xs font-semibold">{p.ex}</span>
          </div>
          {i < parts.length - 1 ? <span className="font-mono text-zinc-400">|</span> : null}
        </div>
      ))}
    </div>
  );
}

// ---------- Monte o nome ----------

const inputCls = "h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]";
const up = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function todayDM(): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).formatToParts(new Date());
  return `${p.find((x) => x.type === "day")?.value}/${p.find((x) => x.type === "month")?.value}`;
}

// Valor digitado ("15", "15,5", "R$ 15") → "R$ 15,00".
function money(v: string): string {
  const t = v.trim();
  if (!t) return "";
  return normalizeMoney(/^r\$/i.test(t) ? t : /^\d/.test(t) ? `R$ ${t}` : t);
}

function CopyLine({ value, missing }: { value: string; missing: string[] }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-md bg-zinc-900 px-3 py-2 font-mono text-sm break-all text-emerald-300 dark:bg-black/40">{value || "…"}</code>
        <button
          disabled={!value || missing.length > 0}
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => {
                setOk(true);
                setTimeout(() => setOk(false), 1500);
              })
              .catch(() => {});
          }}
          className="h-9 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {ok ? "Copiado" : "Copiar"}
        </button>
      </div>
      {missing.length > 0 ? <p className="text-xs text-amber-600 dark:text-amber-400">Falta preencher: {missing.join(", ")}</p> : null}
    </div>
  );
}

// Lista de unidades com pesquisa.
function UnitPicker({ units, value, onChange }: { units: string[]; value: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const list = useMemo(() => {
    const s = strip(q.trim());
    return (s ? units.filter((u) => strip(u).includes(s)) : units).slice(0, 60);
  }, [q, units]);
  return (
    <div ref={box} className="relative">
      <input
        id="b-cunid"
        role="combobox"
        aria-expanded={open}
        aria-controls="b-cunid-list"
        autoComplete="off"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        placeholder={units.length ? "Pesquise a unidade" : "IVS ITU"}
        className={inputCls}
      />
      {open && list.length > 0 ? (
        <ul
          id="b-cunid-list"
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-white/10 dark:bg-[#141924]"
        >
          {list.map((u) => (
            <li key={u}>
              <button
                role="option"
                aria-selected={u === value}
                onClick={() => {
                  setQ(u);
                  onChange(u);
                  setOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-blue-600/10"
              >
                {u}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Builder({ units, responsaveis }: { units: string[]; responsaveis: Responsavel[] }) {
  const [kind, setKind] = useState<"conjunto" | "campanha" | "criativo">("conjunto");
  // campanha
  const [cTipo, setCTipo] = useState("GERAL");
  const [cObj, setCObj] = useState<string>("ENGAJAMENTO");
  const [cUnid, setCUnid] = useState("");
  const [vaga, setVaga] = useState(false);
  const [vagaTxt, setVagaTxt] = useState("");
  // conjunto
  const [tipo, setTipo] = useState("GERAL");
  const [boleto, setBoleto] = useState(false);
  const [oferta, setOferta] = useState("");
  const [vdo, setVdo] = useState(false);
  const [locMode, setLocMode] = useState<"km" | "cidade" | "varias">("cidade");
  const [km, setKm] = useState("8");
  const [cidade, setCidade] = useState("");
  const [idMin, setIdMin] = useState("25");
  const [idMax, setIdMax] = useState("65");
  const [gen, setGen] = useState("");
  const [plat, setPlat] = useState("");
  const [inter, setInter] = useState(false);
  const [resp, setResp] = useState("");
  const [data, setData] = useState(todayDM());
  // criativo de exame
  const [xValor, setXValor] = useState("");
  const [xData, setXData] = useState(todayDM());
  const [xVar, setXVar] = useState("1");

  const campanha = vaga ? (vagaTxt.trim() ? `[VAGA] ${up(vagaTxt)}` : "") : [cTipo, cObj, up(cUnid)].filter(Boolean).join(" | ");
  const campMissing = vaga ? (vagaTxt.trim() ? [] : ["descrição da vaga"]) : cUnid.trim() ? [] : ["unidade"];

  const conjunto = useMemo(() => {
    const max = Number(idMax);
    const loc = locMode === "km" ? (km.trim() ? `${km.trim()}KM` : "") : locMode === "cidade" ? up(cidade) : cidade.trim() ? `${up(cidade)}+` : "";
    const offer = tipo === "PROMO" ? money(up(oferta)) : "";
    const first = tipo === "EXAME" ? (oferta.trim() ? `EXAME ${money(up(oferta))}` : "EXAME") : tipo;
    const parts = [
      first,
      tipo === "GERAL" && boleto ? "BOLETO" : "",
      offer,
      vdo ? "VDO PROPRIO" : "",
      loc,
      idMin && idMax ? `${idMin}-${max >= 65 ? "65+" : idMax}` : "",
      gen,
      plat,
      inter ? "INTERESSES" : "",
      up(resp),
      data.trim(),
    ];
    return parts.filter(Boolean).join(" | ");
  }, [tipo, boleto, oferta, vdo, locMode, km, cidade, idMin, idMax, gen, plat, inter, resp, data]);
  const conjMissing = [
    tipo !== "GERAL" && !oferta.trim() ? (tipo === "EXAME" ? "valor do exame" : "oferta") : "",
    locMode === "km" ? (km.trim() ? "" : "raio") : cidade.trim() ? "" : "cidade",
    resp.trim() ? "" : "responsável",
    data.trim() ? "" : "data",
  ].filter(Boolean);

  const criativo = [xValor.trim() ? `EXAME ${money(xValor)}` : "", xData.trim(), xVar.trim() ? `V${xVar.replace(/\D/g, "").padStart(2, "0")}` : ""]
    .filter(Boolean)
    .join(" | ");
  const criMissing = [xValor.trim() ? "" : "valor", xData.trim() ? "" : "data", xVar.trim() ? "" : "variação"].filter(Boolean);

  const label = (t: string, id: string) => (
    <label htmlFor={id} className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
      {t}
    </label>
  );

  return (
    <Box className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-white/5">
        {(
          [
            ["conjunto", "Conjunto"],
            ["campanha", "Campanha"],
            ["criativo", "Criativo de exame"],
          ] as const
        ).map(([k, t]) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${kind === k ? "bg-white shadow-sm dark:bg-[#1b2230]" : muted}`}
          >
            {t}
          </button>
        ))}
      </div>

      {kind === "campanha" ? (
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={vaga} onChange={(e) => setVaga(e.target.checked)} className="h-4 w-4 accent-blue-600" />
            Campanha de vaga de emprego
          </label>
          {vaga ? (
            <div className="flex flex-col gap-1">
              {label("Descrição da vaga", "b-vaga")}
              <input id="b-vaga" value={vagaTxt} onChange={(e) => setVagaTxt(e.target.value)} placeholder="RECEPCIONISTA | IVS ITU" className={inputCls} />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                {label("Tipo", "b-ctipo")}
                <select id="b-ctipo" value={cTipo} onChange={(e) => setCTipo(e.target.value)} className={inputCls}>
                  <option>GERAL</option>
                  <option>EXAME</option>
                  <option>PROMO</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                {label("Objetivo da campanha", "b-cobj")}
                <select id="b-cobj" value={cObj} onChange={(e) => setCObj(e.target.value)} className={inputCls}>
                  {OBJECTIVES.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                {label("Unidade", "b-cunid")}
                <UnitPicker units={units} value={cUnid} onChange={setCUnid} />
              </div>
            </div>
          )}
          <CopyLine value={campanha} missing={campMissing} />
        </div>
      ) : kind === "criativo" ? (
        <div className="flex flex-col gap-3">
          <p className={`text-xs ${muted}`}>Só pra criativo de conjunto de EXAME. Os outros criativos levam só o nome do arquivo.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              {label("Valor do exame", "b-xvalor")}
              <input id="b-xvalor" inputMode="decimal" value={xValor} onChange={(e) => setXValor(e.target.value)} placeholder="15,00" className={inputCls} />
            </div>
            <div className="flex flex-col gap-1">
              {label("Primeiro uso (dia/mês)", "b-xdata")}
              <input id="b-xdata" value={xData} onChange={(e) => setXData(e.target.value)} placeholder="DD/MM" className={inputCls} />
            </div>
            <div className="flex flex-col gap-1">
              {label("Variação", "b-xvar")}
              <input id="b-xvar" inputMode="numeric" value={xVar} onChange={(e) => setXVar(e.target.value.replace(/\D/g, ""))} placeholder="1" className={inputCls} />
            </div>
          </div>
          <CopyLine value={criativo} missing={criMissing} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1">
              {label("Tipo", "b-tipo")}
              <select id="b-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
                <option>GERAL</option>
                <option>EXAME</option>
                <option>PROMO</option>
              </select>
            </div>
            {tipo === "GERAL" ? (
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" checked={boleto} onChange={(e) => setBoleto(e.target.checked)} className="h-4 w-4 accent-blue-600" />
                É boleto
              </label>
            ) : (
              <div className="flex flex-col gap-1">
                {label(tipo === "EXAME" ? "Valor ou oferta do exame" : "Oferta", "b-oferta")}
                <input
                  id="b-oferta"
                  value={oferta}
                  onChange={(e) => setOferta(e.target.value)}
                  placeholder={tipo === "EXAME" ? "R$ 15,00" : "ARMAÇÃO R$ 1,00"}
                  className={inputCls}
                />
              </div>
            )}
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={vdo} onChange={(e) => setVdo(e.target.checked)} className="h-4 w-4 accent-blue-600" />
              Vídeo gravado pelo cliente
            </label>
            <div className="flex flex-col gap-1">
              {label("Responsável", "b-resp")}
              {responsaveis.length > 0 ? (
                <select id="b-resp" value={resp} onChange={(e) => setResp(e.target.value)} className={inputCls}>
                  <option value="">Escolha</option>
                  {responsaveis.map((r) => (
                    <option key={r.tag + r.name} value={r.tag}>
                      {r.name} ({r.tag})
                    </option>
                  ))}
                </select>
              ) : (
                <input id="b-resp" value={resp} onChange={(e) => setResp(e.target.value.toUpperCase())} placeholder="AND" className={inputCls} />
              )}
            </div>
            <div className="flex flex-col gap-1">
              {label("Localização", "b-locmode")}
              <select id="b-locmode" value={locMode} onChange={(e) => setLocMode(e.target.value as typeof locMode)} className={inputCls}>
                <option value="cidade">Uma cidade</option>
                <option value="varias">Várias cidades</option>
                <option value="km">Raio em km</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              {locMode === "km" ? label("Raio (km)", "b-km") : label(locMode === "cidade" ? "Cidade" : "Primeira cidade", "b-cidade")}
              {locMode === "km" ? (
                <input id="b-km" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ""))} className={inputCls} />
              ) : (
                <input id="b-cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="ITU" className={inputCls} />
              )}
            </div>
            <div className="flex flex-col gap-1">
              {label("Idade", "b-idmin")}
              <div className="flex items-center gap-1.5">
                <input id="b-idmin" aria-label="Idade mínima" inputMode="numeric" value={idMin} onChange={(e) => setIdMin(e.target.value.replace(/\D/g, ""))} className={inputCls} />
                <span className={muted}>a</span>
                <input aria-label="Idade máxima" inputMode="numeric" value={idMax} onChange={(e) => setIdMax(e.target.value.replace(/\D/g, ""))} className={inputCls} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {label("Início da veiculação", "b-data")}
              <input id="b-data" value={data} onChange={(e) => setData(e.target.value)} placeholder="DD/MM" className={inputCls} />
            </div>
            <div className="flex flex-col gap-1">
              {label("Gênero", "b-gen")}
              <select id="b-gen" value={gen} onChange={(e) => setGen(e.target.value)} className={inputCls}>
                <option value="">Todos (não escreve)</option>
                <option>MULHER</option>
                <option>HOMEM</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              {label("Plataforma", "b-plat")}
              <select id="b-plat" value={plat} onChange={(e) => setPlat(e.target.value)} className={inputCls}>
                <option value="">As duas (não escreve)</option>
                <option>INSTA</option>
                <option>FACE</option>
              </select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={inter} onChange={(e) => setInter(e.target.checked)} className="h-4 w-4 accent-blue-600" />
              Tem interesses
            </label>
          </div>
          <CopyLine value={conjunto} missing={conjMissing} />
        </div>
      )}
    </Box>
  );
}

// ---------- conteúdo ----------

export function PopNomenclatura() {
  const [units, setUnits] = useState<string[]>([]);
  const [responsaveis, setResponsaveis] = useState<Responsavel[]>([]);

  useEffect(() => {
    void fetch("/api/public/pop-data")
      .then((r) => r.json())
      .then((d: { units?: string[]; responsaveis?: Responsavel[] }) => {
        setUnits(d.units ?? []);
        setResponsaveis(d.responsaveis ?? []);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-8 text-sm leading-relaxed">
      <Section n="1" title="Por que existe">
        <p>
          O nome é a etiqueta do anúncio. Com o nome certo, qualquer pessoa bate o olho e sabe o que está rodando, e o sistema consegue separar sozinho
          as ofertas (GERAL, EXAME, BOLETO, PROMO), calcular o resultado de cada uma e avisar quando algo foge da regra.{" "}
          <b>Nome errado = a oferta some dos relatórios.</b>
        </p>
      </Section>

      <Section n="2" title="As 5 regras de ouro">
        <ol className="grid gap-2 sm:grid-cols-2">
          {[
            ["Separe as partes com |", "Barra em pé com um espaço de cada lado: GERAL | ITU"],
            ["Tudo em MAIÚSCULAS", "Acento pode, mas não é obrigatório."],
            ["Siga a ordem", "As partes vão sempre na mesma ordem. Parte que não se aplica: pule, não deixe vazia."],
            ['Nunca deixe "Cópia"', "Duplicou? Renomeie na hora, antes de publicar."],
            ["Valor sempre em R$", "R$ 15,00 — nunca \"15 REAIS\" ou \"1 REAL\"."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3 rounded-xl border border-zinc-200 p-3 dark:border-white/10">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{i + 1}</span>
              <div>
                <div className="font-semibold">{t}</div>
                <div className={`text-xs ${muted}`}>{d}</div>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section n="3" title="Campanha">
        <Box className="flex flex-col gap-3">
          <Pieces
            parts={[
              { label: "Tipo", req: "sempre", ex: "PROMO" },
              { label: "Objetivo", req: "sempre", ex: "ENGAJAMENTO" },
              { label: "Unidade", req: "sempre", ex: "IVS ITU" },
            ]}
          />
          <ul className="flex flex-col gap-1.5 text-sm">
            <li>
              <b>Tipo:</b> só <code>GERAL</code>, <code>EXAME</code> ou <code>PROMO</code>.
            </li>
            <li>
              <b>Objetivo:</b> o objetivo escolhido na criação da campanha na Meta: <code>{OBJECTIVES.join(", ")}</code>. Não é o canal (nada de
              WHATSAPP). Campanha de formulário tem objetivo de cadastros: escreva <code>LEADS</code> (não FORMULARIO).
            </li>
            <li>
              <b>Unidade:</b> o nome da unidade, igual à lista do “Monte o nome”. Campanha não leva data.
            </li>
          </ul>
          <div className="flex flex-col gap-1.5">
            <Name>GERAL | ENGAJAMENTO | IVS ITU</Name>
            <Name>PROMO | LEADS | IVS CHAPECÓ</Name>
          </div>
          <div className="rounded-lg bg-zinc-100 p-3 dark:bg-white/5">
            <div className="font-semibold">Campanha de vaga de emprego</div>
            <p className={`text-xs ${muted}`}>
              Começa com <code>[VAGA]</code>, com os colchetes. O resto é livre. Os conjuntos e criativos dela não seguem este padrão.
            </p>
            <div className="mt-2">
              <Name>[VAGA] RECEPCIONISTA | IVS ITU</Name>
            </div>
          </div>
        </Box>
      </Section>

      <Section n="4" title="Conjunto">
        <Box className="flex flex-col gap-4">
          <Pieces
            parts={[
              { label: "Tipo", req: "sempre", ex: "PROMO" },
              { label: "Oferta", req: "às vezes", ex: "ARMAÇÃO R$ 1,00" },
              { label: "Vídeo", req: "às vezes", ex: "VDO PROPRIO" },
              { label: "Local", req: "sempre", ex: "ITU" },
              { label: "Idade", req: "sempre", ex: "25-54" },
              { label: "Gênero", req: "às vezes", ex: "MULHER" },
              { label: "Plataforma", req: "às vezes", ex: "INSTA" },
              { label: "Interesses", req: "às vezes", ex: "INTERESSES" },
              { label: "Responsável", req: "sempre", ex: "AND" },
              { label: "Data", req: "sempre", ex: "01/11" },
            ]}
          />
          <p className={`text-xs ${muted}`}>Borda azul = sempre vai. Borda tracejada = só quando se aplica (se não se aplica, pula a parte).</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[11px] tracking-wide text-zinc-500 uppercase dark:border-white/10">
                  <th className="py-2 pr-3 font-semibold">Parte</th>
                  <th className="py-2 pr-3 font-semibold">Como escrever</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                {(
                  [
                    ["Tipo", <>Só <code>GERAL</code>, <code>EXAME</code> ou <code>PROMO</code>.</>],
                    [
                      "Oferta",
                      <>
                        <b>GERAL:</b> sem oferta. A única exceção é o boleto: <code>GERAL | BOLETO</code>.
                        <br />
                        <b>EXAME:</b> tipo e valor juntos, na mesma parte: <code>EXAME R$ 15,00</code>.
                        <br />
                        <b>PROMO:</b> a oferta vem logo depois, com o valor dentro dela: <code>PROMO | ARMAÇÃO R$ 1,00</code>.
                      </>,
                    ],
                    [
                      "Vídeo",
                      <>
                        <code>VDO PROPRIO</code> quando o vídeo foi gravado pelo cliente. Vídeo da franquia não leva nada.
                      </>,
                    ],
                    [
                      "Local",
                      <>
                        Com raio: <b>só o km</b> (<code>8KM</code>). Uma cidade: o nome (<code>ITU</code>). Várias: a primeira com <b>+ colado</b> (
                        <code>AMPARO+</code>).
                      </>,
                    ],
                    ["Idade", <>Igual ao público: <code>25-54</code>. Até 65 ou mais: <code>18-65+</code>.</>],
                    ["Gênero", <><code>MULHER</code> ou <code>HOMEM</code> só se for um gênero só. Os dois: não escreve.</>],
                    ["Plataforma", <><code>INSTA</code> ou <code>FACE</code> só se rodar em uma só. As duas: não escreve.</>],
                    ["Interesses", <><code>INTERESSES</code> só se o conjunto tiver interesses.</>],
                    ["Responsável", <>A identificação do gestor responsável pela conta.</>],
                    ["Data", <>Dia/mês em que o conjunto <b>começou a veicular</b>: <code>01/11</code>. Conjunto programado: a data de início programada.</>],
                  ] as Array<[string, ReactNode]>
                ).map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-2 pr-3 align-top font-semibold whitespace-nowrap">{k}</td>
                    <td className="py-2 pr-3">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {responsaveis.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className={muted}>Identificações:</span>
              {responsaveis.map((r) => (
                <span key={r.tag + r.name} className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-white/10">
                  {r.name} = <b className="font-mono">{r.tag}</b>
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Name>GERAL | ITU | 25-65+ | AND | 01/11</Name>
            <Name>GERAL | BOLETO | ITU | 25-65+ | AND | 01/11</Name>
            <Name>EXAME R$ 15,00 | 8KM | 30-65+ | MULHER | AND | 01/11</Name>
            <Name>PROMO | ARMAÇÃO R$ 1,00 | VDO PROPRIO | AMPARO+ | 25-54 | INTERESSES | AND | 01/11</Name>
          </div>
        </Box>
      </Section>

      <Section n="5" title="Criativo (anúncio)">
        <Box className="flex flex-col gap-3">
          <p>
            <b>Só o nome do arquivo.</b> Nada de GERAL, PROMO, EXAME ou outra parte do padrão. Sem “Cópia”.
          </p>
          <Name>VIDEO MODELO 03</Name>
          <div className="rounded-lg bg-zinc-100 p-3 dark:bg-white/5">
            <div className="font-semibold">Exceção: criativo de EXAME</div>
            <p className={`text-xs ${muted}`}>Valor do exame | data em que foi usado pela primeira vez | variação.</p>
            <div className="mt-2">
              <Name>EXAME R$ 15,00 | 02/11 | V01</Name>
            </div>
          </div>
        </Box>
      </Section>

      <Section n="6" title="Erros que mais aparecem">
        <div className="grid gap-3">
          {[
            ["OFERTAS| WHATSAPP | IVS TIJUCA", "PROMO | ENGAJAMENTO | IVS TIJUCAS", "Campanha: o tipo é PROMO, e o objetivo é o da campanha, não o canal."],
            ["GERAL | FORMULARIO | IVS IJUÍ", "GERAL | LEADS | IVS IJUÍ", "Campanha de formulário: o objetivo é LEADS."],
            ["VAGA RECEPCIONISTA IVS ITU", "[VAGA] RECEPCIONISTA | IVS ITU", "Campanha de vaga começa com [VAGA]."],
            ["EXAME | R$ 15,00 | ITU | 25-65+ | AND | 01/11", "EXAME R$ 15,00 | ITU | 25-65+ | AND | 01/11", "No exame, tipo e valor ficam juntos."],
            ["PROMO | ARMAÇÃO 1 REAL | ITU | 25-54 | AND | 01/11", "PROMO | ARMAÇÃO R$ 1,00 | ITU | 25-54 | AND | 01/11", "Valor sempre em R$."],
            ["GERAL | CREDIARIO | ITU | 25-65+ | AND | 01/11", "GERAL | BOLETO | ITU | 25-65+ | AND | 01/11", "Crediário é boleto."],
            ["GERAL | ARMAÇÃO R$ 49,99 | ITU | 25-65+ | AND | 01/11", "GERAL | ITU | 25-65+ | AND | 01/11", "GERAL não leva oferta (só BOLETO)."],
            ["PROMO | 200 DE DESCONTO | MURIAÉ + | 25-54 | AND | 01/11", "PROMO | 200 DE DESCONTO | MURIAÉ+ | 25-54 | AND | 01/11", "O + vai colado na cidade."],
            ["GERAL | EFAPI 8 KM | 25-65+ | AND | 01/11", "GERAL | 8KM | 25-65+ | AND | 01/11", "Com raio, só o km (sem a cidade)."],
            ["GERAL | VIDEO MODELO 03", "VIDEO MODELO 03", "Criativo leva só o nome do arquivo."],
            ["GERAL | ITU | 25-65+ | AND | 01/11 - Cópia", "GERAL | ITU | 25-65+ | AND | 01/11", "Duplicou, renomeou."],
          ].map(([bad, good, why]) => (
            <Box key={bad} className="flex flex-col gap-1.5">
              <Name tone="bad">{bad}</Name>
              <Name>{good}</Name>
              <div className={`text-xs ${muted}`}>{why}</div>
            </Box>
          ))}
        </div>
      </Section>

      <Section n="7" title="Monte o nome">
        <p className={`text-xs ${muted}`}>Preencha e copie. O nome sai no padrão certo.</p>
        <Builder units={units} responsaveis={responsaveis} />
      </Section>

      <Section n="8" title="Checklist antes de publicar">
        <ul className="grid gap-1.5">
          {[
            "Campanha: GERAL, EXAME ou PROMO | objetivo da campanha | unidade",
            "Campanha de vaga começa com [VAGA]",
            "GERAL sem oferta (exceto BOLETO); EXAME com o valor junto; PROMO com a oferta",
            "Valores em R$ 15,00",
            "Localização, idade, responsável e data no conjunto, iguais ao público",
            "Criativo com o nome do arquivo (exame: EXAME R$ | data | variação)",
            'Nenhum "Cópia" em campanha, conjunto ou criativo',
          ].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-300 text-xs dark:border-white/20">✓</span>
              {t}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
