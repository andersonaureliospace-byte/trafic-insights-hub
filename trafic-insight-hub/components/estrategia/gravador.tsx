"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadClientes, type Cliente } from "@/components/estrategia/use-carteira";
import { Btn } from "@/components/estrategia/ui";

// Etapa 251: Gravador de Tela dentro do Hub (botão "● Gravar" no topo). Mesma gravação da extensão do Chrome: tela +
// áudio do computador + microfone, qualidade travada a 30 fps. Ao parar, sobe o vídeo direto pro Storage e cai em
// Clientes → Feedbacks com o plano de ação da IA, aguardando revisão. Fica na casca do Hub estratégico, então dá pra
// navegar entre Tráfego/Clientes/POP gravando — só não sair pro hub operacional nem fechar/recarregar a aba.

const QUALIDADES = {
  zap: { label: "WhatsApp", w: 1280, h: 720, videoBps: 650_000, hint: "~5 MB/min" },
  "720": { label: "720p", w: 1280, h: 720, videoBps: 1_200_000, hint: "~9 MB/min" },
  "1080": { label: "1080p", w: 1920, h: 1080, videoBps: 2_000_000, hint: "~15 MB/min" },
} as const;
type Qualidade = keyof typeof QUALIDADES;
const FPS = 30;
const LIMITE = 50 * 1024 * 1024;
const AVISO = 45 * 1024 * 1024;

const VIDEO_TYPES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4;codecs=avc1.42E01F,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
const AUDIO_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
const pickType = (list: string[]) => list.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";

const PREFS_KEY = "gravador_prefs";
interface Prefs {
  qualidade: Qualidade;
  mic: boolean;
  salvarLocal: boolean;
  cliente: string;
}
const DEFAULT_PREFS: Prefs = { qualidade: "zap", mic: true, salvarLocal: false, cliente: "" };

const fmtTempo = (s: number) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
};
const fmtMB = (b: number) => `${(b / 1048576).toFixed(1).replace(".", ",")} MB`;
const flat = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Fase = "idle" | "setup" | "gravando" | "pausado" | "enviando" | "pronto" | "erro";

interface Resultado {
  video: Blob;
  audio: Blob | null;
  duracao: number;
  titulo: string;
  cliente: Cliente;
}

interface Ctx {
  fase: Fase;
  abrir: () => void;
}
const GravCtx = createContext<Ctx>({ fase: "idle", abrir: () => {} });
export const useGravador = () => useContext(GravCtx);

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const d = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
  return d as T;
}

function putArquivo(url: string, blob: Blob, apikey: string | null, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", blob.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    if (apikey) xhr.setRequestHeader("apikey", apikey);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Erro ${xhr.status} ao subir o vídeo: ${xhr.responseText.slice(0, 200)}`)));
    xhr.onerror = () => reject(new Error("A conexão caiu no meio do envio."));
    xhr.send(blob);
  });
}

