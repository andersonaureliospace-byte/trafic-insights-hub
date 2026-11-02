"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

// Etapa 240: POP 01 — Nomenclatura. Mesmo padrão que lib/naming/rules.ts confere (o alerta "Nomenclatura fora do padrão").
// Se a regra mudar lá, atualize este texto também.

const ink = "text-zinc-900 dark:text-zinc-100";
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

// Peças do nome (como blocos coloridos, na ordem).
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

function todayDM(): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).formatToParts(new Date());
  return `${p.find((x) => x.type === "day")?.value}/${p.find((x) => x.type === "month")?.value}`;
}

function CopyLine({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 rounded-md bg-zinc-900 px-3 py-2 font-mono text-sm break-all text-emerald-300 dark:bg-black/40">{value || "…"}</code>
      <button
        disabled={!value}
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
  );
}

function Builder() {
  const [kind, setKind] = useState<"conjunto" | "campanha">("conjunto");
  // campanha
  const [cTipo, setCTipo] = useState("GERAL");
  const [cObj, setCObj] = useState("WHATSAPP");
  const [cUnid, setCUnid] = useState("");
  // conjunto
  const [tipo, setTipo] = useState("GERAL");
  const [oferta, setOferta] = useState("");
  const [pag, setPag] = useState("");
  const [vdo, setVdo] = useState(false);
  const [locMode, setLocMode] = useState<"km" | "cidade" | "varias">("cidade");
  const [km, setKm] = useState("8");
  const [cidade, setCidade] = useState("");
  const [idMin, setIdMin] = useState("25");
  const [idMax, setIdMax] = useState("65");
  const [gen, setGen] = useState("");
  const [plat, setPlat] = useState("");
  const [inter, setInter] = useState(false);
  const [data, setData] = useState(todayDM());

  const campanha = [cTipo, up(cObj), up(cUnid)].filter(Boolean).join(" | ");
  const conjunto = useMemo(() => {
    const max = Number(idMax);
    const loc = locMode === "km" ? (km.trim() ? `${km.trim()}KM` : "") : locMode === "cidade" ? up(cidade) : cidade.trim() ? `${up(cidade)}+` : "";
    const parts = [
      tipo,
      tipo !== "GERAL" ? up(oferta) : "",
      pag,
      vdo ? "VDO PROPRIO" : "",
      loc,
      idMin && idMax ? `${idMin}-${max >= 65 ? "65+" : idMax}` : "",
      gen,
      plat,
      inter ? "INTERESSES" : "",
      "AND",
      data.trim(),
    ];
    return parts.filter(Boolean).join(" | ");
  }, [tipo, oferta, pag, vdo, locMode, km, cidade, idMin, idMax, gen, plat, inter, data]);

  const label = (t: string, id: string) => (
    <label htmlFor={id} className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
      {t}
    </label>
  );

  return (
    <Box className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-white/5">
        {(["conjunto", "campanha"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${kind === k ? "bg-white shadow-sm dark:bg-[#1b2230]" : muted}`}
          >
            {k === "conjunto" ? "Conjunto" : "Campanha"}
          </button>
        ))}
      </div>

      {kind === "campanha" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            {label("Tipo", "b-ctipo")}
            <select id="b-ctipo" value={cTipo} onChange={(e) => setCTipo(e.target.value)} className={inputCls}>
              <option>GERAL</option>
              <option>EXAME</option>
              <option>OFERTA</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            {label("Objetivo", "b-cobj")}
            <input id="b-cobj" value={cObj} onChange={(e) => setCObj(e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            {label("Unidade", "b-cunid")}
            <input id="b-cunid" value={cUnid} onChange={(e) => setCUnid(e.target.value)} placeholder="IVS ITU" className={inputCls} />
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            {label("Tipo", "b-tipo")}
            <select id="b-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
              <option>GERAL</option>
              <option>EXAME</option>
              <option>PROMO</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            {label("Oferta", "b-oferta")}
            <input
              id="b-oferta"
              value={tipo === "GERAL" ? "" : oferta}
              disabled={tipo === "GERAL"}
              onChange={(e) => setOferta(e.target.value)}
              placeholder={tipo === "GERAL" ? "GERAL não leva oferta" : "EXAME GRATIS"}
              className={`${inputCls} disabled:opacity-50`}
            />
          </div>
          <div className="flex flex-col gap-1">
            {label("Pagamento", "b-pag")}
            <select id="b-pag" value={pag} onChange={(e) => setPag(e.target.value)} className={inputCls}>
              <option value="">Nenhum</option>
              <option>CREDIARIO</option>
              <option>BOLETO</option>
            </select>
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={vdo} onChange={(e) => setVdo(e.target.checked)} className="h-4 w-4 accent-blue-600" />
            Vídeo gravado pelo cliente
          </label>
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
          <div className="flex flex-col gap-1">
            {label("Data de criação", "b-data")}
            <input id="b-data" value={data} onChange={(e) => setData(e.target.value)} placeholder="DD/MM" className={inputCls} />
          </div>
        </div>
      )}
      <CopyLine value={kind === "campanha" ? campanha : conjunto} />
    </Box>
  );
}

// ---------- página ----------

export default function PopNomenclatura() {
  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-200 px-4 py-4 lg:px-6 dark:border-white/10">
        <div className="text-xs text-zinc-500">
          <Link href="/estrategia/pop" className="hover:underline">POP</Link> / 01
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Nomenclatura de campanhas, conjuntos e anúncios</h1>
        <p className="text-xs text-zinc-500">Vale pra todas as contas IVS · todo gestor segue · conferido pelo alerta “Nomenclatura fora do padrão”</p>
      </div>

      <div className={`mx-auto flex w-full max-w-4xl flex-col gap-8 p-4 text-sm leading-relaxed lg:p-6 ${ink}`}>
        <Section n="1" title="Por que existe">
          <p>
            O nome é a etiqueta do anúncio. Com o nome certo, qualquer pessoa bate o olho e sabe o que está rodando, e o Hub consegue separar
            sozinho as ofertas (GERAL, EXAME, BOLETO, PROMOÇÃO), calcular o CPA de cada uma e avisar quando algo foge da regra.{" "}
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
              ["Campanha de VAGA fica fora", "Campanhas de vaga de emprego não seguem este padrão."],
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
                { label: "Tipo", req: "sempre", ex: "GERAL" },
                { label: "Objetivo", req: "sempre", ex: "WHATSAPP" },
                { label: "Unidade", req: "sempre", ex: "IVS ITU" },
              ]}
            />
            <ul className="flex flex-col gap-1.5 text-sm">
              <li>
                <b>Tipo:</b> só <code>GERAL</code>, <code>EXAME</code> ou <code>OFERTA</code>. Na campanha é OFERTA (não PROMO, não OFERTAS).
              </li>
              <li><b>Objetivo:</b> o objetivo da campanha.</li>
              <li><b>Unidade:</b> o nome da unidade. Campanha não leva data.</li>
            </ul>
            <div className="flex flex-col gap-1.5">
              <Name>GERAL | WHATSAPP | IVS ITU</Name>
              <Name>OFERTA | WHATSAPP | IVS TIJUCAS</Name>
            </div>
          </Box>
        </Section>

        <Section n="4" title="Conjunto">
          <Box className="flex flex-col gap-4">
            <Pieces
              parts={[
                { label: "Tipo", req: "sempre", ex: "PROMO" },
                { label: "Oferta", req: "às vezes", ex: "EXAME GRATIS" },
                { label: "Pagamento", req: "às vezes", ex: "BOLETO" },
                { label: "Vídeo", req: "às vezes", ex: "VDO PROPRIO" },
                { label: "Local", req: "sempre", ex: "ITU" },
                { label: "Idade", req: "sempre", ex: "25-54" },
                { label: "Gênero", req: "às vezes", ex: "MULHER" },
                { label: "Plataforma", req: "às vezes", ex: "INSTA" },
                { label: "Interesses", req: "às vezes", ex: "INTERESSES" },
                { label: "Gestor", req: "sempre", ex: "AND" },
                { label: "Data", req: "sempre", ex: "01/11" },
              ]}
            />
            <p className={`text-xs ${muted}`}>
              Borda azul = sempre vai. Borda tracejada = só quando se aplica (se não se aplica, pula a parte).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-[11px] tracking-wide text-zinc-500 uppercase dark:border-white/10">
                    <th className="py-2 pr-3 font-semibold">Parte</th>
                    <th className="py-2 pr-3 font-semibold">Como escrever</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                  {[
                    ["Tipo", <>Só <code>GERAL</code>, <code>EXAME</code> ou <code>PROMO</code>. No conjunto é PROMO (na campanha é OFERTA).</>],
                    ["Oferta", <>Só em EXAME e PROMO, logo depois do tipo. <b>GERAL não leva oferta</b> (nada de “ARMAÇÃO R$ 49,99”).</>],
                    ["Pagamento", <><code>CREDIARIO</code> ou <code>BOLETO</code>, só se o conjunto for disso. Vem depois da oferta.</>],
                    ["Vídeo", <><code>VDO PROPRIO</code> quando o vídeo foi gravado pelo cliente.</>],
                    [
                      "Local",
                      <>
                        Com raio: <b>só o km</b> (<code>8KM</code>). Uma cidade: o nome (<code>ITU</code>). Várias: a primeira com{" "}
                        <b>+ colado</b> (<code>AMPARO+</code>).
                      </>,
                    ],
                    ["Idade", <>Igual ao público: <code>25-54</code>. Até 65 ou mais: <code>18-65+</code>.</>],
                    ["Gênero", <><code>MULHER</code> ou <code>HOMEM</code> só se for um gênero só. Os dois: não escreve.</>],
                    ["Plataforma", <><code>INSTA</code> ou <code>FACE</code> só se rodar em uma só. As duas: não escreve.</>],
                    ["Interesses", <><code>INTERESSES</code> só se o conjunto tiver interesses.</>],
                    ["Gestor", <><code>AND</code>, sempre.</>],
                    ["Data", <>Dia/mês em que o conjunto foi criado: <code>01/11</code>.</>],
                  ].map(([k, v]) => (
                    <tr key={k as string}>
                      <td className="py-2 pr-3 align-top font-semibold whitespace-nowrap">{k}</td>
                      <td className="py-2 pr-3">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-1.5">
              <Name>GERAL | ITU | 25-65+ | AND | 01/11</Name>
              <Name>PROMO | 200 DE DESCONTO | MURIAE+ | 25-54 | AND | 01/11</Name>
              <Name>EXAME | EXAME GRATIS | BOLETO | 8KM | 30-65+ | MULHER | INTERESSES | AND | 01/11</Name>
            </div>
          </Box>
        </Section>

        <Section n="5" title="Anúncio">
          <Box>
            <p>
              Nome livre. A única regra: <b>sem “Cópia”</b>.
            </p>
          </Box>
        </Section>

        <Section n="6" title="Erros que mais aparecem">
          <div className="grid gap-3">
            {[
              ["OFERTAS| WHATSAAP | IVS TIJUCA", "OFERTA | WHATSAPP | IVS TIJUCAS", "Na campanha o tipo é OFERTA, sem S."],
              ["PROMO | LEADS | IVS CHAPECÓ", "OFERTA | LEADS | IVS CHAPECÓ", "Na campanha o tipo é OFERTA. PROMO é só no conjunto."],
              ["PROMO | 200 DE DESCONTO | MURIAÉ + | 25-54 | AND | 01/11", "PROMO | 200 DE DESCONTO | MURIAE+ | 25-54 | AND | 01/11", "O + vai colado na cidade."],
              ["GERAL | ARMAÇÃO R$ 49,99 | ITU | 25-65+ | AND | 01/11", "GERAL | ITU | 25-65+ | AND | 01/11", "GERAL não leva oferta."],
              ["GERAL | ITU | 25-65+ | AND | 01/11 - Cópia", "GERAL | ITU | 25-65+ | AND | 01/11", "Duplicou, renomeou."],
              ["GERAL | EFAPI 8 KM | 25-65+ | AND | 01/11", "GERAL | 8KM | 25-65+ | AND | 01/11", "Com raio, só o km (sem a cidade)."],
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
          <Builder />
        </Section>

        <Section n="8" title="Checklist antes de publicar">
          <ul className="grid gap-1.5">
            {[
              "Campanha começa com GERAL, EXAME ou OFERTA",
              "Conjunto começa com GERAL, EXAME ou PROMO",
              "GERAL sem oferta; EXAME e PROMO com oferta",
              "Localização, idade, AND e data no conjunto",
              "Idade e localização do nome iguais às do público",
              'Nenhum "Cópia" em campanha, conjunto ou anúncio',
            ].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded border border-zinc-300 text-xs dark:border-white/20">✓</span>
                {t}
              </li>
            ))}
          </ul>
        </Section>

        <Section n="9" title="Como é conferido">
          <p>
            O Hub confere todos os nomes ligados das contas IVS. O que estiver fora aparece em{" "}
            <Link href="/estrategia/trafego" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
              Tráfego → Alertas → Nomenclatura fora do padrão
            </Link>
            , com o nome atual, o erro e como deveria ficar. O gestor responsável corrige no Gerenciador.
          </p>
        </Section>
      </div>
    </div>
  );
}
