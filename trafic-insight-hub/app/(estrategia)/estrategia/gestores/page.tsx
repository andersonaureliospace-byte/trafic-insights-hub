"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, useEstr, type Gestor } from "@/components/estrategia/shell";
import { loadClientes, type Cliente } from "@/components/estrategia/use-carteira";
import { Btn, Card, Pill, fmtBRL } from "@/components/estrategia/ui";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";

// Etapa 239: Configurações → Gestores. Cadastro (nome + WhatsApp) e atribuição de contas em massa.
// Renomear um gestor troca o nome em todas as contas dele; excluir deixa as contas dele sem responsável.

const inputCls = "h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]";

function onlyDigits(s: string) {
  return s.replace(/\D/g, "");
}

function fmtPhone(s: string): string {
  const d = onlyDigits(s);
  const m = d.match(/^(55)?(\d{2})(\d{4,5})(\d{4})$/);
  if (!m) return s;
  return `${m[1] ? "+55 " : ""}(${m[2]}) ${m[3]}-${m[4]}`;
}

async function assign(body: Record<string, unknown>): Promise<number> {
  const d = await fetch("/api/estrategia/assign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
  return Number(d.updated ?? 0);
}

function GestorRow({
  g,
  count,
  onSave,
  onDelete,
  busy,
}: {
  g: Gestor;
  count: number;
  onSave: (next: Gestor) => Promise<void>;
  onDelete: () => Promise<void>;
  busy: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(g.name);
  const [wa, setWa] = useState(g.whatsapp);
  const [tag, setTag] = useState(g.tag);
  const [confirm, setConfirm] = useState(false);

  if (edit) {
    return (
      <li className="flex flex-col gap-2 px-4 py-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <input aria-label="Nome" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          <input aria-label="WhatsApp" inputMode="tel" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="(63) 99999-9999" className={inputCls} />
          <input aria-label="Identificação na nomenclatura" value={tag} onChange={(e) => setTag(e.target.value.toUpperCase())} placeholder="AND" className={inputCls} />
        </div>
        <div className="flex gap-2">
          <Btn
            primary
            small
            disabled={busy || !name.trim()}
            onClick={() =>
              void onSave({ name: name.trim(), whatsapp: wa.trim(), tag: tag.trim() })
                .then(() => setEdit(false))
                .catch(() => {
                  /* mensagem já mostrada; continua editando */
                })
            }
          >
            Salvar
          </Btn>
          <Btn
            small
            onClick={() => {
              setEdit(false);
              setName(g.name);
              setWa(g.whatsapp);
              setTag(g.tag);
            }}
          >
            Cancelar
          </Btn>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{g.name}</div>
        <div className="text-xs text-zinc-500 tabular-nums">
          {g.whatsapp ? fmtPhone(g.whatsapp) : "sem WhatsApp"} ·{" "}
          {g.tag ? (
            <span title="Identificação na nomenclatura">
              nomenclatura <b className="font-mono text-zinc-700 dark:text-zinc-300">{g.tag}</b>
            </span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">sem identificação</span>
          )}
        </div>
      </div>
      <Pill tone={count > 0 ? "info" : "off"}>
        {count} {count === 1 ? "conta" : "contas"}
      </Pill>
      {confirm ? (
        <>
          <span className="w-full text-xs text-zinc-500 sm:w-auto">
            {count > 0 ? `As ${count} contas ficam sem responsável.` : "Excluir este gestor?"}
          </span>
          <Btn small onClick={() => setConfirm(false)}>Cancelar</Btn>
          <button
            onClick={() => void onDelete()}
            disabled={busy}
            className="h-7 rounded-lg bg-red-600 px-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Excluir
          </button>
        </>
      ) : (
        <>
          <Btn small onClick={() => setEdit(true)}>Editar</Btn>
          <Btn small onClick={() => setConfirm(true)} title="Excluir gestor">Excluir</Btn>
        </>
      )}
    </li>
  );
}

export default function GestoresPage() {
  const { gestoresFull, saveGestores } = useEstr();
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoWa, setNovoWa] = useState("");
  const [novoTag, setNovoTag] = useState("");
  const [filter, setFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const list = await loadClientes();
      setClientes(list.filter((c) => c.selected && !c.archived));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega as contas ao abrir
    void load();
  }, [load]);

  const countBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of clientes ?? []) if (c.responsible) m.set(c.responsible, (m.get(c.responsible) ?? 0) + 1);
    return m;
  }, [clientes]);
  const semResp = (clientes ?? []).filter((c) => !c.responsible).length;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (clientes ?? []).filter((c) => {
      if (filter === "__none" && c.responsible) return false;
      if (filter && filter !== "__none" && c.responsible !== filter) return false;
      return !q || c.name.toLowerCase().includes(q);
    });
  }, [clientes, filter, search]);

  const allShownPicked = shown.length > 0 && shown.every((c) => picked.has(c.id));

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 5000);
  }

  async function addGestor() {
    const name = novoNome.trim();
    if (!name) return;
    if (gestoresFull.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      flash(false, `Já existe um gestor chamado ${name}.`);
      return;
    }
    setBusy(true);
    try {
      await saveGestores([...gestoresFull, { name, whatsapp: novoWa.trim(), tag: novoTag.trim() }]);
      setNovoNome("");
      setNovoWa("");
      setNovoTag("");
      flash(true, `${name} cadastrado.`);
    } catch (e) {
      flash(false, (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateGestor(old: Gestor, next: Gestor) {
    if (next.name.toLowerCase() !== old.name.toLowerCase() && gestoresFull.some((g) => g.name.toLowerCase() === next.name.toLowerCase())) {
      flash(false, `Já existe um gestor chamado ${next.name}.`);
      throw new Error("duplicado");
    }
    setBusy(true);
    try {
      await saveGestores(gestoresFull.map((g) => (g.name === old.name ? next : g)));
      if (next.name !== old.name) {
        const n = await assign({ renameFrom: old.name, responsible: next.name });
        if (filter === old.name) setFilter(next.name);
        if (target === old.name) setTarget(next.name);
        await load();
        flash(true, `Gestor renomeado${n > 0 ? ` e ${n} ${n === 1 ? "conta atualizada" : "contas atualizadas"}` : ""}.`);
      } else {
        flash(true, "Gestor atualizado.");
      }
    } catch (e) {
      flash(false, (e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function deleteGestor(g: Gestor) {
    setBusy(true);
    try {
      if ((countBy.get(g.name) ?? 0) > 0) await assign({ renameFrom: g.name, responsible: null });
      await saveGestores(gestoresFull.filter((x) => x.name !== g.name));
      if (filter === g.name) setFilter("");
      if (target === g.name) setTarget("");
      await load();
      flash(true, `${g.name} excluído.`);
    } catch (e) {
      flash(false, (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyBulk() {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const ids = (clientes ?? []).filter((c) => picked.has(c.id)).map((c) => c.rawId);
      const n = await assign({ accountIds: ids, responsible: target || null });
      setPicked(new Set());
      await load();
      flash(true, `${n} ${n === 1 ? "conta" : "contas"} ${target ? `atribuídas a ${target}` : "sem responsável agora"}.`);
    } catch (e) {
      flash(false, (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllShown() {
    setPicked((cur) => {
      const next = new Set(cur);
      if (allShownPicked) for (const c of shown) next.delete(c.id);
      else for (const c of shown) next.add(c.id);
      return next;
    });
  }

  return (
    <div className="flex flex-col">
      <PageHeader noFilter title="Gestores" sub="Cadastre os gestores e escolha quem cuida de cada conta" />
      <div className="grid gap-4 p-4 lg:p-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        {/* Cadastro */}
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <div className="mb-3 text-sm font-semibold">Novo gestor</div>
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void addGestor();
              }}
            >
              <label htmlFor="g-nome" className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Nome</label>
              <input id="g-nome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex.: Denner" className={inputCls} />
              <label htmlFor="g-wa" className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">WhatsApp</label>
              <input id="g-wa" inputMode="tel" value={novoWa} onChange={(e) => setNovoWa(e.target.value)} placeholder="(63) 99999-9999" className={inputCls} />
              <label htmlFor="g-tag" className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Identificação na nomenclatura</label>
              <input id="g-tag" value={novoTag} onChange={(e) => setNovoTag(e.target.value.toUpperCase())} placeholder="AND" className={inputCls} />
              <p className="text-xs text-zinc-500">Vai no nome dos conjuntos das contas desse gestor, antes da data.</p>
              <div className="pt-1">
                <Btn primary type="submit" disabled={busy || !novoNome.trim()}>Cadastrar gestor</Btn>
              </div>
            </form>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-white/10">
              <span className="text-sm font-semibold">Gestores cadastrados</span>
              <span className="text-xs text-zinc-500">{gestoresFull.length}</span>
            </div>
            <ul className="divide-y divide-zinc-100 dark:divide-white/5">
              {gestoresFull.length === 0 ? <li className="px-4 py-4 text-sm text-zinc-500">Nenhum gestor ainda. Cadastre o primeiro acima.</li> : null}
              {gestoresFull.map((g) => (
                <GestorRow
                  key={g.name}
                  g={g}
                  count={countBy.get(g.name) ?? 0}
                  busy={busy}
                  onSave={(next) => updateGestor(g, next)}
                  onDelete={() => deleteGestor(g)}
                />
              ))}
              <li className="flex items-center justify-between px-4 py-3 text-sm text-zinc-500">
                Sem responsável
                <Pill tone={semResp > 0 ? "warn" : "ok"}>
                  {semResp} {semResp === 1 ? "conta" : "contas"}
                </Pill>
              </li>
            </ul>
          </Card>
        </div>

        {/* Atribuição em massa */}
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
            <span className="mr-auto text-sm font-semibold">Atribuir contas</span>
            <input
              aria-label="Buscar conta"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conta"
              className="h-8 w-44 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
            />
            <label htmlFor="g-filter" className="text-xs text-zinc-500">Mostrar</label>
            <select
              id="g-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
            >
              <option value="">Todas</option>
              <option value="__none">Sem responsável</option>
              {gestoresFull.map((g) => (
                <option key={g.name} value={g.name}>{g.name}</option>
              ))}
            </select>
          </div>

          {/* Barra de ação */}
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-blue-600/5 px-4 py-3 dark:border-white/10 dark:bg-blue-500/10">
            <span className="text-sm font-medium tabular-nums">
              {picked.size} {picked.size === 1 ? "selecionada" : "selecionadas"}
            </span>
            <span className="text-sm text-zinc-500">→</span>
            <label htmlFor="g-target" className="sr-only">Atribuir a</label>
            <select
              id="g-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
            >
              <option value="">Sem responsável</option>
              {gestoresFull.map((g) => (
                <option key={g.name} value={g.name}>{g.name}</option>
              ))}
            </select>
            <Btn primary small disabled={busy || picked.size === 0} onClick={() => void applyBulk()}>
              {busy ? "Salvando…" : target ? `Atribuir a ${target}` : "Tirar responsável"}
            </Btn>
            {picked.size > 0 ? (
              <Btn small onClick={() => setPicked(new Set())}>Limpar seleção</Btn>
            ) : null}
            {msg ? <span className={`text-sm ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</span> : null}
          </div>

          {error ? <div className="px-4 py-3 text-sm text-red-600">{error}</div> : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[11px] tracking-wide text-zinc-500 uppercase dark:border-white/10">
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todas as contas mostradas"
                      checked={allShownPicked}
                      onChange={toggleAllShown}
                      className="h-4 w-4 accent-blue-600"
                    />
                  </th>
                  <th className="px-2 py-2.5 font-semibold">Conta</th>
                  <th className="px-3 py-2.5 font-semibold">Responsável atual</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Verba mensal</th>
                </tr>
              </thead>
              <tbody>
                {clientes == null ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">Carregando…</td>
                  </tr>
                ) : shown.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">Nenhuma conta nesse filtro.</td>
                  </tr>
                ) : (
                  shown.map((c) => {
                    const on = picked.has(c.id);
                    return (
                      <tr
                        key={c.id}
                        onClick={() => toggle(c.id)}
                        className={`cursor-pointer border-b border-zinc-100 last:border-0 dark:border-white/5 ${
                          on ? "bg-blue-600/8 dark:bg-blue-500/10" : "hover:bg-zinc-50 dark:hover:bg-white/[0.02]"
                        }`}
                      >
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Selecionar ${c.name}`}
                            checked={on}
                            onChange={() => toggle(c.id)}
                            className="h-4 w-4 accent-blue-600"
                          />
                        </td>
                        <td className="px-2 py-2.5 font-semibold">
                          {/* Etapa 248: atalho pro Gerenciador de Anúncios (não marca a linha ao clicar) */}
                          <a
                            href={adsManagerUrl(c.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Abrir no Gerenciador de Anúncios"
                            className="group inline-flex items-center gap-1.5 hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                          >
                            {c.name}
                            <span aria-hidden className="text-xs font-normal text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                              ↗
                            </span>
                          </a>
                          {!c.active ? <span className="ml-2 text-xs font-normal text-zinc-500">(pausado)</span> : null}
                        </td>
                        <td className="px-3 py-2.5">
                          {c.responsible ? <span>{c.responsible}</span> : <span className="text-zinc-400">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{fmtBRL(c.monthly)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
