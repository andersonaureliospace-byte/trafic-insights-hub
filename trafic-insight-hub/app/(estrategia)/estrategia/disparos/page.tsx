"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/estrategia/shell";
import { Btn, Card, Pill } from "@/components/estrategia/ui";

// Etapa 266: Disparos em massa — texto, imagem e vídeo (uma ou várias mensagens, em ordem) pra um ou vários grupos do
// WhatsApp. Escolha os grupos por gestor (grupos dos clientes de cada um), por cliente ou à mão. O navegador manda um grupo
// por vez com um intervalo aleatório entre eles — a aba precisa ficar aberta até terminar.

interface ClienteRef {
  id: string;
  name: string;
  responsible: string | null;
}
interface SemGrupo extends ClienteRef {
  rawId: string;
  sugestao: { id: string; name: string } | null;
}
interface Grupo {
  id: string;
  name: string;
  clientes: ClienteRef[];
}
type Part =
  | { key: string; kind: "text"; text: string }
  | {
      key: string;
      kind: "media";
      text: string; // legenda
      file: File;
      preview: string; // object URL
      url: string | null; // URL pública depois de subir
      progress: number;
      error: string | null;
    };
type Estado = "pendente" | "enviando" | "ok" | "erro";
interface DisparoRow {
  id: string;
  status: "rodando" | "pausado" | "parado" | "concluido";
  resumo: string;
  total: number;
  ok: number;
  erro: number;
  next_at: string;
  last_error: string | null;
  created_at: string;
}
interface ItemRow {
  group_id: string;
  group_name: string;
  status: "pendente" | "ok" | "erro";
  parte: number;
  error: string | null;
}
const STATUS_LABEL: Record<DisparoRow["status"], string> = { rodando: "Enviando", pausado: "Pausado", parado: "Parado", concluido: "Concluído" };

const SEM_GESTOR = "__sem_gestor__";
const SO_CLIENTES = "__clientes__";
const TODOS = "__todos__";
const SEM_VINCULO = "__sem_vinculo__";

const INTERVALOS = [
  { id: "rapido", label: "5 a 10 s", min: 5, max: 10 },
  { id: "normal", label: "10 a 20 s (recomendado)", min: 10, max: 20 },
  { id: "seguro", label: "20 a 40 s", min: 20, max: 40 },
];

const inputCls = "h-9 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]";
const keyOf = () => Math.random().toString(36).slice(2, 10);
const fmtMB = (b: number) => `${(b / 1048576).toFixed(1).replace(".", ",")} MB`;

function gestoresDo(g: Grupo): string[] {
  return [...new Set(g.clientes.map((c) => c.responsible).filter((x): x is string => !!x))];
}

// {cliente} → nome(s) do(s) cliente(s) do grupo; sem cliente, o nome do grupo.
function nomeCliente(g: Grupo): string {
  const n = g.clientes.map((c) => c.name);
  if (n.length === 0) return g.name;
  if (n.length === 1) return n[0];
  return `${n.slice(0, -1).join(", ")} e ${n[n.length - 1]}`;
}
const aplicar = (t: string, g: Grupo | null) => (g ? t.replaceAll("{cliente}", nomeCliente(g)) : t);

