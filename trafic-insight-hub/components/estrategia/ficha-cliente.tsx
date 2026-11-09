"use client";

import { useCallback, useEffect, useState } from "react";
import { useEstr } from "./shell";
import { loadClientes, loadOfferFlags, saveOfferFlags, normId, type Cliente, type OfferFlags } from "./use-carteira";
import { Btn, fmtBRL } from "./ui";
import { DescricaoAsana } from "./descricao-asana";
import { usePriorityOptions } from "@/lib/priority-context";
import { calendarSP } from "@/lib/estrategia/calc";
import { adsManagerUrl } from "@/lib/meta/ads-manager-link";

// Etapa 296: ficha do cliente num componente só — usada em Clientes (coluna da direita) e no Acompanhamento (caixa
// grande que abre pelo 📝). Carrega tudo sozinha a partir do id da conta. "Cliente desde" saiu; o WhatsApp passou a
// ser editável; o grupo do WhatsApp mostra o grupo ligado de verdade (o do WhatsApp do Hub ou, se não tiver, o da ficha).

type Status = "ativo" | "inauguracao" | "pausado";
const STATUS_LABEL: Record<Status, string> = { ativo: "Ativo", inauguracao: "Inauguração", pausado: "Pausado" };
export const PAY_LABEL: Record<string, string> = { pix: "Pix (pré-paga)", hybrid: "Híbrida", boleto: "Boleto", card: "Cartão" };

export function statusOf(c: Cliente): Status {
  if (!c.active) return "pausado";
  if (c.priority === "inauguracao") return "inauguracao";
  return "ativo";
}

interface Form {
  name: string;
  responsible: string;
  status: Status;
  monthly: string;
  cpaTarget: string;
  payment: string;
  whatsapp: string;
  exame: boolean;
  promo: boolean;
  sensivel: boolean;
}

const num = (s: string): number | null => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const inputCls = "h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]";

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}

interface Dados {
  c: Cliente;
  pay: string | null;
  flags: OfferFlags | undefined;
  sens: boolean;
  grupo: string | null;
}

