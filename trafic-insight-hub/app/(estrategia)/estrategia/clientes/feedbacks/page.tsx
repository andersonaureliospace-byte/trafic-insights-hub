"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, useEstr } from "@/components/estrategia/shell";
import { ClientesTabs } from "@/components/estrategia/clientes-tabs";
import { GravarButton } from "@/components/estrategia/gravador";
import { NovoFeedbackPrint } from "@/components/estrategia/novo-feedback-print";
import { loadClientes, matchesResp } from "@/components/estrategia/use-carteira";
import { Btn, Card, Pill, ago } from "@/components/estrategia/ui";
import type { Tone } from "@/lib/estrategia/calc";

// Etapa 249: Clientes → Feedbacks. Vídeos gravados pela extensão "Gravador de Tela" do Chrome. Cada gravação chega aqui
// já transcrita e com um PLANO DE AÇÃO da IA, "Aguardando revisão". Você confere o vídeo, ajusta o plano, confirma o grupo
// e clica Enviar: abre a prévia (vídeo + plano de ação, como vai aparecer no WhatsApp) e só então confirma o envio — vai o
// vídeo no grupo do cliente e, logo depois, o plano de ação numa mensagem de texto separada.

type Status = "enviando" | "processando" | "revisao" | "enviado";

interface Feedback {
  id: string;
  ad_account_id: string;
  client_name: string;
  titulo: string;
  status: Status;
  video_url: string | null;
  video_mime: string | null;
  video_bytes: number | null;
  duracao_seg: number | null;
  transcricao: string | null;
  resumo: string | null;
  ai_error: string | null;
  wa_group_id: string | null;
  wa_group_name: string | null;
  sent_at: string | null;
  send_error: string | null;
  created_at: string;
  updated_at: string;
  tipo?: "video" | "print";
  print_urls?: string[];
  pontos?: string | null;
}

interface Group {
  id: string;
  name: string;
}

const STALE_MS = 3 * 60_000; // "processando"/"enviando" parado há mais que isso = travou

function isStale(f: Feedback) {
  return (f.status === "processando" || f.status === "enviando") && Date.now() - new Date(f.updated_at).getTime() > STALE_MS;
}

function statusInfo(f: Feedback): { tone: Tone; label: string } {
  if (isStale(f)) return { tone: "bad", label: f.status === "enviando" ? "Upload falhou" : "IA travou" };
  if (f.status === "enviando") return { tone: "off", label: "Subindo vídeo…" };
  if (f.status === "processando") return { tone: "info", label: "Gerando plano…" };
  if (f.status === "enviado") return { tone: "ok", label: "Enviado" };
  if (f.send_error) return { tone: "bad", label: "Erro no envio" };
  return { tone: "warn", label: "Aguardando revisão" };
}

const fmtDur = (s: number | null) => {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};
const fmtMB = (b: number | null) => (b == null ? "—" : `${(b / 1048576).toFixed(1).replace(".", ",")} MB`);
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const flat = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Filtro = "revisao" | "enviado" | "todos";