function putArquivo(url: string, file: File, apikey: string | null, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    if (apikey) xhr.setRequestHeader("apikey", apikey);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Erro ${xhr.status} ao subir o arquivo.`)));
    xhr.onerror = () => reject(new Error("A conexão caiu no meio do envio do arquivo."));
    xhr.send(file);
  });
}

async function postJson<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/estrategia/disparos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let d: { error?: string } & Record<string, unknown>;
  try {
    d = JSON.parse(txt);
  } catch {
    throw new Error(r.status === 504 ? "O servidor demorou demais pra responder." : `O servidor respondeu um erro (${r.status}).`);
  }
  if (d.error) throw new Error(d.error);
  return d as T;
}

// ---------- Composição ----------

function PartCard({
  p,
  idx,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  p: Part;
  idx: number;
  total: number;
  onChange: (text: string) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const isImg = p.kind === "media" && p.file.type.startsWith("image/");
  const isVid = p.kind === "media" && p.file.type.startsWith("video/");
  return (
    <li className="rounded-lg border border-zinc-200 p-3 dark:border-white/10">
      <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
        <span className="font-semibold text-zinc-700 dark:text-zinc-300">
          {idx + 1}. {p.kind === "text" ? "Texto" : isImg ? "Imagem" : isVid ? "Vídeo" : "Arquivo"}
        </span>
        {p.kind === "media" ? (
          <span className="truncate">
            {p.file.name} · {fmtMB(p.file.size)}
            {isVid && (!p.file.type.includes("mp4") || p.file.size > 16 * 1048576) ? " · vai como arquivo (WhatsApp só toca MP4 até 16 MB)" : ""}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <button disabled={idx === 0} onClick={() => onMove(-1)} aria-label="Subir" className="rounded px-1.5 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-white/5">↑</button>
          <button disabled={idx === total - 1} onClick={() => onMove(1)} aria-label="Descer" className="rounded px-1.5 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-white/5">↓</button>
          <button onClick={onRemove} className="rounded px-1.5 font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">Remover</button>
        </span>
      </div>
      <div className="flex gap-3">
        {p.kind === "media" ? (
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-white/5">
            {isImg ? (
              // eslint-disable-next-line @next/next/no-img-element -- prévia local (object URL)
              <img src={p.preview} alt="" className="h-full w-full object-cover" />
            ) : isVid ? (
              <video src={p.preview} muted className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-2xl">📎</span>
            )}
            {p.url ? null : (
              <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-center text-[10px] text-white">
                {p.error ? "erro" : `subindo ${p.progress}%`}
              </span>
            )}
          </div>
        ) : null}
        <div className="flex-1">
          <textarea
            value={p.text}
            onChange={(e) => onChange(e.target.value)}
            rows={p.kind === "text" ? 5 : 3}
            maxLength={4096}
            placeholder={p.kind === "text" ? "Escreva a mensagem… use {cliente} pra puxar o nome do cliente." : "Legenda (opcional)"}
            className="w-full resize-y rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/10"
          />
          {p.kind === "media" && p.error ? <p className="text-xs text-red-600">{p.error}</p> : null}
        </div>
      </div>
    </li>
  );
}

// Prévia estilo WhatsApp do que chega no primeiro grupo marcado.
function Previa({ parts, grupo }: { parts: Part[]; grupo: Grupo | null }) {
  return (
    <div className="rounded-lg bg-[#efeae2] p-3 dark:bg-[#0b141a]">
      <p className="mb-2 text-center text-[11px] text-zinc-500">{grupo ? `Prévia em “${grupo.name}”` : "Prévia"}</p>
      <div className="flex flex-col items-end gap-1.5">
        {parts.length === 0 ? <p className="w-full text-center text-xs text-zinc-500">Adicione um texto, imagem ou vídeo.</p> : null}
        {parts.map((p) => {
          const text = aplicar(p.text, grupo).trim();
          if (p.kind === "text" && !text) return null;
          return (
            <div key={p.key} className="max-w-[85%] rounded-lg bg-[#d9fdd3] p-1.5 text-sm text-zinc-900 shadow-sm dark:bg-[#005c4b] dark:text-zinc-100">
              {p.kind === "media" ? (
                p.file.type.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element -- prévia local (object URL)
                  <img src={p.preview} alt="" className="max-h-56 rounded-md" />
                ) : p.file.type.startsWith("video/") ? (
                  <video src={p.preview} controls className="max-h-56 rounded-md" />
                ) : (
                  <p className="px-1.5 py-1">📎 {p.file.name}</p>
                )
              ) : null}
              {text ? <p className="px-1.5 py-1 whitespace-pre-wrap">{text}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Etapa 269: escolher o grupo pesquisando pelo nome (a lista do WhatsApp tem centenas de grupos).
const flat = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function GrupoBusca({
  label,
  grupos,
  value,
  sugestao,
  onChange,
}: {
  label: string;
  grupos: Grupo[];
  value: string;
  sugestao: string | null;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const fora = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [open]);
  const atual = grupos.find((g) => g.id === value) ?? null;
  const lista = useMemo(() => {
    const termos = flat(q).split(/\s+/).filter(Boolean);
    const hit = grupos.filter((g) => termos.every((t) => flat(g.name).includes(t)));
    // o sugerido primeiro
    return [...hit.filter((g) => g.id === sugestao), ...hit.filter((g) => g.id !== sugestao)].slice(0, 100);
  }, [grupos, q, sugestao]);
  return (
    <div ref={box} className="relative max-w-[260px] min-w-0 flex-1">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${inputCls} flex w-full items-center text-left ${atual ? "" : "text-zinc-500"}`}
      >
        <span className="truncate">{atual ? atual.name : "Escolha o grupo…"}</span>
        <span className="ml-auto pl-1 text-xs text-zinc-400">▾</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-80 max-w-[85vw] rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-[#121722]">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && lista[0]) {
                onChange(lista[0].id);
                setOpen(false);
              }
            }}
            placeholder="Pesquisar grupo…"
            aria-label="Pesquisar grupo"
            className={`${inputCls} mb-2 w-full`}
          />
          <div className="max-h-64 overflow-y-auto">
            {lista.length === 0 ? (
              <p className="px-2 py-2 text-xs text-zinc-500">Nenhum grupo com esse nome.</p>
            ) : (
              lista.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    onChange(g.id);
                    setOpen(false);
                  }}
                  className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-white/5 ${
                    g.id === value ? "font-semibold text-blue-600 dark:text-blue-400" : ""
                  }`}
                >
                  {g.name}
                  {g.id === sugestao ? <span className="ml-1 text-xs text-emerald-600 dark:text-emerald-400">(sugerido)</span> : null}
                  {g.clientes.length > 0 ? <span className="ml-1 text-xs text-zinc-400">· já é de {g.clientes.map((c) => c.name).join(", ")}</span> : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------- Página ----------

export default function DisparosPage() {
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [gestores, setGestores] = useState<string[]>([]);
  const [semGrupo, setSemGrupo] = useState<SemGrupo[]>([]);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [vinculando, setVinculando] = useState<string | null>(null);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [parts, setParts] = useState<Part[]>([{ key: keyOf(), kind: "text", text: "" }]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [filtro, setFiltro] = useState<string>(SO_CLIENTES);
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [intervalo, setIntervalo] = useState("normal");

  const [confirmando, setConfirmando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [criarErr, setCriarErr] = useState<string | null>(null);
  // Etapa 270: o disparo roda no servidor — a tela só acompanha (dá pra sair e voltar).
  const [disparos, setDisparos] = useState<DisparoRow[]>([]);
  const [semTabela, setSemTabela] = useState(false);
  const [acompanhar, setAcompanhar] = useState<string | null>(null);
  const [itens, setItens] = useState<ItemRow[]>([]);
  const rodando = criando;

  const carregar = useCallback(async (force: boolean) => {
    setLoading(true);
    setLoadErr(null);
    try {
      const d = await fetch(`/api/estrategia/disparos${force ? "?force=1" : ""}`, { cache: "no-store" }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setGrupos(d.groups ?? []);
      setGestores(d.gestores ?? []);
      setSemGrupo(d.semGrupo ?? []);
    } catch (e) {
      setLoadErr((e as Error).message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial dos grupos do WhatsApp
    void carregar(false);
  }, [carregar]);

  // Libera as prévias locais ao sair.
  const partsRef = useRef(parts);
  useEffect(() => {
    partsRef.current = parts;
  }, [parts]);
  useEffect(() => () => partsRef.current.forEach((p) => p.kind === "media" && URL.revokeObjectURL(p.preview)), []);

  const carregarDisparos = useCallback(async (id: string | null) => {
    try {
      const d = await fetch(`/api/estrategia/disparos?disparos=1${id ? `&id=${id}` : ""}`, { cache: "no-store" }).then((r) => r.json());
      if (d.error) return;
      setSemTabela(!!d.semTabela);
      setDisparos(d.disparos ?? []);
      setItens(d.itens ?? []);
      setAcompanhar((cur) => cur ?? d.itensDe ?? null);
    } catch {
      /* tenta de novo na próxima */
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial dos disparos
    void carregarDisparos(null);
  }, [carregarDisparos]);
  const atual = disparos.find((d) => d.id === acompanhar) ?? null;
  const vivo = disparos.some((d) => d.status === "rodando" || d.status === "pausado");
  useEffect(() => {
    if (!vivo) return;
    const t = setInterval(() => void carregarDisparos(acompanhar), 4000);
    return () => clearInterval(t);
  }, [vivo, acompanhar, carregarDisparos]);

  // Gestores que aparecem nos grupos, mesmo os que não estão cadastrados em Gestores.
  const listaGestores = useMemo(() => {
    const s = new Set(gestores);
    for (const g of grupos ?? []) for (const r of gestoresDo(g)) s.add(r);
    return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [gestores, grupos]);

  const contagem = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of grupos ?? []) {
      const gs = gestoresDo(g);
      for (const r of gs) m.set(r, (m.get(r) ?? 0) + 1);
      if (g.clientes.length > 0 && gs.length === 0) m.set(SEM_GESTOR, (m.get(SEM_GESTOR) ?? 0) + 1);
    }
    return m;
  }, [grupos]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (grupos ?? []).filter((g) => {
      if (filtro === SO_CLIENTES && g.clientes.length === 0) return false;
      if (filtro === SEM_VINCULO && g.clientes.length > 0) return false;
      if (filtro === SEM_GESTOR && (g.clientes.length === 0 || gestoresDo(g).length > 0)) return false;
      if (![TODOS, SO_CLIENTES, SEM_VINCULO, SEM_GESTOR].includes(filtro) && !gestoresDo(g).includes(filtro)) return false;
      if (!q) return true;
      return g.name.toLowerCase().includes(q) || g.clientes.some((c) => c.name.toLowerCase().includes(q));
    });
  }, [grupos, filtro, busca]);

  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((g) => sel.has(g.id));
  const marcarVisiveis = () =>
    setSel((s) => {
      const n = new Set(s);
      for (const g of visiveis) {
        if (todosVisiveisMarcados) n.delete(g.id);
        else n.add(g.id);
      }
      return n;
    });
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // Atalho: marca (ou desmarca) todos os grupos de um gestor, sem mexer no resto da seleção.
  const toggleGestor = (nome: string) => {
    const ids = (grupos ?? []).filter((g) => gestoresDo(g).includes(nome)).map((g) => g.id);
    const all = ids.length > 0 && ids.every((id) => sel.has(id));
    setSel((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (all) n.delete(id);
        else n.add(id);
      }
      return n;
    });
  };

  // Etapa 267: contas sem grupo do filtro atual (gestor escolhido; "sem gestor"; ou todas).
  const semGrupoVis = useMemo(() => {
    if (filtro === SEM_VINCULO) return [];
    if (filtro === SEM_GESTOR) return semGrupo.filter((c) => !c.responsible);
    if (filtro === TODOS || filtro === SO_CLIENTES) return semGrupo;
    return semGrupo.filter((c) => c.responsible === filtro);
  }, [semGrupo, filtro]);
  const sugeridos = semGrupoVis.filter((c) => (escolha[c.id] ?? c.sugestao?.id ?? "") !== "");

  async function vincular(lista: SemGrupo[]) {
    setLinkErr(null);
    for (const c of lista) {
      const gid = escolha[c.id] ?? c.sugestao?.id ?? "";
      const g = (grupos ?? []).find((x) => x.id === gid);
      if (!g) continue;
      setVinculando(c.id);
      try {
        await postJson({ action: "link", ad_account_id: c.rawId, groupId: g.id, groupName: g.name });
      } catch (e) {
        setLinkErr(`${c.name}: ${(e as Error).message}`);
        break;
      }
    }
    setVinculando(null);
    await carregar(false);
  }

  const selecionados = useMemo(() => (grupos ?? []).filter((g) => sel.has(g.id)), [grupos, sel]);

  // ---- partes ----
  const updPart = (key: string, patch: Partial<Part>) => setParts((ps) => ps.map((p) => (p.key === key ? ({ ...p, ...patch } as Part) : p)));
  const addTexto = () => setParts((ps) => [...ps, { key: keyOf(), kind: "text", text: "" }]);
  const remover = (key: string) =>
    setParts((ps) => {
      const p = ps.find((x) => x.key === key);
      if (p?.kind === "media") URL.revokeObjectURL(p.preview);
      return ps.filter((x) => x.key !== key);
    });
  const mover = (idx: number, dir: -1 | 1) =>
    setParts((ps) => {
      const n = [...ps];
      const j = idx + dir;
      if (j < 0 || j >= n.length) return ps;
      [n[idx], n[j]] = [n[j], n[idx]];
      return n;
    });

  async function subir(key: string, file: File) {
    try {
      const up = await postJson<{ upload_url: string; apikey: string | null; url: string }>({
        action: "upload",
        mime: file.type,
        bytes: file.size,
        name: file.name,
      });
      await putArquivo(up.upload_url, file, up.apikey, (pct) => updPart(key, { progress: pct }));
      updPart(key, { url: up.url, progress: 100 });
    } catch (e) {
      updPart(key, { error: (e as Error).message });
    }
  }

  function anexar(files: FileList | null) {
    if (!files) return;
    const novos: Part[] = [];
    for (const file of Array.from(files)) {
      const key = keyOf();
      novos.push({ key, kind: "media", text: "", file, preview: URL.createObjectURL(file), url: null, progress: 0, error: null });
      void subir(key, file);
    }
    // Se só tem um texto vazio, a primeira mídia entra no lugar dele.
    setParts((ps) => (ps.length === 1 && ps[0].kind === "text" && !ps[0].text.trim() ? novos : [...ps, ...novos]).slice(0, 10));
    if (fileRef.current) fileRef.current.value = "";
  }

  const enviaveis = parts.filter((p) => (p.kind === "text" ? p.text.trim() : true));
  const subindo = parts.some((p) => p.kind === "media" && !p.url && !p.error);
  const comErro = parts.some((p) => p.kind === "media" && p.error);
  const podeEnviar = !rodando && selecionados.length > 0 && enviaveis.length > 0 && !subindo && !comErro;
  const intv = INTERVALOS.find((i) => i.id === intervalo) ?? INTERVALOS[1];
  const estimativaMin = Math.ceil((selecionados.length * ((intv.min + intv.max) / 2 + enviaveis.length * 2)) / 60);

  async function disparar(alvo: Grupo[]) {
    setConfirmando(false);
    setCriando(true);
    setCriarErr(null);
    try {
      const r = await postJson<{ id: string }>({
        action: "create",
        intervalMin: intv.min,
        intervalMax: intv.max,
        alvos: alvo.map((g) => ({ id: g.id, name: g.name, cliente: nomeCliente(g) })),
        parts: enviaveis.map((p) =>
          p.kind === "text"
            ? { kind: "text", text: p.text }
            : { kind: "media", text: p.text, url: p.url, mime: p.file.type, fileName: p.file.name, bytes: p.file.size },
        ),
      });
      setAcompanhar(r.id);
      await carregarDisparos(r.id);
    } catch (e) {
      setCriarErr((e as Error).message);
    }
    setCriando(false);
  }

  async function controlar(id: string, op: "pausar" | "continuar" | "parar" | "reenviar") {
    try {
      await postJson({ action: "control", id, op });
    } catch (e) {
      setCriarErr((e as Error).message);
    }
    await carregarDisparos(id);
  }

  // estado de cada grupo no disparo acompanhado
  const estado = useMemo(() => {
    const m: Record<string, { s: Estado; err?: string }> = {};
    for (const it of itens) {
      m[it.group_id] = { s: it.status === "pendente" && it.parte > 0 ? "enviando" : it.status, err: it.error ?? undefined };
    }
    return m;
  }, [itens]);
  const falhasItens = itens.filter((i) => i.status === "erro");

  function novoDisparo() {
    parts.forEach((p) => p.kind === "media" && URL.revokeObjectURL(p.preview));
    setParts([{ key: keyOf(), kind: "text", text: "" }]);
    setSel(new Set());
    setConfirmando(false);
  }

  return (
    <div className="flex flex-col">
      <PageHeader noFilter title="Disparos" sub="Texto, imagem e vídeo pra um ou vários grupos do WhatsApp — por gestor, cliente ou à mão" />
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:p-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* ---------- Mensagem ---------- */}
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Mensagem</h2>
              <div className="flex gap-2">
                <Btn small onClick={addTexto} disabled={parts.length >= 10 || rodando}>+ Texto</Btn>
                <Btn small onClick={() => fileRef.current?.click()} disabled={parts.length >= 10 || rodando}>+ Imagem / vídeo</Btn>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/*,video/*,audio/*,.pdf"
                  className="hidden"
                  onChange={(e) => anexar(e.target.files)}
                />
              </div>
            </div>
            <ol className="flex flex-col gap-2">
              {parts.map((p, i) => (
                <PartCard
                  key={p.key}
                  p={p}
                  idx={i}
                  total={parts.length}
                  onChange={(text) => updPart(p.key, { text })}
                  onRemove={() => remover(p.key)}
                  onMove={(d) => mover(i, d)}
                />
              ))}
            </ol>
            <p className="mt-2 text-xs text-zinc-500">
              Cada bloco vira uma mensagem, nessa ordem. Imagem e vídeo levam o texto como legenda. <code>{"{cliente}"}</code> vira o nome do
              cliente do grupo. Até 10 blocos, 50 MB por arquivo.
            </p>
          </Card>
          <Card className="p-4">
            <Previa parts={parts} grupo={selecionados[0] ?? null} />
          </Card>
        </div>

        {/* ---------- Grupos ---------- */}
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
              <h2 className="mr-auto text-sm font-semibold">Grupos</h2>
              <Btn small onClick={() => void carregar(true)} disabled={loading || rodando}>{loading ? "Buscando…" : "↻ Atualizar grupos"}</Btn>
            </div>

            {listaGestores.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
                <span className="mr-1 text-xs text-zinc-500">Marcar grupos do gestor:</span>
                {listaGestores.map((nome) => {
                  const ids = (grupos ?? []).filter((g) => gestoresDo(g).includes(nome)).map((g) => g.id);
                  const on = ids.length > 0 && ids.every((id) => sel.has(id));
                  const some = !on && ids.some((id) => sel.has(id));
                  return (
                    <button
                      key={nome}
                      onClick={() => toggleGestor(nome)}
                      disabled={ids.length === 0 || rodando}
                      aria-pressed={on}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                        on
                          ? "border-blue-600 bg-blue-600 text-white"
                          : some
                            ? "border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                            : "border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"
                      }`}
                    >
                      {on ? "✓ " : ""}
                      {nome} · {ids.length}
                      {semGrupo.some((c) => c.responsible === nome) ? (
                        <span className={on ? "" : "text-amber-600 dark:text-amber-400"}> · {semGrupo.filter((c) => c.responsible === nome).length} sem grupo</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <select aria-label="Mostrar" value={filtro} onChange={(e) => setFiltro(e.target.value)} className={inputCls}>
                <option value={SO_CLIENTES}>Grupos de clientes</option>
                {listaGestores.map((g) => (
                  <option key={g} value={g}>Clientes de {g} ({contagem.get(g) ?? 0})</option>
                ))}
                {contagem.get(SEM_GESTOR) ? <option value={SEM_GESTOR}>Clientes sem gestor ({contagem.get(SEM_GESTOR)})</option> : null}
                <option value={SEM_VINCULO}>Grupos sem cliente</option>
                <option value={TODOS}>Todos os grupos</option>
              </select>
              <input
                aria-label="Buscar grupo ou cliente"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar grupo ou cliente…"
                className={`${inputCls} min-w-0 flex-1`}
              />
            </div>

            {loadErr ? <p className="px-4 pb-3 text-sm text-red-600">{loadErr}</p> : null}

            <div className="flex items-center gap-2 border-y border-zinc-200 bg-zinc-50 px-4 py-2 text-xs dark:border-white/10 dark:bg-white/[0.02]">
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={todosVisiveisMarcados} onChange={marcarVisiveis} disabled={visiveis.length === 0 || rodando} />
                Marcar os {visiveis.length} da lista
              </label>
              <span className="ml-auto text-zinc-500">
                <b className="text-zinc-800 dark:text-zinc-200">{sel.size}</b> selecionado{sel.size === 1 ? "" : "s"}
              </span>
              {sel.size > 0 && !rodando ? (
                <button onClick={() => setSel(new Set())} className="font-medium text-blue-600 hover:underline">Limpar</button>
              ) : null}
            </div>

            <ul className="max-h-[480px] divide-y divide-zinc-100 overflow-y-auto dark:divide-white/5">
              {grupos == null && !loadErr ? <li className="px-4 py-6 text-center text-sm text-zinc-500">Buscando os grupos do WhatsApp…</li> : null}
              {grupos != null && visiveis.length === 0 ? <li className="px-4 py-6 text-center text-sm text-zinc-500">Nenhum grupo nesse filtro.</li> : null}
              {visiveis.map((g) => {
                const st = estado[g.id];
                return (
                  <li key={g.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-zinc-50 dark:hover:bg-white/[0.03]">
                      <input type="checkbox" checked={sel.has(g.id)} onChange={() => toggle(g.id)} disabled={rodando} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{g.name}</span>
                        <span className="block truncate text-xs text-zinc-500">
                          {g.clientes.length === 0
                            ? "sem cliente vinculado"
                            : g.clientes.map((c) => `${c.name}${c.responsible ? ` · ${c.responsible}` : ""}`).join(" | ")}
                        </span>
                      </span>
                      {st ? (
                        <span title={st.err}>
                          <Pill tone={st.s === "ok" ? "ok" : st.s === "erro" ? "bad" : st.s === "enviando" ? "info" : "off"}>
                            {st.s === "ok" ? "Enviado" : st.s === "erro" ? "Erro" : st.s === "enviando" ? "Enviando…" : atual?.status === "rodando" || atual?.status === "pausado" ? "Na fila" : "Não enviado"}
                          </Pill>
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </Card>

          {semGrupoVis.length > 0 ? (
            <Card className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
                <h2 className="mr-auto text-sm font-semibold">
                  Contas sem grupo vinculado <span className="text-amber-600 dark:text-amber-400">({semGrupoVis.length})</span>
                </h2>
                {sugeridos.length > 0 ? (
                  <Btn small primary disabled={!!vinculando || rodando} onClick={() => void vincular(sugeridos)}>
                    Vincular {sugeridos.length === semGrupoVis.length ? "todas" : `as ${sugeridos.length}`}
                  </Btn>
                ) : null}
              </div>
              <p className="px-4 pt-2 text-xs text-zinc-500">
                Essas contas não entram no disparo porque não têm grupo. Confira o grupo sugerido pelo nome (ou escolha outro) e vincule — fica
                salvo na ficha do cliente.
              </p>
              <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                {semGrupoVis.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <span className="min-w-[140px] flex-1">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="block text-xs text-zinc-500">{c.responsible ?? "sem gestor"}</span>
                    </span>
                    <GrupoBusca
                      label={`Grupo de ${c.name}`}
                      grupos={grupos ?? []}
                      value={escolha[c.id] ?? c.sugestao?.id ?? ""}
                      sugestao={c.sugestao?.id ?? null}
                      onChange={(id) => setEscolha((m) => ({ ...m, [c.id]: id }))}
                    />
                    <Btn small disabled={!!vinculando || rodando || !(escolha[c.id] ?? c.sugestao?.id)} onClick={() => void vincular([c])}>
                      {vinculando === c.id ? "Salvando…" : "Vincular"}
                    </Btn>
                  </li>
                ))}
              </ul>
              {linkErr ? <p className="px-4 pb-3 text-xs text-red-600">{linkErr}</p> : null}
            </Card>
          ) : null}

          {/* ---------- Envio ---------- */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="disp-int" className="text-xs text-zinc-500">Intervalo entre grupos</label>
              <select id="disp-int" value={intervalo} onChange={(e) => setIntervalo(e.target.value)} disabled={rodando} className={inputCls}>
                {INTERVALOS.map((i) => (
                  <option key={i.id} value={i.id}>{i.label}</option>
                ))}
              </select>
              {selecionados.length > 0 && enviaveis.length > 0 ? (
                <span className="text-xs text-zinc-500">≈ {estimativaMin} min no total</span>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {confirmando ? (
                <>
                  <Btn primary disabled={criando} onClick={() => void disparar(selecionados)}>
                    Confirmar: enviar pra {selecionados.length} grupo{selecionados.length === 1 ? "" : "s"}
                  </Btn>
                  <Btn onClick={() => setConfirmando(false)}>Voltar</Btn>
                </>
              ) : (
                <>
                  <Btn primary disabled={!podeEnviar || semTabela} onClick={() => setConfirmando(true)}>
                    {criando ? "Iniciando…" : `Enviar pra ${selecionados.length} grupo${selecionados.length === 1 ? "" : "s"}`}
                  </Btn>
                  <Btn onClick={novoDisparo}>Limpar mensagem</Btn>
                </>
              )}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              O disparo roda no servidor: pode trocar de tela, abrir outra aba ou fechar o Hub que ele continua sozinho.
            </p>
            {semTabela ? <p className="mt-2 text-xs text-red-600">Rode o SQL supabase/migrations/0045_disparos.sql no Supabase pra liberar os disparos.</p> : null}
            {subindo ? <p className="mt-2 text-xs text-zinc-500">Esperando os arquivos terminarem de subir…</p> : null}
            {comErro ? <p className="mt-2 text-xs text-red-600">Algum arquivo não subiu — remova e anexe de novo.</p> : null}
            {criarErr ? <p className="mt-2 text-xs text-red-600">{criarErr}</p> : null}
          </Card>

          {disparos.length > 0 ? (
            <Card className="flex flex-col">
              <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-white/10">Disparos</h2>
              <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                {disparos.map((d) => {
                  const feito = d.ok + d.erro;
                  const pct = d.total ? Math.round((feito / d.total) * 100) : 0;
                  const on = d.id === acompanhar;
                  return (
                    <li key={d.id} className={`px-4 py-3 ${on ? "bg-blue-50/60 dark:bg-blue-500/5" : ""}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => { setAcompanhar(d.id); void carregarDisparos(d.id); }} className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-sm font-medium">{d.resumo || "(sem texto)"}</span>
                          <span className="block text-xs text-zinc-500">
                            {new Date(d.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} ·{" "}
                            {d.ok} enviado{d.ok === 1 ? "" : "s"}
                            {d.erro ? ` · ${d.erro} com erro` : ""} de {d.total}
                            {on ? " · mostrando na lista de grupos" : " · clique pra ver nos grupos"}
                          </span>
                        </button>
                        <Pill tone={d.status === "concluido" ? "ok" : d.status === "rodando" ? "info" : d.status === "pausado" ? "warn" : "off"}>
                          {STATUS_LABEL[d.status]}
                        </Pill>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
                        <div className={`h-full ${d.erro ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {d.status === "rodando" ? <Btn small onClick={() => void controlar(d.id, "pausar")}>⏸ Pausar</Btn> : null}
                        {d.status === "pausado" || d.status === "parado" ? (
                          feito < d.total ? <Btn small onClick={() => void controlar(d.id, "continuar")}>▶ Continuar</Btn> : null
                        ) : null}
                        {d.status === "rodando" || d.status === "pausado" ? <Btn small onClick={() => void controlar(d.id, "parar")}>■ Parar</Btn> : null}
                        {d.erro > 0 && d.status !== "rodando" ? <Btn small onClick={() => void controlar(d.id, "reenviar")}>Reenviar as {d.erro} falhas</Btn> : null}
                      </div>
                      {d.last_error ? <p className="mt-1 text-xs text-red-600">{d.last_error}</p> : null}
                      {on && falhasItens.length > 0 ? (
                        <ul className="mt-2 flex flex-col gap-1 text-xs text-red-600">
                          {falhasItens.slice(0, 8).map((i) => (
                            <li key={i.group_id} className="truncate">
                              {i.group_name}: {i.error}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
