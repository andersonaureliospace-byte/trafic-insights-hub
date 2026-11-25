"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, useEstr } from "@/components/estrategia/shell";
import { MetaCredentialsForm } from "@/components/meta-credentials-form";
import { WhatsappTab } from "@/components/configuracoes/whatsapp-tab";
import { StatusTab } from "@/components/configuracoes/status-tab";
import { Btn, Card } from "@/components/estrategia/ui";
import { GroupPicker } from "@/components/estrategia/auditorias-config";
import type { GroupRef } from "@/lib/estrategia/auditorias/config";

// Conexões (antes em /configuracoes, no visual do Hub antigo): token da Meta, WhatsApp (uazapi) e nomes/cores da prioridade.
// Etapa 353: + Asana (token e seções de cada estrategista), Gravador (chave pessoal da extensão) e, pro estrategista,
// Avisos (grupo e WhatsApp que recebem os avisos automáticos — as regras são do master).
const TABS = [
  { id: "meta", label: "Meta (Facebook)" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "avisos", label: "Avisos" },
  { id: "asana", label: "Asana" },
  { id: "gravador", label: "Gravador" },
  { id: "status", label: "Prioridade" },
] as const;

const inputCls = "h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]";

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p className={`text-sm ${m.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{m.text}</p>;
}

function AsanaTab() {
  const [d, setD] = useState<{ secao: string; tokenFim: string | null; usandoVercel: boolean; isMaster: boolean } | null>(null);
  const [token, setToken] = useState("");
  const [secao, setSecao] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch("/api/conexoes/asana", { cache: "no-store" }).then((x) => x.json());
    if (!r.error) {
      setD(r);
      setSecao(r.secao ?? "");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao abrir
    void load();
  }, [load]);
  async function salvar(extra: Record<string, unknown> = {}) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/conexoes/asana", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, secao, ...extra }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setToken("");
      setMsg({ ok: true, text: "Salvo." });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <div className="font-semibold">Asana</div>
        <p className="text-xs text-zinc-500">
          Usado pra atualizar a prioridade dos clientes e buscar/enviar a descrição. Cada estrategista usa o próprio token e as próprias seções no projeto.
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-zinc-500">Token pessoal do Asana (Personal Access Token)</span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={d?.tokenFim ? `configurado (termina em ${d.tokenFim}) — cole outro pra trocar` : d?.usandoVercel ? "usando o token da Vercel — cole um pra trocar" : "cole o token aqui"}
          className={inputCls}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-zinc-500">Nome nas seções do projeto (ex.: Anderson → pega as seções “Anderson - (Denner)”, “Kauê (Anderson)”…)</span>
        <input value={secao} onChange={(e) => setSecao(e.target.value)} placeholder={d?.isMaster ? "Anderson (padrão)" : "seu nome como aparece nas seções"} className={inputCls} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Btn primary disabled={busy} onClick={() => void salvar()}>
          Salvar
        </Btn>
        {d?.tokenFim ? (
          <Btn disabled={busy} onClick={() => void salvar({ limparToken: true })}>
            Remover token
          </Btn>
        ) : null}
      </div>
      <Msg m={msg} />
    </Card>
  );
}

function GravadorTab() {
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    fetch("/api/conexoes/gravador", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setKey(d.key ?? null))
      .catch(() => setKey(null));
  }, []);
  async function gerar() {
    setBusy(true);
    try {
      const d = await fetch("/api/conexoes/gravador", { method: "POST" }).then((r) => r.json());
      if (!d.error) setKey(d.key);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <div className="font-semibold">Gravador de tela (extensão do Chrome)</div>
        <p className="text-xs text-zinc-500">
          Cole esta chave no campo de chave da extensão. Assim os feedbacks gravados caem na sua carteira (seus clientes e seu WhatsApp).
        </p>
      </div>
      {key === undefined ? (
        <p className="text-sm text-zinc-500">Carregando…</p>
      ) : key ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-zinc-100 px-2 py-1 text-xs break-all dark:bg-white/5">{key}</code>
          <Btn
            small
            onClick={() =>
              void navigator.clipboard.writeText(key).then(() => {
                setCopiado(true);
                setTimeout(() => setCopiado(false), 2000);
              })
            }
          >
            {copiado ? "Copiado ✓" : "Copiar"}
          </Btn>
          <Btn small disabled={busy} onClick={() => void gerar()} title="A chave antiga para de funcionar">
            Gerar outra
          </Btn>
        </div>
      ) : (
        <div>
          <Btn primary disabled={busy} onClick={() => void gerar()}>
            Gerar minha chave
          </Btn>
        </div>
      )}
      <p className="text-xs text-zinc-500">A chave antiga da extensão continua funcionando e grava na carteira do master.</p>
    </Card>
  );
}

function AvisosTab() {
  const [g, setG] = useState<GroupRef | null>(null);
  const [wa, setWa] = useState("");
  const [groups, setGroups] = useState<GroupRef[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/conexoes/avisos", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return;
        setG(d.defaultGroup ?? null);
        setWa(d.myWhatsapp ?? "");
      })
      .catch(() => {});
  }, []);
  const loadGroups = useCallback(() => {
    if (groups) return;
    fetch("/api/whatsapp/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json())
      .then((d) => setGroups(((d.groups ?? []) as Array<{ id: string; name: string }>).map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => setGroups([]));
  }, [groups]);
  async function salvar() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/conexoes/avisos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultGroup: g, myWhatsapp: wa }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setMsg({ ok: true, text: "Salvo." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <div className="font-semibold">Avisos automáticos</div>
        <p className="text-xs text-zinc-500">
          Os horários e as regras das conferências são definidos pelo master. Aqui você escolhe onde os avisos das SUAS contas chegam.
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-zinc-500">Grupo do WhatsApp que recebe os resumos</span>
        <GroupPicker value={g} groups={groups} onLoad={loadGroups} onChange={setG} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-zinc-500">Seu WhatsApp (com DDD) — recebe o prazo de otimização</span>
        <input inputMode="tel" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="(63) 99999-9999" className={`${inputCls} max-w-xs`} />
      </label>
      <div>
        <Btn primary disabled={busy} onClick={() => void salvar()}>
          Salvar
        </Btn>
      </div>
      <Msg m={msg} />
    </Card>
  );
}

export default function ConexoesPage() {
  const { role } = useEstr();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("meta");
  // O master define os grupos em Automações; a aba Avisos é do estrategista.
  const tabs = TABS.filter((t) => !(t.id === "avisos" && role === "master"));
  return (
    <div className="flex flex-col">
      <PageHeader title="Conexões" sub="Meta, WhatsApp, Asana, gravador e nomes/cores da prioridade" noFilter />
      <div className="flex flex-col gap-4 p-4 lg:p-6">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                tab === t.id ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="max-w-[900px]">
          {tab === "meta" ? <MetaCredentialsForm /> : null}
          {tab === "whatsapp" ? <WhatsappTab /> : null}
          {tab === "avisos" ? <AvisosTab /> : null}
          {tab === "asana" ? <AsanaTab /> : null}
          {tab === "gravador" ? <GravadorTab /> : null}
          {tab === "status" ? <StatusTab /> : null}
        </div>
      </div>
    </div>
  );
}