export default function FeedbacksPage() {
  const { ui } = useEstr();
  const [items, setItems] = useState<Feedback[] | null>(null);
  const [respById, setRespById] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("revisao");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [novoPrint, setNovoPrint] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = (await fetch("/api/feedbacks", { cache: "no-store" }).then((r) => r.json())) as { feedbacks?: Feedback[]; error?: string };
      if (d.error) throw new Error(d.error);
      setItems(d.feedbacks ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega a lista ao abrir
    void load();
    loadClientes()
      .then((list) => setRespById(Object.fromEntries(list.map((c) => [c.id, c.responsible]))))
      .catch(() => {});
  }, [load]);

  // Etapa 251: gravação nova feita pelo botão "● Gravar" do Hub → recarrega a lista na hora.
  useEffect(() => {
    const h = () => void load();
    window.addEventListener("feedbacks:changed", h);
    return () => window.removeEventListener("feedbacks:changed", h);
  }, [load]);

  // Enquanto tiver gravação subindo ou sendo resumida, atualiza sozinho a cada 5s.
  const working = (items ?? []).some((f) => (f.status === "enviando" || f.status === "processando") && !isStale(f));
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [working, load]);

  const list = useMemo(() => {
    const terms = flat(q).split(/\s+/).filter(Boolean);
    return (items ?? []).filter((f) => {
      if (filtro === "revisao" && f.status === "enviado") return false;
      if (filtro === "enviado" && f.status !== "enviado") return false;
      if (!matchesResp(ui.resp, respById[f.ad_account_id] ?? null)) return false;
      const hay = flat(`${f.client_name} ${f.titulo}`);
      return terms.every((t) => hay.includes(t));
    });
  }, [items, filtro, q, ui.resp, respById]);

  const pendentes = (items ?? []).filter((f) => f.status !== "enviado").length;
  const cur = useMemo(() => list.find((f) => f.id === sel) ?? list[0] ?? null, [list, sel]);

  return (
    <div className="flex flex-col">
      <PageHeader title="Clientes" sub="Feedbacks pros clientes — por print do resultado ou em vídeo">
        <Btn primary onClick={() => setNovoPrint(true)}>📸 Feedback por print</Btn>
        <GravarButton />
      </PageHeader>
      {novoPrint ? (
        <NovoFeedbackPrint
          onClose={() => setNovoPrint(false)}
          onCreated={(id) => {
            setNovoPrint(false);
            setFiltro("revisao");
            setSel(id);
            void load();
          }}
        />
      ) : null}
      <ClientesTabs />
      <div className="grid gap-4 p-4 lg:p-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {error ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
              <div className="flex rounded-lg border border-zinc-300 p-0.5 dark:border-white/10">
                {(
                  [
                    ["revisao", `Pra revisar${pendentes ? ` (${pendentes})` : ""}`],
                    ["enviado", "Enviados"],
                    ["todos", "Todos"],
                  ] as Array<[Filtro, string]>
                ).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setFiltro(k)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      filtro === k ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/5"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Pesquisar cliente ou título…"
                aria-label="Pesquisar cliente ou título"
                className="h-8 w-64 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-white/10 dark:bg-[#141924]"
              />
              <Btn small onClick={() => void load()}>↻ Atualizar</Btn>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-[11px] tracking-wide text-zinc-500 uppercase dark:border-white/10">
                    <th className="px-4 py-2.5 font-semibold">Gravado</th>
                    <th className="px-3 py-2.5 font-semibold">Cliente</th>
                    <th className="px-3 py-2.5 font-semibold">Título</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Tipo</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items == null ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">Carregando…</td>
                    </tr>
                  ) : list.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                        {items.length === 0
                          ? "Nenhum feedback ainda. Clique em 📸 Feedback por print (no alto, à direita) pra começar."
                          : filtro === "revisao"
                            ? "Nada pra revisar. 🎉"
                            : "Nenhum feedback com esse filtro."}
                      </td>
                    </tr>
                  ) : (
                    list.map((f) => {
                      const st = statusInfo(f);
                      const on = cur?.id === f.id;
                      return (
                        <tr
                          key={f.id}
                          tabIndex={0}
                          onClick={() => setSel(f.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") setSel(f.id);
                          }}
                          className={`cursor-pointer border-b border-zinc-100 last:border-0 dark:border-white/5 ${
                            on ? "bg-blue-600/8 dark:bg-blue-500/10" : "hover:bg-zinc-50 dark:hover:bg-white/[0.02]"
                          }`}
                        >
                          <td className="px-4 py-3 whitespace-nowrap text-zinc-600 tabular-nums dark:text-zinc-400">{fmtDate(f.created_at)}</td>
                          <td className="px-3 py-3 font-semibold">{f.client_name}</td>
                          <td className="max-w-[16rem] truncate px-3 py-3 text-zinc-600 dark:text-zinc-400">{f.titulo || "—"}</td>
                          <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                            {f.tipo === "print" ? `📸 ${f.print_urls?.length ?? 0} print${(f.print_urls?.length ?? 0) === 1 ? "" : "s"}` : `🎥 ${fmtDur(f.duracao_seg)}`}
                          </td>
                          <td className="px-3 py-3">
                            <Pill tone={st.tone}>{st.label}</Pill>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card className="h-fit p-5 xl:sticky xl:top-16">
          {cur ? <Detail key={cur.id} f={cur} onChanged={load} /> : <p className="text-sm text-zinc-500">Escolha uma gravação na lista.</p>}
        </Card>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]";

function Detail({ f, onChanged }: { f: Feedback; onChanged: () => Promise<void> | void }) {
  const [titulo, setTitulo] = useState(f.titulo);
  const [resumo, setResumo] = useState(f.resumo ?? "");
  const [busy, setBusy] = useState<null | "salvar" | "enviar" | "resumir" | "excluir">(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [groupQ, setGroupQ] = useState("");
  const [pickGroup, setPickGroup] = useState(false);

  // O resumo chega da IA depois que a tela abriu: acompanha enquanto você não mexeu nele.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resumo da IA chega depois
    if (!touched) setResumo(f.resumo ?? "");
  }, [f.resumo, touched]);

  const st = statusInfo(f);
  const dirty = titulo !== f.titulo || resumo !== (f.resumo ?? "");
  const ready = f.status === "revisao" || f.status === "enviado" || isStale(f);
  const asDocument = !(f.video_mime ?? "").includes("mp4") || (f.video_bytes ?? 0) > 16 * 1048576;
  const isPrint = f.tipo === "print";
  const prints = f.print_urls ?? [];
  const [pontos, setPontos] = useState(f.pontos ?? "");
  const temMidia = isPrint ? prints.length > 0 : !!f.video_url;

  async function call(url: string, method: string, body: unknown) {
    const d = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    if (d.error) throw new Error(d.error);
    return d;
  }

  async function save(): Promise<boolean> {
    if (!dirty) return true;
    await call("/api/feedbacks", "PATCH", { id: f.id, titulo, resumo });
    return true;
  }

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<string | null>) {
    setBusy(kind);
    setMsg(null);
    try {
      const ok = await fn();
      if (ok) setMsg({ ok: true, text: ok });
      await onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function loadGroups() {
    setPickGroup(true);
    if (groups) return;
    try {
      const d = await call("/api/whatsapp/groups", "POST", {});
      setGroups((d.groups ?? []) as Group[]);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function chooseGroup(g: Group) {
    await run("salvar", async () => {
      await call("/api/feedbacks", "PATCH", { id: f.id, wa_group_id: g.id, wa_group_name: g.name });
      setPickGroup(false);
      return "Grupo trocado.";
    });
  }

  const shownGroups = useMemo(() => {
    const t = flat(groupQ);
    return (groups ?? []).filter((g) => !t || flat(g.name).includes(t)).slice(0, 80);
  }, [groups, groupQ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{f.client_name}</h2>
          <div className="text-xs text-zinc-500">
            {isPrint ? `${fmtDate(f.created_at)} · 📸 ${prints.length} print${prints.length === 1 ? "" : "s"}` : `${fmtDate(f.created_at)} · ${fmtDur(f.duracao_seg)} · ${fmtMB(f.video_bytes)}`}
          </div>
        </div>
        <Pill tone={st.tone}>{st.label}</Pill>
      </div>

      {isPrint ? (
        <div className={`grid gap-2 ${prints.length > 1 ? "grid-cols-2" : ""}`}>
          {prints.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-zinc-200 dark:border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element -- print do Storage */}
              <img src={u} alt="Print do resultado" className="w-full object-contain" />
            </a>
          ))}
        </div>
      ) : f.video_url && f.status !== "enviando" ? (
        <video src={f.video_url} controls preload="metadata" className="w-full rounded-lg bg-black" />
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-lg bg-zinc-100 text-sm text-zinc-500 dark:bg-white/5">
          {isStale(f) ? "O vídeo não terminou de subir. Grave de novo pela extensão." : "Subindo o vídeo…"}
        </div>
      )}

      {isPrint ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="fb-pontos" className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Pontos de atenção</label>
          <textarea
            id="fb-pontos"
            value={pontos}
            onChange={(e) => setPontos(e.target.value)}
            rows={3}
            disabled={f.status === "enviado"}
            placeholder="O que você quer que a IA fale (ex.: custo alto, subimos vídeos novos…)"
            className={`${inputCls} py-2`}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="fb-titulo" className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Título</label>
        <input id="fb-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} className={`${inputCls} h-9`} disabled={f.status === "enviado"} />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Grupo do WhatsApp</span>
        <div className="flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-sm ${f.wa_group_id ? "" : "text-amber-600 dark:text-amber-400"}`}>
            {f.wa_group_id ? `👥 ${f.wa_group_name ?? f.wa_group_id}` : "Esse cliente não tem grupo vinculado"}
          </span>
          {f.status !== "enviado" ? (
            <Btn small onClick={() => void loadGroups()}>{f.wa_group_id ? "Trocar" : "Escolher grupo"}</Btn>
          ) : null}
        </div>
        {pickGroup ? (
          <div className="mt-1 rounded-lg border border-zinc-200 p-2 dark:border-white/10">
            <input
              autoFocus
              value={groupQ}
              onChange={(e) => setGroupQ(e.target.value)}
              placeholder="Buscar grupo…"
              aria-label="Buscar grupo"
              className={`${inputCls} mb-2 h-8`}
            />
            <div className="max-h-48 overflow-y-auto">
              {groups == null ? (
                <p className="px-1 py-2 text-xs text-zinc-500">Carregando grupos…</p>
              ) : shownGroups.length === 0 ? (
                <p className="px-1 py-2 text-xs text-zinc-500">Nenhum grupo encontrado.</p>
              ) : (
                shownGroups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => void chooseGroup(g)}
                    className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-white/5"
                  >
                    {g.name}
                  </button>
                ))
              )}
            </div>
            <div className="mt-2 text-right">
              <Btn small onClick={() => setPickGroup(false)}>Fechar</Btn>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label htmlFor="fb-resumo" className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
            {isPrint ? "Feedback (vai de legenda no print)" : "Plano de ação (mensagem de texto, depois do vídeo)"}
          </label>
        </div>
        {f.status === "processando" && !isStale(f) ? (
          <div className="rounded-lg bg-blue-500/10 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">{isPrint ? "A IA está escrevendo o feedback… (atualiza sozinho)" : "A IA está transcrevendo e montando o plano de ação… (atualiza sozinho)"}</div>
        ) : null}
        {f.ai_error ? (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            A IA não conseguiu montar o plano: {f.ai_error}. Escreva à mão ou clique em &quot;Gerar plano de novo&quot;.
          </div>
        ) : null}
        <textarea
          id="fb-resumo"
          value={resumo}
          onChange={(e) => {
            setResumo(e.target.value);
            setTouched(true);
          }}
          rows={9}
          placeholder={isPrint ? "Sem texto — só o print será enviado." : "Sem plano de ação — só o vídeo será enviado."}
          disabled={f.status === "enviado"}
          className={`${inputCls} py-2 leading-relaxed`}
        />
        {f.status !== "enviado" ? (
          <button
            onClick={() =>
              void run("resumir", async () => {
                if (isPrint && pontos !== (f.pontos ?? "")) await call("/api/feedbacks/print", "POST", { action: "pontos", id: f.id, pontos });
                await call("/api/feedbacks/resumir", "POST", { id: f.id });
                setTouched(false);
                return isPrint ? "Feedback escrito de novo." : "Plano de ação gerado de novo.";
              })
            }
            disabled={busy != null || f.status === "enviando"}
            className="self-start text-xs font-medium text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
          >
            {busy === "resumir" ? "Gerando…" : isPrint ? "↻ Escrever de novo com a IA (usa os pontos acima)" : "↻ Gerar plano de novo"}
          </button>
        ) : null}
      </div>

      {f.transcricao ? (
        <details className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-white/10">
          <summary className="cursor-pointer text-xs font-semibold text-zinc-500">{isPrint ? "O que você falou no áudio" : "Transcrição completa"}</summary>
          <p className="mt-2 text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{f.transcricao}</p>
        </details>
      ) : null}

      {f.send_error && f.status !== "enviado" ? (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">Última tentativa de envio falhou: {f.send_error}</div>
      ) : null}
      {f.status === "enviado" && f.sent_at ? <p className="text-sm text-emerald-600 dark:text-emerald-400">✓ Enviado {ago(f.sent_at)} pro grupo.</p> : null}
      {msg ? <div className={`text-sm ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</div> : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-white/10">
        {f.status !== "enviado" ? (
          confirmSend ? null : (
            <>
              <Btn primary disabled={busy != null || !ready || !f.wa_group_id || !temMidia} onClick={() => setConfirmSend(true)}>
                👁 Ver prévia e enviar
              </Btn>
              {dirty ? (
                <Btn disabled={busy != null} onClick={() => void run("salvar", async () => { await save(); return "Salvo."; })}>
                  {busy === "salvar" ? "Salvando…" : "Salvar"}
                </Btn>
              ) : null}
            </>
          )
        ) : null}
        <div className="ml-auto">
          {confirmDel ? (
            <span className="flex items-center gap-2">
              <Btn small onClick={() => setConfirmDel(false)}>Cancelar</Btn>
              <button
                onClick={() => void run("excluir", async () => {
                  await call("/api/feedbacks", "DELETE", { id: f.id });
                  return null;
                })}
                disabled={busy != null}
                className="h-7 rounded-lg bg-red-600 px-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Excluir de vez
              </button>
            </span>
          ) : (
            <Btn small onClick={() => setConfirmDel(true)} title="Apaga a gravação e o vídeo do armazenamento">🗑 Excluir</Btn>
          )}
        </div>
      </div>
      {confirmSend && temMidia ? (
        <SendPreview
          groupName={f.wa_group_name ?? f.wa_group_id ?? ""}
          videoUrl={f.video_url}
          prints={isPrint ? prints : null}
          caption={`🎥 *${titulo.trim() || "Feedback"}*`}
          asDocument={asDocument}
          plano={resumo}
          busy={busy === "enviar"}
          onCancel={() => setConfirmSend(false)}
          onConfirm={(proximo) =>
            void run("enviar", async () => {
              await save();
              await call("/api/feedbacks/enviar", "POST", { id: f.id, proximo });
              setConfirmSend(false);
              return proximo ? `Enviado pro cliente! Próximo feedback em ${proximo.split("-").reverse().slice(0, 2).join("/")}.` : "Enviado pro cliente!";
            })
          }
        />
      ) : null}
      {confirmDel ? <p className="-mt-2 text-xs text-zinc-500">Apaga a gravação daqui e o vídeo do armazenamento. Não dá pra desfazer.</p> : null}
    </div>
  );
}

// Texto com a formatação do WhatsApp (*negrito*, _itálico_) — sem HTML cru.
function WaText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\*[^*\n]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b> : /^_[^_\n]+_$/.test(p) ? <i key={i}>{p.slice(1, -1)}</i> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

// Prévia antes de enviar: o vídeo e o plano de ação do jeito que vão chegar no grupo. Só envia no "Confirmar envio".
function SendPreview({
  groupName,
  videoUrl,
  prints,
  caption,
  asDocument,
  plano,
  busy,
  onCancel,
  onConfirm,
}: {
  groupName: string;
  videoUrl: string | null;
  prints: string[] | null;
  caption: string;
  asDocument: boolean;
  plano: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (proximo: string | null) => void;
}) {
  // Etapa 291: ao enviar, conclui a tarefa de feedback de hoje (Demandas) e já programa o próximo
  const hojeSP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const mais = (n: number) => {
    const [y, m, d] = hojeSP.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  const [proximo, setProximo] = useState(mais(7));
  const [programar, setProgramar] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Prévia do envio">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#121722]">
        <div className="flex items-center gap-3 bg-[#008069] px-4 py-3 text-white dark:bg-[#202c33]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg">👥</span>
          <div className="min-w-0">
            <div className="truncate font-semibold">{groupName}</div>
            <div className="text-xs opacity-80">Prévia — ainda não foi enviado</div>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-[#efeae2] p-4 dark:bg-[#0b141a]">
          {prints ? (
            prints.map((u, i) => {
              const last = i === prints.length - 1;
              const legenda = last && plano.trim().length > 0 && plano.trim().length <= 1000;
              return (
                <div key={u} className="ml-auto w-[85%] rounded-lg rounded-tr-none bg-[#d9fdd3] p-1.5 shadow-sm dark:bg-[#005c4b]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- prévia */}
                  <img src={u} alt="" className="w-full rounded-md" />
                  {legenda ? (
                    <div className="px-1.5 pt-1.5 pb-0.5 text-sm leading-relaxed whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
                      <WaText text={plano.trim()} />
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : null}
          {prints && plano.trim().length > 1000 ? (
            <div className="ml-auto w-[85%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-zinc-900 shadow-sm dark:bg-[#005c4b] dark:text-zinc-100">
              <WaText text={plano.trim()} />
            </div>
          ) : null}
          {prints ? null : (
          <>
          <div className="ml-auto w-[85%] rounded-lg rounded-tr-none bg-[#d9fdd3] p-1.5 shadow-sm dark:bg-[#005c4b]">
            {asDocument ? (
              <div className="mb-1 rounded bg-black/5 px-2 py-1 text-[11px] text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                📎 Vai como arquivo (passou de 16 MB) — o cliente toca depois de baixar
              </div>
            ) : null}
            {videoUrl ? <video src={videoUrl} controls preload="metadata" className="w-full rounded-md bg-black" /> : null}
            <div className="px-1.5 pt-1.5 pb-0.5 text-sm whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
              <WaText text={caption} />
            </div>
          </div>
          {plano.trim() ? (
            <div className="ml-auto w-[85%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-zinc-900 shadow-sm dark:bg-[#005c4b] dark:text-zinc-100">
              <WaText text={plano.trim()} />
            </div>
          ) : (
            <p className="text-center text-xs text-zinc-500">Sem plano de ação — só o vídeo vai ser enviado.</p>
          )}
          </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 p-3 dark:border-white/10">
          <label className="mr-auto flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={programar} onChange={(e) => setProgramar(e.target.checked)} />
            Próximo feedback em
            <input
              type="date"
              value={proximo}
              onChange={(e) => setProximo(e.target.value)}
              disabled={!programar}
              aria-label="Data do próximo feedback"
              className="h-8 rounded-md border border-zinc-300 bg-white px-2 text-xs disabled:opacity-50 dark:border-white/10 dark:bg-[#141924]"
            />
            {[7, 15, 30].map((n) => (
              <button key={n} type="button" disabled={!programar} onClick={() => setProximo(mais(n))} className="rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5">
                +{n}d
              </button>
            ))}
          </label>
          <Btn onClick={onCancel} disabled={busy}>Voltar e editar</Btn>
          <Btn primary onClick={() => onConfirm(programar ? proximo : null)} disabled={busy}>{busy ? "Enviando…" : "📤 Confirmar envio"}</Btn>
        </div>
      </div>
    </div>
  );
}
