"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Btn } from "@/components/estrategia/ui";
import { loadClientes, type Cliente } from "@/components/estrategia/use-carteira";

// Etapa 271: Feedback por print — escolhe o cliente, cola/arrasta o(s) print(s) do resultado, escreve ou fala os pontos
// de atenção e a IA escreve o feedback no seu jeito. Depois você revisa na lista e envia (o texto vai de legenda no print).

interface Anexo {
  key: string;
  file: File;
  preview: string;
  path: string | null;
  mime: string;
  progress: number;
  error: string | null;
}

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]";
const flat = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const keyOf = () => Math.random().toString(36).slice(2, 10);
const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

function put(url: string, file: Blob, mime: string, apikey: string | null, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", mime || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "true");
    if (apikey) xhr.setRequestHeader("apikey", apikey);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Erro ${xhr.status} ao subir o arquivo.`)));
    xhr.onerror = () => reject(new Error("A conexão caiu no envio do arquivo."));
    xhr.send(file);
  });
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: url.includes("prefs") ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const txt = await r.text();
  let d: { error?: string } & Record<string, unknown>;
  try {
    d = JSON.parse(txt);
  } catch {
    throw new Error(r.status === 504 ? "A IA demorou demais. Tente de novo." : `O servidor respondeu um erro (${r.status}).`);
  }
  if (d.error) throw new Error(d.error);
  return d as T;
}

async function subir(file: Blob, kind: "print" | "audio", name: string, mime: string, onProgress: (p: number) => void) {
  const up = await post<{ upload_url: string; apikey: string | null; path: string }>("/api/feedbacks/print", {
    action: "upload",
    kind,
    mime,
    bytes: file.size,
    name,
  });
  await put(up.upload_url, file, mime, up.apikey, onProgress);
  return up.path;
}

export function NovoFeedbackPrint({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [cq, setCq] = useState("");
  const [abrirCli, setAbrirCli] = useState(true);
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [pontos, setPontos] = useState("");
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // áudio dos pontos de atenção
  const [gravando, setGravando] = useState(false);
  const [seg, setSeg] = useState(0);
  const [audio, setAudio] = useState<{ blob: Blob; url: string; mime: string; path: string | null; error: string | null } | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);

  // meu jeito de escrever
  const [modelos, setModelos] = useState("");
  const [modelosOrig, setModelosOrig] = useState("");
  const [salvandoModelos, setSalvandoModelos] = useState(false);

  useEffect(() => {
    loadClientes()
      .then((l) => setClientes(l.filter((c) => c.selected && !c.archived).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))))
      .catch(() => {});
    fetch("/api/estrategia/prefs?key=feedback_modelos", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const v = typeof d.value === "string" ? d.value : "";
        setModelos(v);
        setModelosOrig(v);
      })
      .catch(() => {});
  }, []);

  const lista = useMemo(() => {
    const t = flat(cq).split(/\s+/).filter(Boolean);
    return clientes.filter((c) => t.every((x) => flat(`${c.name} ${c.responsible ?? ""}`).includes(x))).slice(0, 60);
  }, [clientes, cq]);

  const upd = (key: string, patch: Partial<Anexo>) => setAnexos((xs) => xs.map((a) => (a.key === key ? { ...a, ...patch } : a)));

  const anexar = useCallback((files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    const novos = imgs.map((file) => ({ key: keyOf(), file, preview: URL.createObjectURL(file), path: null, mime: file.type || "image/png", progress: 0, error: null }));
    setAnexos((xs) => [...xs, ...novos].slice(0, 8));
    for (const a of novos) {
      subir(a.file, "print", a.file.name || "print.png", a.mime, (p) => upd(a.key, { progress: p }))
        .then((path) => upd(a.key, { path, progress: 100 }))
        .catch((e) => upd(a.key, { error: (e as Error).message }));
    }
  }, []);

  // Ctrl+V com o print copiado
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.some((f) => f.type.startsWith("image/"))) {
        e.preventDefault();
        anexar(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [anexar]);

  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => setSeg((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [gravando]);

  async function gravar() {
    setErro(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = (rec.mimeType || "audio/webm").split(";")[0];
        const blob = new Blob(chunks, { type });
        const url = URL.createObjectURL(blob);
        setAudio({ blob, url, mime: type, path: null, error: null });
        subir(blob, "audio", type.includes("mp4") ? "pontos.m4a" : "pontos.webm", type, () => {})
          .then((path) => setAudio((a) => (a && a.url === url ? { ...a, path } : a)))
          .catch((e) => setAudio((a) => (a && a.url === url ? { ...a, error: (e as Error).message } : a)));
      };
      recRef.current = rec;
      rec.start();
      setSeg(0);
      setGravando(true);
    } catch {
      setErro("Não consegui acessar o microfone. Libere o microfone pro Hub no navegador.");
    }
  }
  function parar() {
    recRef.current?.stop();
    setGravando(false);
  }

  const subindo = anexos.some((a) => !a.path && !a.error) || (!!audio && !audio.path && !audio.error);
  const prontos = anexos.filter((a) => a.path);
  const pode = !!cliente && prontos.length > 0 && !subindo && !gravando && !gerando;

  async function gerar() {
    if (!cliente) return;
    setGerando(true);
    setErro(null);
    try {
      const r = await post<{ id: string }>("/api/feedbacks/print", {
        action: "criar",
        ad_account_id: cliente.id,
        prints: prontos.map((a) => ({ path: a.path, mime: a.mime })),
        pontos,
        audio: audio?.path ? { path: audio.path, mime: audio.mime } : null,
      });
      anexos.forEach((a) => URL.revokeObjectURL(a.preview));
      onCreated(r.id);
    } catch (e) {
      setErro((e as Error).message);
    }
    setGerando(false);
  }

  async function salvarModelos() {
    setSalvandoModelos(true);
    try {
      await post("/api/estrategia/prefs", { key: "feedback_modelos", value: modelos });
      setModelosOrig(modelos);
    } catch (e) {
      setErro((e as Error).message);
    }
    setSalvandoModelos(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !gerando && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gerando, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Feedback por print">
      <div className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#121722]">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-white/10">
          <h2 className="text-base font-semibold">📸 Feedback por print</h2>
          <button onClick={onClose} disabled={gerando} aria-label="Fechar" className="rounded px-2 text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">×</button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          {/* cliente */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">1. Cliente</span>
            {cliente && !abrirCli ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm font-semibold">{cliente.name}</span>
                  <span className="text-xs text-zinc-500">{cliente.responsible ?? ""}</span>
                  <Btn small onClick={() => setAbrirCli(true)}>Trocar</Btn>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-zinc-100 px-3 py-2 dark:bg-white/5">
                    <div className="text-[11px] text-zinc-500">Meta de CPA</div>
                    <div className="text-base font-semibold tabular-nums">{cliente.cpaTarget != null ? brl(cliente.cpaTarget) : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-zinc-100 px-3 py-2 dark:bg-white/5">
                    <div className="text-[11px] text-zinc-500">Investimento mensal</div>
                    <div className="text-base font-semibold tabular-nums">{cliente.monthly != null ? brl(cliente.monthly) : "—"}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-200 p-2 dark:border-white/10">
                <input autoFocus value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Pesquisar cliente…" aria-label="Pesquisar cliente" className={`${inputCls} mb-2 h-8`} />
                <div className="max-h-40 overflow-y-auto">
                  {lista.length === 0 ? <p className="px-1 py-2 text-xs text-zinc-500">{clientes.length ? "Nenhum cliente com esse nome." : "Carregando…"}</p> : null}
                  {lista.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setCliente(c);
                        setAbrirCli(false);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-white/5"
                    >
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-xs text-zinc-500">{c.responsible ?? ""}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* prints */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">2. Print do resultado</span>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                anexar([...e.dataTransfer.files]);
              }}
              className="rounded-lg border-2 border-dashed border-zinc-300 p-3 dark:border-white/15"
            >
              {anexos.length > 0 ? (
                <div className="mb-2 grid grid-cols-3 gap-2">
                  {anexos.map((a) => (
                    <div key={a.key} className="relative overflow-hidden rounded-md bg-zinc-100 dark:bg-white/5">
                      {/* eslint-disable-next-line @next/next/no-img-element -- prévia local */}
                      <img src={a.preview} alt="" className="h-24 w-full object-cover" />
                      {!a.path ? (
                        <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] text-white">{a.error ? "erro" : `subindo ${a.progress}%`}</span>
                      ) : null}
                      <button
                        onClick={() => {
                          URL.revokeObjectURL(a.preview);
                          setAnexos((xs) => xs.filter((x) => x.key !== a.key));
                        }}
                        aria-label="Remover print"
                        className="absolute top-1 right-1 rounded-full bg-black/60 px-1.5 text-xs text-white"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="text-center text-sm text-zinc-500">
                Cole com <b>Ctrl+V</b>, arraste aqui ou{" "}
                <button onClick={() => fileRef.current?.click()} className="font-medium text-blue-600 hover:underline dark:text-blue-400">escolha o arquivo</button>
              </p>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { anexar([...(e.target.files ?? [])]); e.target.value = ""; }} />
            </div>
          </div>

          {/* pontos */}
          <div className="flex flex-col gap-1">
            <label htmlFor="fp-pontos" className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">3. Pontos de atenção (escreva e/ou fale)</label>
            <textarea
              id="fp-pontos"
              value={pontos}
              onChange={(e) => setPontos(e.target.value)}
              rows={4}
              placeholder="Ex.: exame foi bem; custo ainda alto; subimos vídeos novos ontem; se não melhorar, entra a promoção de presentes."
              className={`${inputCls} py-2`}
            />
            <div className="flex flex-wrap items-center gap-2">
              {gravando ? (
                <Btn small onClick={parar}>
                  <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" /> Parar ({Math.floor(seg / 60)}:{String(seg % 60).padStart(2, "0")})
                </Btn>
              ) : (
                <Btn small onClick={() => void gravar()}>🎙 {audio ? "Gravar de novo" : "Falar os pontos"}</Btn>
              )}
              {audio && !gravando ? (
                <>
                  <audio src={audio.url} controls className="h-8 max-w-[240px]" />
                  <button onClick={() => setAudio(null)} className="text-xs text-red-600 hover:underline">remover</button>
                  {audio.error ? <span className="text-xs text-red-600">{audio.error}</span> : !audio.path ? <span className="text-xs text-zinc-500">subindo…</span> : null}
                </>
              ) : null}
            </div>
          </div>

          <details className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-white/10">
            <summary className="cursor-pointer text-xs font-semibold text-zinc-500">Meu jeito de escrever (exemplos pra IA copiar o tom)</summary>
            <p className="mt-2 text-xs text-zinc-500">
              A IA já escreve curto e direto como nos seus feedbacks. Cole aqui mais feedbacks que você mandou (um embaixo do outro) pra ela pegar ainda mais o seu jeito.
            </p>
            <textarea value={modelos} onChange={(e) => setModelos(e.target.value)} rows={6} className={`${inputCls} mt-2 py-2 text-xs`} placeholder="Bom dia turma.&#10;&#10;Nessa semana, tivemos 40 leads a um custo de R$ 7,80…" />
            {modelos !== modelosOrig ? (
              <div className="mt-2 text-right">
                <Btn small onClick={() => void salvarModelos()} disabled={salvandoModelos}>{salvandoModelos ? "Salvando…" : "Salvar exemplos"}</Btn>
              </div>
            ) : null}
          </details>

          {erro ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{erro}</div> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 p-3 dark:border-white/10">
          <span className="mr-auto text-xs text-zinc-500">{subindo ? "Subindo arquivos…" : gerando ? "A IA está escrevendo… (uns segundos)" : ""}</span>
          <Btn onClick={onClose} disabled={gerando}>Cancelar</Btn>
          <Btn primary onClick={() => void gerar()} disabled={!pode}>{gerando ? "Gerando…" : "✨ Gerar feedback com IA"}</Btn>
        </div>
      </div>
    </div>
  );
}