function baixar(r: Resultado) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(r.video);
  const data = new Date().toLocaleDateString("pt-BR").replace(/\//g, "-");
  a.download = `${r.cliente.name} - ${r.titulo || "Gravação"} - ${data}.${r.video.type.includes("mp4") ? "mp4" : "webm"}`.replace(/[\\/:*?"<>|]+/g, "");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

export function GravadorProvider({ children }: { children: ReactNode }) {
  const [fase, setFase] = useState<Fase>("idle");
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [titulo, setTitulo] = useState("");
  const [q, setQ] = useState("");
  const [setupMsg, setSetupMsg] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [semAudio, setSemAudio] = useState(false);
  const [gravandoPara, setGravandoPara] = useState("");
  const [progresso, setProgresso] = useState(0);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [final, setFinal] = useState<{ grupo: string | null; erro: string | null }>({ grupo: null, erro: null });

  const rec = useRef<{
    streams: MediaStream[];
    ctx: AudioContext | null;
    video: MediaRecorder | null;
    audio: MediaRecorder | null;
    vChunks: Blob[];
    aChunks: Blob[];
    startedAt: number;
    pausedTotal: number;
    pausedAt: number;
    timer: ReturnType<typeof setInterval> | null;
    cliente: Cliente | null;
    titulo: string;
    parando: boolean;
  }>({ streams: [], ctx: null, video: null, audio: null, vChunks: [], aChunks: [], startedAt: 0, pausedTotal: 0, pausedAt: 0, timer: null, cliente: null, titulo: "", parando: false });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferências guardadas neste navegador
      if (raw) setPrefsState({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) });
    } catch {
      /* sem armazenamento: usa o padrão */
    }
  }, []);

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* só nesta sessão */
      }
      return next;
    });
  }, []);

  // Avisa antes de fechar/recarregar a aba no meio da gravação ou do envio.
  useEffect(() => {
    if (fase !== "gravando" && fase !== "pausado" && fase !== "enviando") return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [fase]);

  const abrir = useCallback(() => {
    if (fase === "gravando" || fase === "pausado" || fase === "enviando") return;
    setSetupMsg(null);
    setFase("setup");
    if (!clientes) {
      loadClientes()
        .then((list) => setClientes(list.filter((c) => !c.archived)))
        .catch((e: Error) => setSetupMsg(e.message));
    }
  }, [fase, clientes]);

  const lista = useMemo(() => {
    const t = flat(q);
    return (clientes ?? []).filter((c) => !t || flat(c.name).includes(t));
  }, [clientes, q]);
  const clienteSel = useMemo(() => (clientes ?? []).find((c) => c.id === prefs.cliente) ?? null, [clientes, prefs.cliente]);

  const tick = useCallback(() => {
    const r = rec.current;
    const agora = r.pausedAt || Date.now();
    setSegundos((agora - r.startedAt - r.pausedTotal) / 1000);
    setBytes(r.vChunks.reduce((t, c) => t + c.size, 0));
  }, []);

  const enviar = useCallback(async (res: Resultado) => {
    setFase("enviando");
    setProgresso(0);
    setFinal({ grupo: null, erro: null });
    try {
      if (res.video.size > LIMITE) {
        throw new Error(`O vídeo ficou com ${fmtMB(res.video.size)} e o limite é 50 MB. Baixe a cópia e grave em partes menores ou na qualidade "WhatsApp".`);
      }
      const ini = await postJson<{ id: string; grupo: string | null; video_upload_url: string; audio_upload_url: string | null; apikey: string | null }>(
        "/api/feedbacks/iniciar",
        {
          ad_account_id: res.cliente.rawId,
          titulo: res.titulo,
          duracao_seg: Math.round(res.duracao),
          video_mime: res.video.type,
          video_bytes: res.video.size,
          audio_mime: res.audio?.type ?? null,
        },
      );
      const total = res.video.size + (res.audio?.size ?? 0);
      let feito = 0;
      const prog = (loaded: number) => setProgresso(Math.min(99, Math.round(((feito + loaded) / total) * 100)));
      if (res.audio && ini.audio_upload_url) {
        await putArquivo(ini.audio_upload_url, res.audio, ini.apikey, prog);
        feito += res.audio.size;
      }
      await putArquivo(ini.video_upload_url, res.video, ini.apikey, prog);
      await postJson("/api/feedbacks/concluir", { id: ini.id });
      setProgresso(100);
      setFinal({ grupo: ini.grupo, erro: null });
      setFase("pronto");
      window.dispatchEvent(new Event("feedbacks:changed"));
    } catch (e) {
      setFinal({ grupo: null, erro: (e as Error).message });
      setFase("erro");
    }
  }, []);

  const parar = useCallback(async () => {
    const r = rec.current;
    if (r.parando || !r.video) return;
    r.parando = true;
    const agora = r.pausedAt || Date.now();
    const duracao = (agora - r.startedAt - r.pausedTotal) / 1000;
    if (r.timer) clearInterval(r.timer);
    const stop = (m: MediaRecorder | null) =>
      new Promise<void>((resolve) => {
        if (!m || m.state === "inactive") return resolve();
        m.addEventListener("stop", () => resolve(), { once: true });
        m.stop();
      });
    await Promise.all([stop(r.video), stop(r.audio)]);
    r.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    void r.ctx?.close();
    const video = new Blob(r.vChunks, { type: (r.video.mimeType || "video/webm").split(";")[0] });
    const audio = r.audio ? new Blob(r.aChunks, { type: (r.audio.mimeType || "audio/webm").split(";")[0] }) : null;
    const res: Resultado = { video, audio, duracao, titulo: r.titulo, cliente: r.cliente as Cliente };
    r.video = null;
    r.audio = null;
    r.parando = false;
    document.title = document.title.replace(/^[●❚]+\s*/, "");
    setResultado(res);
    if (prefs.salvarLocal) baixar(res);
    void enviar(res);
  }, [enviar, prefs.salvarLocal]);

  const iniciar = useCallback(async () => {
    setSetupMsg(null);
    if (!clienteSel) return setSetupMsg("Escolha o cliente.");
    const qd = QUALIDADES[prefs.qualidade];
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: qd.w }, height: { max: qd.h }, frameRate: { ideal: FPS, max: FPS } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        // Chrome: deixa gravar a própria aba do Hub e captura o som do computador
        ...({ systemAudio: "include", selfBrowserSurface: "include", surfaceSwitching: "include" } as object),
      } as DisplayMediaStreamOptions);
    } catch {
      return setSetupMsg("Gravação cancelada (nenhuma tela escolhida).");
    }
    const r = rec.current;
    r.streams = [display];
    let mic: MediaStream | null = null;
    if (prefs.mic) {
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        r.streams.push(mic);
      } catch {
        setSetupMsg("Não consegui acessar o microfone — gravando sem ele. Libere no cadeado da barra de endereço.");
      }
    }

    // Mistura o som do computador + microfone numa trilha só.
    const ctx = new AudioContext();
    r.ctx = ctx;
    const dest = ctx.createMediaStreamDestination();
    let temAudio = false;
    if (display.getAudioTracks().length) {
      ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
      temAudio = true;
    }
    if (mic?.getAudioTracks().length) {
      ctx.createMediaStreamSource(mic).connect(dest);
      temAudio = true;
    }
    const track = display.getVideoTracks()[0];
    const mixed = new MediaStream([track, ...(temAudio ? dest.stream.getAudioTracks() : [])]);

    r.vChunks = [];
    r.aChunks = [];
    const vType = pickType(VIDEO_TYPES);
    r.video = new MediaRecorder(mixed, { mimeType: vType || undefined, videoBitsPerSecond: qd.videoBps, audioBitsPerSecond: 96_000 });
    r.video.ondataavailable = (e) => e.data.size && r.vChunks.push(e.data);
    r.audio = null;
    if (temAudio) {
      // áudio separado e pequeno, só pra transcrição (bem mais rápido pra IA que o vídeo)
      const aType = pickType(AUDIO_TYPES);
      r.audio = new MediaRecorder(dest.stream, { mimeType: aType || undefined, audioBitsPerSecond: 48_000 });
      r.audio.ondataavailable = (e) => e.data.size && r.aChunks.push(e.data);
    }
    track.addEventListener("ended", () => void parar()); // "Parar de compartilhar" do Chrome

    r.cliente = clienteSel;
    r.titulo = titulo.trim();
    r.startedAt = Date.now();
    r.pausedTotal = 0;
    r.pausedAt = 0;
    r.video.start(1000);
    r.audio?.start(1000);
    r.timer = setInterval(tick, 500);
    setSemAudio(!temAudio);
    setGravandoPara(clienteSel.name);
    setSegundos(0);
    setBytes(0);
    setResultado(null);
    setFase("gravando");
    document.title = `● ${document.title}`;
  }, [clienteSel, prefs.mic, prefs.qualidade, titulo, tick, parar]);

  const pausar = useCallback(() => {
    const r = rec.current;
    if (!r.video) return;
    if (r.video.state === "recording") {
      r.video.pause();
      r.audio?.pause();
      r.pausedAt = Date.now();
      setFase("pausado");
    } else if (r.video.state === "paused") {
      r.video.resume();
      r.audio?.resume();
      r.pausedTotal += Date.now() - r.pausedAt;
      r.pausedAt = 0;
      setFase("gravando");
    }
    tick();
  }, [tick]);

  const fechar = useCallback(() => {
    setFase("idle");
    setTitulo("");
    setResultado(null);
  }, []);

  const value = useMemo(() => ({ fase, abrir }), [fase, abrir]);

  return (
    <GravCtx.Provider value={value}>
      {children}

      {/* Configurar a gravação */}
      {fase === "setup" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Nova gravação">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-[#121722]">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <span className="h-3 w-3 rounded-full bg-red-500" /> Nova gravação
              </h2>
              <button onClick={fechar} aria-label="Fechar" className="h-8 w-8 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">✕</button>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="grav-busca" className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Cliente</label>
              <input
                id="grav-busca"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar cliente…"
                className="h-9 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]"
              />
              <div className="max-h-44 overflow-y-auto rounded-lg border border-zinc-200 dark:border-white/10">
                {clientes == null ? (
                  <p className="px-3 py-2 text-sm text-zinc-500">Carregando clientes…</p>
                ) : lista.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-zinc-500">Nenhum cliente encontrado.</p>
                ) : (
                  lista.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setPrefs({ cliente: c.id })}
                      className={`block w-full truncate px-3 py-1.5 text-left text-sm ${
                        prefs.cliente === c.id ? "bg-blue-600 text-white" : "hover:bg-zinc-100 dark:hover:bg-white/5"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="grav-titulo" className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Título</label>
              <input
                id="grav-titulo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex.: Análise da semana"
                className="h-9 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Qualidade</span>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(QUALIDADES) as Qualidade[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setPrefs({ qualidade: k })}
                    className={`rounded-lg border px-2 py-2 text-sm ${
                      prefs.qualidade === k
                        ? "border-blue-600 bg-blue-600/10 font-semibold text-blue-700 dark:text-blue-300"
                        : "border-zinc-300 hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-white/5"
                    }`}
                  >
                    {QUALIDADES[k].label}
                    <span className="block text-[11px] font-normal text-zinc-500">{QUALIDADES[k].hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={prefs.mic} onChange={(e) => setPrefs({ mic: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                Gravar meu microfone
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={prefs.salvarLocal} onChange={(e) => setPrefs({ salvarLocal: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                Salvar cópia no PC
              </label>
            </div>

            <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-white/5 dark:text-zinc-400">
              Na próxima janela, escolha <b>Tela inteira</b> (ou uma aba) e deixe marcado <b>“Compartilhar áudio do sistema”</b>.
              Durante a gravação dá pra navegar entre as telas do Hub — só não feche nem recarregue esta aba.
            </p>
            {setupMsg ? <p className="text-sm text-amber-600 dark:text-amber-400">{setupMsg}</p> : null}
            <div className="flex justify-end gap-2">
              <Btn onClick={fechar}>Cancelar</Btn>
              <button
                onClick={() => void iniciar()}
                disabled={!clienteSel}
                className="h-9 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                ● Iniciar gravação{clienteSel ? ` — ${clienteSel.name}` : ""}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Barrinha flutuante: gravando / enviando / pronto */}
      {fase === "gravando" || fase === "pausado" || fase === "enviando" || fase === "pronto" || fase === "erro" ? (
        <div className="fixed right-4 bottom-4 z-50 w-[min(92vw,22rem)] rounded-2xl border border-zinc-200 bg-white p-3 shadow-2xl dark:border-white/10 dark:bg-[#121722]">
          {fase === "gravando" || fase === "pausado" ? (
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 shrink-0 rounded-full ${fase === "gravando" ? "animate-pulse bg-red-500" : "bg-amber-400"}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xl font-semibold tabular-nums">{fmtTempo(segundos)}</div>
                <div className={`truncate text-[11px] ${bytes > AVISO ? "font-semibold text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
                  {fase === "pausado" ? "Pausado · " : ""}
                  {gravandoPara} · {fmtMB(bytes)}
                  {bytes > AVISO ? " — perto do limite de 50 MB!" : ""}
                  {semAudio ? " · sem áudio" : ""}
                </div>
              </div>
              <Btn small onClick={pausar}>{fase === "pausado" ? "▶ Continuar" : "❚❚ Pausar"}</Btn>
              <button onClick={() => void parar()} className="h-7 rounded-lg bg-red-600 px-2.5 text-xs font-semibold text-white hover:bg-red-700">■ Parar</button>
            </div>
          ) : fase === "enviando" ? (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium">Enviando pro Hub… {progresso}%</div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
                <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${progresso}%` }} />
              </div>
              <p className="text-[11px] text-zinc-500">Não feche esta aba até terminar.</p>
            </div>
          ) : fase === "pronto" ? (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">✓ Gravação salva</div>
              <p className="text-xs text-zinc-500">
                A IA está montando o plano de ação. Revise e envie{final.grupo ? <> pro grupo <b>{final.grupo}</b></> : null} em Feedbacks.
              </p>
              <div className="flex gap-2">
                <Link href="/estrategia/clientes/feedbacks" onClick={fechar} className="inline-flex h-7 items-center rounded-lg bg-blue-600 px-2.5 text-xs font-semibold text-white hover:bg-blue-700">
                  Revisar agora →
                </Link>
                {resultado && !prefs.salvarLocal ? <Btn small onClick={() => baixar(resultado)}>⬇ Baixar cópia</Btn> : null}
                <Btn small onClick={fechar}>Fechar</Btn>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-semibold text-red-600 dark:text-red-400">Não consegui enviar</div>
              <p className="text-xs text-zinc-500">{final.erro}</p>
              <div className="flex flex-wrap gap-2">
                {resultado ? <Btn small primary onClick={() => void enviar(resultado)}>↻ Tentar de novo</Btn> : null}
                {resultado ? <Btn small onClick={() => baixar(resultado)}>⬇ Baixar vídeo</Btn> : null}
                <Btn
                  small
                  onClick={() => {
                    if (!resultado || confirm("O vídeo ainda não chegou no Hub. Descartar mesmo assim?")) fechar();
                  }}
                >
                  Descartar
                </Btn>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </GravCtx.Provider>
  );
}

// Botão do topo do Hub.
export function GravarButton() {
  const { fase, abrir } = useGravador();
  const ocupado = fase === "gravando" || fase === "pausado" || fase === "enviando";
  return (
    <button
      onClick={abrir}
      disabled={ocupado}
      title={ocupado ? "Já tem uma gravação em andamento" : "Gravar a tela pra um cliente"}
      className="flex h-8 items-center gap-1.5 rounded-md bg-red-600 px-2.5 text-xs font-semibold whitespace-nowrap text-white hover:bg-red-700 disabled:opacity-60"
    >
      <span className={`h-2 w-2 rounded-full bg-white ${fase === "gravando" ? "animate-pulse" : ""}`} />
      {fase === "gravando" ? "Gravando…" : fase === "pausado" ? "Pausado" : fase === "enviando" ? "Enviando…" : "Gravar"}
    </button>
  );
}
