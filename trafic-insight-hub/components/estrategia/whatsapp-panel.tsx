"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

// Etapa 244: espelho do WhatsApp no Hub estratégico — painel à esquerda (1/3 da tela), esconde/expande.
// Mostra só os grupos que você atribuiu a um cliente ou escolheu à mão (⚙). Lê e responde pelo seu número (Uazapi).
// As mensagens ficam guardadas 90 dias no Supabase; a mídia é pedida à Uazapi na hora (enquanto ela tiver).

interface Chat {
  chat_jid: string;
  name: string;
  ad_account_ids: string[];
  last_message_at: string | null;
  last_preview: string | null;
  unread: number;
}
interface Msg {
  message_id: string;
  from_me: boolean;
  sender_name: string | null;
  msg_type: string | null;
  body: string | null;
  has_media: boolean;
  quoted_id: string | null;
  ts: string;
}
interface Group {
  id: string;
  name: string;
}
interface Binding {
  ad_account_id: string;
  client_name?: string | null;
  wa_group_id?: string | null;
  wa_group_name?: string | null;
  active?: boolean;
}

const OPEN_KEY = "estr_wa_open";
const fmtTime = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const t = new Date();
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === t.toDateString()) return "Hoje";
  if (d.toDateString() === y.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
};

export function useWaOpen(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lembra neste navegador se o painel estava aberto
      setOpen(localStorage.getItem(OPEN_KEY) !== "0");
    } catch {
      setOpen(true);
    }
  }, []);
  const set = useCallback((v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? "1" : "0");
    } catch {
      /* só nesta sessão */
    }
  }, []);
  return [open, set];
}

