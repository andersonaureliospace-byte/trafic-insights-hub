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
export interface Fatia {
  label: string;
  leads: number | null;
  spend: number | null;
}
const cpaFatia = (f: Fatia) => (f.spend == null || f.spend <= 0 ? null : !f.leads ? Infinity : f.spend / f.leads);
const fmtCpaF = (v: number | null) => (v == null ? "sem gasto" : v === Infinity ? "sem lead" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const pct = (a: number | null, b: number | null) => (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0 ? null : ((a - b) / b) * 100);
const fmtPct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(0)}%`);
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

export function NovoFeedbackPrint({
  onClose,
  onCreated,
  clienteId,
  enviarAqui = false,
  comparacao,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  clienteId?: string; // Etapa 291: já abre com o cliente escolhido (atalho do Acompanhamento)
  enviarAqui?: boolean; // revisa e envia aqui mesmo, sem ir pra aba Feedbacks
  // Etapa 294: leads e CPA do período escolhido no quadro × a mesma fatia logo antes (vem do Acompanhamento)
  comparacao?: { atual: Fatia; anterior: Fatia };
}) {
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
      .then((l) => {
        const list = l.filter((c) => c.selected && !c.archived).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
        setClientes(list);
        const pre = clienteId ? list.find((c) => c.id === clienteId.replace(/^act_/, "")) : undefined;
        if (pre) {
          setCliente(pre);
          setAbrirCli(false);
        }
      })
      .catch(() => {});
    fetch("/api/estrategia/prefs?key=feedback_modelos", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const v = typeof d.value === "string" ? d.value : "";
        setModelos(v);
        setModelosOrig(v);
      })
      .catch(() => {});
  }, [clienteId]);

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

  // ---- Etapa 291: revisar e enviar aqui mesmo ----
  const [rev, setRev] = useState<{ id: string; resumo: string; prints: string[]; grupo: string | null; aiErro: string | null } | null>(null);
  const hojeSP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const mais = (n: number) => {
    const [y, m, d] = hojeSP.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  const [proximo, setProximo] = useState(mais(7));
  const [programar, setProgramar] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState<string | null>(null);

  async function abrirRevisao(id: string) {
    const d = (await fetch("/api/feedbacks", { cache: "no-store" }).then((r) => r.json())) as {
      feedbacks?: Array<{ id: string; resumo: string | null; print_urls?: string[]; wa_group_name: string | null; wa_group_id: string | null; ai_error: string | null }>;
    };
    const f = d.feedbacks?.find((x) => x.id === id);
    if (!f) {
      onCreated(id);
      return;
    }
    setRev({ id, resumo: f.resumo ?? "", prints: f.print_urls ?? [], grupo: f.wa_group_name ?? f.wa_group_id, aiErro: f.ai_error });
  }

  async function enviar() {
    if (!rev) return;
    setEnviando(true);
    setErro(null);
    try {
      const r1 = await fetch("/api/feedbacks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: rev.id, resumo: rev.resumo }) }).then((x) => x.json());
      if (r1.error) throw new Error(r1.error);
      const r2 = await post<{ tarefa?: { concluidas: number; proximo: string | null } | null }>("/api/feedbacks/enviar", { id: rev.id, proximo: programar ? proximo : null });
      const t = r2.tarefa;
      setEnviado(
        `Enviado pro grupo ✓${t?.concluidas ? " · tarefa de feedback concluída" : ""}${t?.proximo ? ` · próximo em ${t.proximo.split("-").reverse().slice(0, 2).join("/")}` : ""}`,
      );
      window.dispatchEvent(new Event("feedbacks:changed"));
    } catch (e) {
      setErro((e as Error).message);
    }
    setEnviando(false);
  }

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
      if (enviarAqui) await abrirRevisao(r.id);
      else onCreated(r.id);
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

  if (rev) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Revisar e enviar feedback">
        <div className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#121722]">
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-white/10">
            <h2 className="truncate text-base font-semibold">📸 Feedback · {cliente?.name}</h2>
            <button onClick={onClose} disabled={enviando} aria-label="Fechar" className="rounded px-2 text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">×</button>
          </div>
          <div className="flex flex-col gap-3 overflow-y-auto p-5">
            <div className="rounded-lg bg-[#efeae2] p-3 dark:bg-[#0b141a]">
              <p className="mb-2 text-center text-[11px] text-zinc-500">{rev.grupo ? `Vai pro grupo “${rev.grupo}”` : "Sem grupo de WhatsApp vinculado a esse cliente"}</p>
              {rev.prints.map((u, i) => (
                <div key={u} className="ml-auto mb-1.5 w-[85%] rounded-lg rounded-tr-none bg-[#d9fdd3] p-1.5 shadow-sm dark:bg-[#005c4b]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- prévia do print */}
                  <img src={u} alt="" className="w-full rounded-md" />
                  {i === rev.prints.length - 1 && rev.resumo.trim() ? (
                    <p className="px-1.5 pt-1.5 text-sm whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">{rev.resumo.trim()}</p>
                  ) : null}
                </div>
              ))}
            </div>
            {rev.aiErro ? <p className="text-xs text-amber-600">A IA não conseguiu escrever ({rev.aiErro}). Escreva o texto abaixo.</p> : null}
            <label className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase" htmlFor="fp-rev">Texto (vai de legenda no print)</label>
            <textarea
              id="fp-rev"
              value={rev.resumo}
              onChange={(e) => setRev({ ...rev, resumo: e.target.value })}
              rows={6}
              disabled={!!enviado}
              className={`${inputCls} py-2`}
            />
            <label className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" checked={programar} onChange={(e) => setProgramar(e.target.checked)} disabled={!!enviado} />
              Próximo feedback em
              <input
                type="date"
                value={proximo}
                onChange={(e) => setProximo(e.target.value)}
                disabled={!programar || !!enviado}
                aria-label="Data do próximo feedback"
                className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-xs disabled:opacity-50 dark:border-white/10 dark:bg-[#141924]"
              />
              {[7, 15, 30].map((n) => (
                <button key={n} type="button" disabled={!programar || !!enviado} onClick={() => setProximo(mais(n))} className="rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5">
                  +{n}d
                </button>
              ))}
            </label>
            <p className="text-[11px] text-zinc-500">Ao enviar, a tarefa de feedback de hoje desse cliente (Demandas) já fica concluída.</p>
            {erro ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{erro}</div> : null}
            {enviado ? <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{enviado}</div> : null}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-zinc-200 p-3 dark:border-white/10">
            {enviado ? (
              <Btn primary onClick={onClose}>Fechar</Btn>
            ) : (
              <>
                <Btn onClick={() => onCreated(rev.id)} disabled={enviando}>Revisar depois (Feedbacks)</Btn>
                <Btn primary onClick={() => void enviar()} disabled={enviando || !rev.grupo}>{enviando ? "Enviando…" : "📤 Enviar pro grupo"}</Btn>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

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
                {comparacao ? (
                  (() => {
                    const { atual, anterior } = comparacao;
                    const cA = cpaFatia(atual);
                    const cB = cpaFatia(anterior);
                    const dL = pct(atual.leads, anterior.leads);
                    const dC = pct(cA, cB);
                    const fmtN = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("pt-BR").format(Math.round(v)));
                    return (
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-white/10">
                          <div className="truncate text-[11px] text-zinc-500">Leads · {atual.label}</div>
                          <div className="text-base font-semibold tabular-nums">{fmtN(atual.leads)}</div>
                          <div className="text-[11px] text-zinc-500 tabular-nums">CPA {fmtCpaF(cA)}</div>
                        </div>
                        <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-white/10">
                          <div className="truncate text-[11px] text-zinc-500">Leads · {anterior.label}</div>
                          <div className="text-base font-semibold tabular-nums">{fmtN(anterior.leads)}</div>
                          <div className="text-[11px] text-zinc-500 tabular-nums">CPA {fmtCpaF(cB)}</div>
                        </div>
                        <div className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-white/10">
                          <div className="text-[11px] text-zinc-500">Comparação</div>
                          <div className={`text-base font-semibold tabular-nums ${dL == null ? "" : dL >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                            {fmtPct(dL)} <span className="text-[11px] font-normal text-zinc-500">leads</span>
                          </div>
                          <div className={`text-[11px] tabular-nums ${dC == null ? "text-zinc-500" : dC <= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                            {fmtPct(dC)} CPA
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : null}
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
