"use client";

import { useEffect, useState } from "react";

// Etapa 229: configurações completas de um conjunto (aparece ao abrir o conjunto em "Conjuntos da conta").
// Busca uma vez por conjunto e guarda enquanto a tela estiver aberta.
interface Details {
  name: string;
  campaign: { name: string; objective: string; status: string };
  budget: string;
  bidStrategy: string;
  bidAmount: number | null;
  optimization: string;
  destination: string;
  whatsapp: string | null;
  whatsappSource: "conjunto" | "criativo" | "pagina" | null;
  page: string | null;
  createdTime: string | null;
  startTime: string | null;
  endTime: string | null;
  age: string;
  advantage: boolean;
  genders: string;
  locations: string[];
  locationTypes: string[];
  excludedLocations: string[];
  interests: string[];
  audiences: string[];
  excludedAudiences: string[];
  placements: string[];
  devices: string[];
}

const memo = new Map<string, Details | { error: string }>();

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtPhone(n: string): string {
  const d = n.replace(/\D/g, "");
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : n;
}

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : ""}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="text-xs text-zinc-800 dark:text-zinc-200">{children}</div>
    </div>
  );
}

export function AdsetSettings({ adsetId }: { adsetId: string }) {
  const [d, setD] = useState<Details | { error: string } | null>(() => memo.get(adsetId) ?? null);

  useEffect(() => {
    if (memo.has(adsetId)) return;
    let cancelled = false;
    fetch("/api/analysis/adset-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adsetId }),
    })
      .then((r) => r.json())
      .then((x: Details & { error?: string }) => {
        const v = x.error ? { error: x.error } : x;
        if (!x.error) memo.set(adsetId, v);
        if (!cancelled) setD(v);
      })
      .catch((e: Error) => {
        if (!cancelled) setD({ error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [adsetId]);

  if (!d) return <p className="mb-2 text-xs text-zinc-500">Buscando as configurações do conjunto…</p>;
  if ("error" in d) return <p className="mb-2 text-xs text-red-600">Configurações: {d.error}</p>;

  const list = (xs: string[], empty = "—") => (xs.length ? xs.join(" · ") : empty);
  return (
    <div className="mb-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">Configurações do conjunto</span>
        {d.whatsapp ? (
          <a
            href={`https://wa.me/${d.whatsapp.replace(/\D/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 hover:underline dark:bg-emerald-950/40 dark:text-emerald-300"
            title={`Número do WhatsApp (tirado ${d.whatsappSource === "conjunto" ? "do conjunto" : d.whatsappSource === "criativo" ? "do criativo" : "da página"})`}
          >
            WhatsApp {fmtPhone(d.whatsapp)}
          </a>
        ) : (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">WhatsApp: a Meta não informou o número</span>
        )}
      </div>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        <Item label="Campanha">
          {d.campaign.name || "—"} {d.campaign.objective ? <span className="text-zinc-400">· {d.campaign.objective}</span> : null}
        </Item>
        <Item label="Página">{d.page ?? "—"}</Item>
        <Item label="Destino da conversa">{d.destination}</Item>
        <Item label="Meta de desempenho">{d.optimization || "—"}</Item>
        <Item label="Orçamento">{d.budget}</Item>
        <Item label="Estratégia de lance">
          {d.bidStrategy}
          {d.bidAmount != null ? ` · R$ ${d.bidAmount.toFixed(2).replace(".", ",")}` : ""}
        </Item>
        <Item label="Início">{fmtDate(d.startTime)}</Item>
        <Item label="Término">{d.endTime ? fmtDate(d.endTime) : "Sem data de término"}</Item>
        <Item label="Criado em">{fmtDate(d.createdTime)}</Item>
        <Item label="Idade">
          {d.age} {d.advantage ? <span className="text-zinc-400">· Público Advantage+ (a Meta pode passar da faixa)</span> : null}
        </Item>
        <Item label="Gênero">{d.genders}</Item>
        <Item label="Dispositivos">{list(d.devices, "Todos")}</Item>
        <Item label="Localização" wide>
          {list(d.locations)}
          {d.locationTypes.length ? (
            <span className="text-zinc-400">
              {" "}
              · {d.locationTypes.includes("recent") ? "Quem mora ou esteve recentemente" : "Quem mora"}
            </span>
          ) : null}
        </Item>
        {d.excludedLocations.length ? <Item label="Locais excluídos" wide>{list(d.excludedLocations)}</Item> : null}
        <Item label="Interesses / segmentação detalhada" wide>
          {list(d.interests, "Nenhum (aberto)")}
        </Item>
        {d.audiences.length || d.excludedAudiences.length ? (
          <Item label="Públicos personalizados" wide>
            {list(d.audiences, "Nenhum")}
            {d.excludedAudiences.length ? <span className="text-zinc-400"> · Excluídos: {d.excludedAudiences.join(", ")}</span> : null}
          </Item>
        ) : null}
        <Item label="Posicionamentos" wide>
          {list(d.placements)}
        </Item>
      </div>
    </div>
  );
}