export function WhatsappPanel({ onClose, onUnread }: { onClose: () => void; onUnread?: (n: number) => void }) {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [chatsErr, setChatsErr] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [config, setConfig] = useState(false);

  const loadChats = useCallback(async () => {
    try {
      const d = (await fetch("/api/wa/chats", { cache: "no-store" }).then((r) => r.json())) as { chats?: Chat[]; error?: string };
      if (d.error) throw new Error(d.error);
      setChats(d.chats ?? []);
      setChatsErr(null);
    } catch (e) {
      setChatsErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega a lista ao abrir
    void loadChats();
    fetch("/api/account-bindings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { bindings?: Binding[] }) =>
        setNames(Object.fromEntries((d.bindings ?? []).map((b) => [b.ad_account_id, (b.client_name ?? "").trim() || b.ad_account_id]))),
      )
      .catch(() => {});
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void loadChats();
    }, 30_000);
    return () => clearInterval(t);
  }, [loadChats]);

  const totalUnread = useMemo(() => (chats ?? []).reduce((s, c) => s + c.unread, 0), [chats]);
  useEffect(() => onUnread?.(totalUnread), [totalUnread, onUnread]);

  const label = useCallback(
    (c: Chat) => (c.ad_account_ids.length ? c.ad_account_ids.map((a) => names[a] ?? a).join(" · ") : c.name || c.chat_jid),
    [names],
  );
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (chats ?? []).filter((c) => !n || label(c).toLowerCase().includes(n) || c.name.toLowerCase().includes(n));
  }, [chats, q, label]);
  const current = (chats ?? []).find((c) => c.chat_jid === sel) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-[#0f131c]">
      {current ? (
        <ChatView
          key={current.chat_jid}
          chat={current}
          title={label(current)}
          onBack={() => {
            setSel(null);
            void loadChats();
          }}
        />
      ) : (
        <>
          <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-2 dark:border-white/10">
            <span className="text-sm font-semibold">WhatsApp</span>
            {totalUnread ? <span className="rounded-full bg-emerald-600 px-1.5 text-[11px] font-bold text-white">{totalUnread}</span> : null}
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => setConfig(true)} title="Escolher os grupos (por cliente ou à mão)" className="h-8 w-8 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">
                ⚙
              </button>
              <button onClick={onClose} title="Esconder o WhatsApp" aria-label="Esconder o WhatsApp" className="h-8 w-8 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">
                ⟨
              </button>
            </div>
          </div>
          <div className="px-3 py-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar grupo ou cliente…"
              className="h-8 w-full rounded-lg border border-zinc-300 bg-transparent px-2.5 text-sm dark:border-white/10"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {chatsErr ? <p className="px-3 py-2 text-xs text-red-600">{chatsErr}</p> : null}
            {!chats && !chatsErr ? <p className="px-3 py-2 text-xs text-zinc-500">Carregando…</p> : null}
            {chats && chats.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-zinc-500">
                Nenhum grupo no espelho ainda.
                <br />
                <button onClick={() => setConfig(true)} className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">
                  Escolher grupos
                </button>
              </div>
            ) : null}
            {shown.map((c) => (
              <button
                key={c.chat_jid}
                onClick={() => setSel(c.chat_jid)}
                className="flex w-full items-start gap-2 border-b border-zinc-100 px-3 py-2.5 text-left hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-white/5"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600/15 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  {label(c).replace(/^IVS\s*/i, "").slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`min-w-0 flex-1 truncate text-sm ${c.unread ? "font-semibold" : ""}`}>{label(c)}</span>
                    <span className={`shrink-0 text-[11px] ${c.unread ? "text-emerald-600" : "text-zinc-400"}`}>{fmtTime(c.last_message_at)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{c.last_preview ?? (c.ad_account_ids.length ? c.name : "")}</span>
                    {c.unread ? <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 text-[11px] font-bold text-white">{c.unread}</span> : null}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {config ? (
        <ConfigDialog
          chats={chats ?? []}
          onClose={() => setConfig(false)}
          onSaved={() => {
            setConfig(false);
            void loadChats();
          }}
        />
      ) : null}
    </div>
  );
}

function ChatView({ chat, title, onBack }: { chat: Chat; title: string; onBack: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<Msg | null>(null);
  const [sending, setSending] = useState(false);
  const [media, setMedia] = useState<Record<string, { url?: string; mime?: string; error?: string; loading?: boolean }>>({});
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const merge = (incoming: Msg[]) =>
    setMsgs((cur) => {
      const map = new Map(cur.map((m) => [m.message_id, m]));
      for (const m of incoming) map.set(m.message_id, m);
      return [...map.values()].sort((a, b) => a.ts.localeCompare(b.ts));
    });

  const refresh = useCallback(async (live: boolean) => {
    try {
      const d = (await fetch(`/api/wa/messages?chat=${encodeURIComponent(chat.chat_jid)}${live ? "&live=1" : ""}`, { cache: "no-store" }).then((r) => r.json())) as {
        messages?: Msg[];
        hasMore?: boolean;
        error?: string;
      };
      if (d.error) throw new Error(d.error);
      merge(d.messages ?? []);
      setHasMore((h) => h || !!d.hasMore);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [chat.chat_jid]);

  useEffect(() => {
    void refresh(true).then(() => fetch("/api/wa/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat: chat.chat_jid }) }));
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 7000);
    return () => clearInterval(t);
  }, [refresh, chat.chat_jid]);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  async function older() {
    const first = msgs[0];
    if (!first) return;
    const el = box.current;
    const prevH = el?.scrollHeight ?? 0;
    stick.current = false;
    const d = (await fetch(`/api/wa/messages?chat=${encodeURIComponent(chat.chat_jid)}&before=${encodeURIComponent(first.ts)}`).then((r) => r.json())) as {
      messages?: Msg[];
      hasMore?: boolean;
    };
    merge(d.messages ?? []);
    setHasMore(!!d.hasMore);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevH;
    });
  }

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setErr(null);
    try {
      const d = (await fetch("/api/wa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat: chat.chat_jid, text: t, replyid: reply?.message_id }),
      }).then((r) => r.json())) as { ok?: boolean; error?: string };
      if (!d.ok) throw new Error(d.error ?? "Não enviou.");
      setText("");
      setReply(null);
      stick.current = true;
      await refresh(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function openMedia(m: Msg) {
    setMedia((x) => ({ ...x, [m.message_id]: { loading: true } }));
    try {
      const d = (await fetch("/api/wa/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageid: m.message_id }) }).then((r) =>
        r.json(),
      )) as { url?: string; mime?: string; error?: string };
      if (!d.url) throw new Error(d.error ?? "Sem mídia.");
      setMedia((x) => ({ ...x, [m.message_id]: { url: d.url, mime: d.mime } }));
    } catch (e) {
      setMedia((x) => ({ ...x, [m.message_id]: { error: (e as Error).message } }));
    }
  }

  const byId = useMemo(() => new Map(msgs.map((m) => [m.message_id, m])), [msgs]);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-2 py-2 dark:border-white/10">
        <button onClick={onBack} aria-label="Voltar pra lista" className="h-8 w-8 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          {chat.ad_account_ids.length ? <p className="truncate text-[11px] text-zinc-500">{chat.name}</p> : null}
        </div>
      </div>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-zinc-50 px-3 py-2 dark:bg-[#0b0e14]"
      >
        {hasMore ? (
          <div className="py-1 text-center">
            <button onClick={() => void older()} className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-500 dark:border-white/10">
              Carregar mais antigas
            </button>
          </div>
        ) : null}
        {loading ? <p className="py-4 text-center text-xs text-zinc-500">Carregando mensagens…</p> : null}
        {!loading && msgs.length === 0 ? <p className="py-4 text-center text-xs text-zinc-500">Nenhuma mensagem guardada desse grupo ainda.</p> : null}
        {msgs.map((m, i) => {
          const newDay = i === 0 || dayLabel(msgs[i - 1].ts) !== dayLabel(m.ts);
          const quoted = m.quoted_id ? byId.get(m.quoted_id) : null;
          const md = media[m.message_id];
          return (
            <Fragment key={m.message_id}>
              {newDay ? (
                <div className="py-1 text-center">
                  <span className="rounded-md bg-white px-2 py-0.5 text-[11px] text-zinc-500 shadow-sm dark:bg-white/10">{dayLabel(m.ts)}</span>
                </div>
              ) : null}
              <div className={`group flex ${m.from_me ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${
                    m.from_me ? "bg-emerald-100 text-zinc-900 dark:bg-emerald-900/50 dark:text-zinc-100" : "bg-white dark:bg-[#1a2030]"
                  }`}
                >
                  {!m.from_me ? <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">{m.sender_name ?? "—"}</p> : null}
                  {quoted || m.quoted_id ? (
                    <p className="mb-1 truncate rounded border-l-2 border-emerald-500 bg-black/5 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-white/5 dark:text-zinc-400">
                      {quoted ? `${quoted.from_me ? "Você" : quoted.sender_name ?? ""}: ${quoted.body ?? ""}` : "Resposta a uma mensagem"}
                    </p>
                  ) : null}
                  {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
                  {m.has_media ? (
                    md?.url ? (
                      md.mime?.startsWith("image/") || /image|sticker/i.test(m.msg_type ?? "") ? (
                        // eslint-disable-next-line @next/next/no-img-element -- arquivo temporário da Uazapi
                        <img src={md.url} alt="" className="mt-1 max-h-64 rounded" />
                      ) : md.mime?.startsWith("audio/") || /audio|ptt/i.test(m.msg_type ?? "") ? (
                        <audio controls src={md.url} className="mt-1 w-56" />
                      ) : md.mime?.startsWith("video/") || /video/i.test(m.msg_type ?? "") ? (
                        <video controls src={md.url} className="mt-1 max-h-64 rounded" />
                      ) : (
                        <a href={md.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs text-blue-600 underline">
                          Abrir arquivo
                        </a>
                      )
                    ) : (
                      <button onClick={() => void openMedia(m)} className="mt-1 text-xs text-blue-600 underline dark:text-blue-400">
                        {md?.loading ? "Abrindo…" : md?.error ? `Mídia indisponível (${md.error})` : "Ver mídia"}
                      </button>
                    )
                  ) : null}
                  <div className="mt-0.5 flex items-center justify-end gap-2">
                    <button
                      onClick={() => setReply(m)}
                      className="text-[10px] text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-emerald-600 focus:opacity-100"
                    >
                      Responder
                    </button>
                    <span className="text-[10px] text-zinc-400">{new Date(m.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
      <div className="border-t border-zinc-200 p-2 dark:border-white/10">
        {err ? <p className="mb-1 text-xs text-red-600">{err}</p> : null}
        {reply ? (
          <div className="mb-1 flex items-center gap-2 rounded-md border-l-2 border-emerald-500 bg-zinc-100 px-2 py-1 text-xs dark:bg-white/5">
            <span className="min-w-0 flex-1 truncate">
              Respondendo {reply.from_me ? "você" : reply.sender_name}: {reply.body}
            </span>
            <button onClick={() => setReply(null)} className="text-zinc-500" aria-label="Cancelar resposta">
              ✕
            </button>
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={Math.min(5, Math.max(1, text.split("\n").length))}
            placeholder="Mensagem (Enter envia, Shift+Enter pula linha)"
            className="min-h-9 flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-white/10 dark:bg-[#141924]"
          />
          <button
            onClick={() => void send()}
            disabled={sending || !text.trim()}
            className="h-9 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {sending ? "…" : "Enviar"}
          </button>
        </div>
      </div>
    </>
  );
}

function ConfigDialog({ chats, onClose, onSaved }: { chats: Chat[]; onClose: () => void; onSaved: () => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // conta → grupo
  const [byAccount, setByAccount] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const c of chats) for (const a of c.ad_account_ids) m[a] = c.chat_jid;
    return m;
  });
  const [manual, setManual] = useState<Set<string>>(() => new Set(chats.filter((c) => !c.ad_account_ids.length).map((c) => c.chat_jid)));
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState("");

  const loadGroups = useCallback(async (force = false) => {
    try {
      const d = (await fetch(`/api/wa/groups${force ? "?force=1" : ""}`, { cache: "no-store" }).then((r) => r.json())) as { groups?: Group[]; error?: string };
      if (d.error) throw new Error(d.error);
      setGroups(d.groups ?? []);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega os grupos ao abrir
    void loadGroups();
    fetch("/api/account-bindings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { bindings?: Binding[] }) =>
        setBindings(
          (d.bindings ?? [])
            .filter((b) => b.active !== false)
            .sort((a, b) => (a.client_name ?? "").localeCompare(b.client_name ?? "", "pt-BR")),
        ),
      )
      .catch(() => {});
  }, [loadGroups]);

  const groupName = useMemo(() => new Map((groups ?? []).map((g) => [g.id, g.name])), [groups]);
  const filteredGroups = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (groups ?? []).filter((g) => !n || g.name.toLowerCase().includes(n));
  }, [groups, q]);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const want = new Map<string, string[]>(); // chat → contas
      for (const [acc, chat] of Object.entries(byAccount)) if (chat) want.set(chat, [...(want.get(chat) ?? []), acc]);
      for (const chat of manual) if (!want.has(chat)) want.set(chat, []);
      const current = new Map(chats.map((c) => [c.chat_jid, c]));
      const toDelete = chats.filter((c) => !want.has(c.chat_jid)).map((c) => c.chat_jid);
      const toPut = [...want.entries()].filter(([chat, accs]) => {
        const c = current.get(chat);
        return !c || [...c.ad_account_ids].sort().join(",") !== [...accs].sort().join(",");
      });
      let i = 0;
      for (const chat of toDelete) {
        setProgress(`Tirando ${++i}/${toDelete.length + toPut.length}…`);
        await fetch("/api/wa/chats", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_jid: chat }) });
      }
      for (const [chat, accs] of toPut) {
        setProgress(`${current.has(chat) ? "Atualizando" : "Puxando o histórico de"} ${groupName.get(chat) ?? chat} (${++i}/${toDelete.length + toPut.length})…`);
        const d = (await fetch("/api/wa/chats", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_jid: chat, name: groupName.get(chat) ?? current.get(chat)?.name ?? "", ad_account_ids: accs }),
        }).then((r) => r.json())) as { ok?: boolean; error?: string };
        if (!d.ok) throw new Error(d.error ?? "Não salvou.");
      }
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
      setProgress("");
    }
  }

  const sel = "h-8 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2 text-xs dark:border-white/10 dark:bg-[#141924]";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onClick={saving ? undefined : onClose}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-[#121722]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-white/10">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold">Grupos do WhatsApp no Hub</h3>
            <p className="text-xs text-zinc-500">Só aparecem os grupos atribuídos a um cliente ou marcados em “Outros grupos”. Histórico guardado por 90 dias.</p>
          </div>
          <button onClick={() => void loadGroups(true)} className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5" title="Buscar de novo a lista de grupos do seu WhatsApp">
            ↻ Grupos
          </button>
          <button onClick={onClose} disabled={saving} className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5">
            ✕
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
          <section>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Grupo de cada cliente</h4>
            {!groups ? <p className="text-xs text-zinc-500">Carregando grupos…</p> : null}
            <div className="space-y-1.5">
              {bindings.map((b) => {
                const cur = byAccount[b.ad_account_id] ?? "";
                const suggest = !cur && b.wa_group_id && groupName.has(b.wa_group_id) ? b.wa_group_id : null;
                return (
                  <div key={b.ad_account_id} className="rounded-md border border-zinc-200 p-2 dark:border-white/10">
                    <p className="mb-1 truncate text-xs font-medium">{(b.client_name ?? "").trim() || b.ad_account_id}</p>
                    <select value={cur} onChange={(e) => setByAccount((m) => ({ ...m, [b.ad_account_id]: e.target.value }))} className={sel}>
                      <option value="">— sem grupo —</option>
                      {(groups ?? []).map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                    {suggest ? (
                      <button
                        onClick={() => setByAccount((m) => ({ ...m, [b.ad_account_id]: suggest }))}
                        className="mt-1 text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                        title="Grupo que já está cadastrado pra esse cliente (envio de Pix/relatório)"
                      >
                        Usar o grupo do Pix: {groupName.get(suggest)}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
          <section>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Outros grupos</h4>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar grupo…" className={`${sel} mb-2 h-8`} />
            <div className="space-y-0.5">
              {filteredGroups.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={manual.has(g.id)}
                    onChange={(e) =>
                      setManual((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(g.id);
                        else n.delete(g.id);
                        return n;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                  {Object.values(byAccount).includes(g.id) ? <span className="text-[10px] text-zinc-400">cliente</span> : null}
                </label>
              ))}
            </div>
          </section>
        </div>
        <div className="flex items-center gap-2 border-t border-zinc-200 px-4 py-3 dark:border-white/10">
          {err ? <span className="text-xs text-red-600">{err}</span> : progress ? <span className="text-xs text-zinc-500">{progress}</span> : null}
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} disabled={saving} className="h-9 rounded-lg border border-zinc-300 px-3 text-sm dark:border-white/10">
              Cancelar
            </button>
            <button onClick={() => void save()} disabled={saving} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