async function carregar(id: string): Promise<Dados | null> {
  const [list, p, f, sv, chats] = await Promise.all([
    loadClientes(),
    fetch("/api/pix-accounts", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
    loadOfferFlags().catch(() => ({}) as Record<string, OfferFlags>),
    fetch("/api/estrategia/prefs?key=contas_sensiveis", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
    fetch("/api/wa/chats", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
  ]);
  const c = list.find((x) => x.id === normId(id));
  if (!c) return null;
  const payRow = ((p?.pixAccounts ?? []) as Array<{ ad_account_id: string; payment_type: string | null }>).find((r) => normId(r.ad_account_id) === c.id);
  const chat = ((chats?.chats ?? []) as Array<{ chat_jid: string; name: string | null; ad_account_ids: string[] | null }>).find((x) =>
    (x.ad_account_ids ?? []).some((a) => normId(a) === c.id),
  );
  const sensMap = sv?.value && typeof sv.value === "object" ? (sv.value as Record<string, boolean>) : {};
  return { c, pay: payRow?.payment_type ?? null, flags: f[c.id], sens: !!sensMap[c.id], grupo: chat?.name?.trim() || c.waGroup || null };
}

function formOf(d: Dados): Form {
  const { c } = d;
  return {
    name: c.name,
    responsible: c.responsible ?? "",
    status: statusOf(c),
    monthly: c.monthly != null ? String(c.monthly) : "",
    cpaTarget: c.cpaTarget != null ? String(c.cpaTarget) : "",
    payment: d.pay ?? "",
    whatsapp: c.whatsapp ?? "",
    exame: !!d.flags?.exame,
    promo: !!d.flags?.promo,
    sensivel: d.sens,
  };
}

export function FichaCliente({
  id,
  onSaved,
  onArchived,
  titulo = true,
  descricao = true,
}: {
  id: string;
  onSaved?: () => void;
  onArchived?: () => void;
  titulo?: boolean; // mostra o nome + "Ficha do cliente" no topo
  descricao?: boolean; // mostra o "Descrição do Asana" (buscar/enviar) no fim
}) {
  const { gestores } = useEstr();
  const { options } = usePriorityOptions();
  const [dados, setDados] = useState<Dados | null | undefined>(undefined);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await carregar(id);
      setDados(d);
      setForm(d ? formOf(d) : null);
    } catch (e) {
      setDados(null);
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega a ficha ao abrir (quem usa remonta por cliente)
    void load();
  }, [load]);

  async function patchBinding(c: Cliente, body: Record<string, unknown>) {
    const d = await fetch("/api/account-bindings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad_account_id: c.rawId, ...body }),
    }).then((r) => r.json());
    if (d.error) throw new Error(d.error);
  }

  async function save() {
    if (!dados || !form) return;
    const cur = dados.c;
    setSaving(true);
    setMsg(null);
    try {
      if (!form.name.trim()) throw new Error("O nome do cliente não pode ficar vazio.");
      const body: Record<string, unknown> = {
        responsible: form.responsible || null,
        monthly_investment: num(form.monthly),
        cpa_target: num(form.cpaTarget),
      };
      if (form.name.trim() !== cur.name) body.client_name = form.name.trim();
      if (form.whatsapp.trim() !== (cur.whatsapp ?? "")) body.whatsapp_contact = form.whatsapp.trim() || null;
      const before = statusOf(cur);
      if (form.status !== before) {
        body.active = form.status !== "pausado";
        if (form.status === "inauguracao") body.priority = "inauguracao";
        else if (cur.priority === "inauguracao") body.priority = null;
      }
      await patchBinding(cur, body);
      const f0 = dados.flags;
      if (!f0 || f0.exame !== form.exame || !!f0.promo !== form.promo) {
        const latest = await loadOfferFlags().catch(() => ({}) as Record<string, OfferFlags>);
        await saveOfferFlags({ ...latest, [cur.id]: { exame: form.exame, promo: form.promo } });
      }
      if (dados.sens !== form.sensivel) {
        const latest = await fetch("/api/estrategia/prefs?key=contas_sensiveis", { cache: "no-store" }).then((r) => r.json());
        const next = { ...((latest?.value as Record<string, boolean> | null) ?? {}) };
        if (form.sensivel) next[cur.id] = true;
        else delete next[cur.id];
        const d = await fetch("/api/estrategia/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "contas_sensiveis", value: next }) }).then((r) => r.json());
        if (d.error) throw new Error(d.error);
      }
      if ((dados.pay ?? "") !== form.payment) {
        const d = await fetch("/api/pix-accounts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ad_account_id: cur.rawId, payment_type: form.payment || null }),
        }).then((r) => r.json());
        if (d.error) throw new Error(d.error);
      }
      await load();
      setMsg({ ok: true, text: "Alterações salvas." });
      onSaved?.();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function archive(value: boolean) {
    if (!dados) return;
    setSaving(true);
    try {
      await patchBinding(dados.c, { archived: value });
      setConfirmArchive(false);
      if (onArchived) onArchived();
      else await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (dados === undefined) return <p className="text-sm text-zinc-500">Carregando a ficha…</p>;
  if (!dados || !form) return <p className="text-sm text-zinc-500">{msg?.text ?? "Cliente não encontrado."}</p>;
  const cur = dados.c;
  const prioLabel = cur.priority ? (options.find((o) => o.id === cur.priority)?.label ?? cur.priority) : "—";

  return (
    <div className="flex flex-col gap-4">
      {titulo ? (
        <div>
          <h2 className="text-lg font-semibold">{cur.name}</h2>
          <div className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Ficha do cliente</div>
        </div>
      ) : null}
      {cur.archived ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-500">Cliente arquivado: não aparece nas telas nem entra nas automações. Os dados continuam guardados.</p>
          <Btn primary onClick={() => void archive(false)} disabled={saving}>Trazer de volta</Btn>
        </div>
      ) : (
        <>
          <Field label="Nome do cliente" htmlFor={`f-nome-${cur.id}`}>
            <input id={`f-nome-${cur.id}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Responsável" htmlFor={`f-resp-${cur.id}`}>
              <select id={`f-resp-${cur.id}`} value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} className={inputCls}>
                <option value="">Sem responsável</option>
                {[...new Set([...gestores, ...(form.responsible ? [form.responsible] : [])])].map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </Field>
            <Field label="Status" htmlFor={`f-status-${cur.id}`}>
              <select id={`f-status-${cur.id}`} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })} className={inputCls}>
                {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Verba mensal (R$)" htmlFor={`f-verba-${cur.id}`}>
              <input id={`f-verba-${cur.id}`} inputMode="decimal" value={form.monthly} onChange={(e) => setForm({ ...form, monthly: e.target.value })} className={inputCls} />
            </Field>
            <Field label="CPA ideal (R$)" htmlFor={`f-cpa-${cur.id}`}>
              <input id={`f-cpa-${cur.id}`} inputMode="decimal" value={form.cpaTarget} onChange={(e) => setForm({ ...form, cpaTarget: e.target.value })} className={inputCls} />
            </Field>
          </div>
          {num(form.monthly) ? (
            <div className="-mt-2 text-xs text-zinc-500">≈ {fmtBRL((num(form.monthly) as number) / calendarSP().daysInMonth)} por dia neste mês</div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pagamento" htmlFor={`f-pay-${cur.id}`}>
              <select id={`f-pay-${cur.id}`} value={form.payment} onChange={(e) => setForm({ ...form, payment: e.target.value })} className={inputCls}>
                <option value="">Não definido</option>
                {Object.entries(PAY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="WhatsApp do cliente" htmlFor={`f-wa-${cur.id}`}>
              <input
                id={`f-wa-${cur.id}`}
                inputMode="tel"
                placeholder="(00) 00000-0000"
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.sensivel} onChange={(e) => setForm({ ...form, sensivel: e.target.checked })} className="h-4 w-4 accent-blue-600" />
            Conta sensível <span className="text-xs text-zinc-500">(otimizar até as 09h)</span>
          </label>
          <Field label="Ofertas que a conta anuncia">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              <span className="flex items-center gap-2 text-zinc-500">
                <input type="checkbox" checked disabled className="h-4 w-4" /> GERAL (todas)
              </span>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.exame} onChange={(e) => setForm({ ...form, exame: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                EXAME
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.promo} onChange={(e) => setForm({ ...form, promo: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                PROMO
              </label>
            </div>
            {!dados.flags ? <p className="text-xs text-amber-600 dark:text-amber-400">Ainda não definido. Marque e salve.</p> : null}
          </Field>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-zinc-500">Conta de anúncio</dt>
            <dd className="font-mono text-xs break-all">
              <a href={adsManagerUrl(cur.id)} target="_blank" rel="noopener noreferrer" title="Abrir no Gerenciador de Anúncios" className="text-blue-700 hover:underline dark:text-blue-300">
                act_{cur.id} ↗
              </a>
            </dd>
            <dt className="text-zinc-500">Prioridade Asana</dt>
            <dd className="font-medium">{prioLabel}</dd>
            <dt className="text-zinc-500">Grupo WhatsApp</dt>
            <dd>{dados.grupo ?? <span className="text-zinc-500 italic">sem grupo ligado</span>}</dd>
          </dl>
          {msg ? <div className={`text-sm ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</div> : null}
          <div className="flex items-center gap-2 border-t border-zinc-200 pt-4 dark:border-white/10">
            <div className="flex-1">
              <Btn primary onClick={() => void save()} disabled={saving}>{saving ? "Salvando…" : "Salvar alterações"}</Btn>
            </div>
            {confirmArchive ? (
              <>
                <Btn onClick={() => setConfirmArchive(false)}>Cancelar</Btn>
                <button
                  onClick={() => void archive(true)}
                  disabled={saving}
                  className="h-9 rounded-lg bg-red-600 px-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Arquivar
                </button>
              </>
            ) : (
              <Btn onClick={() => setConfirmArchive(true)} title="Arquivar cliente (some das telas, dá pra trazer de volta)">
                🗑 Arquivar
              </Btn>
            )}
          </div>
          {confirmArchive ? (
            <p className="text-xs text-zinc-500">O cliente some das telas e sai das automações. Nada é apagado: dá pra trazer de volta em &quot;Ver arquivados&quot;.</p>
          ) : null}
          {descricao ? <DescricaoAsana accountId={cur.rawId} clientName={cur.name} /> : null}
        </>
      )}
    </div>
  );
}
