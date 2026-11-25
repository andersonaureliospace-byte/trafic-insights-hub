"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, useEstr } from "@/components/estrategia/shell";
import { Btn, Card, Pill } from "@/components/estrategia/ui";

// Etapa 351: Configurações → Acessos. Cada pessoa entra com o próprio e-mail e uma senha provisória;
// no primeiro login é obrigada a criar a dela. Gestores: um acesso por gestor cadastrado em Gestores.
// Estrategistas (só o master vê): carteira própria, com contas, gestores e WhatsApp dele.

type Role = "master" | "estrategista" | "gestor";
interface Member {
  user_id: string;
  owner_id: string;
  role: Role;
  email: string;
  display_name: string | null;
  must_change_password: boolean;
  disabled: boolean;
}

const inputCls = "h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-sm dark:border-white/10 dark:bg-[#141924]";

async function call(body: Record<string, unknown>) {
  const d = await fetch("/api/acessos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  if (d.error) throw new Error(d.error);
  return d as { ok: true; email?: string; password?: string };
}

function Senha({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const texto = `Acesso ao Hub: https://trafic-insight-hub.vercel.app\nE-mail: ${email}\nSenha provisória: ${password}\nNo primeiro acesso, o sistema pede pra você criar a sua senha.`;
  return (
    <div className="rounded-lg border border-emerald-400/50 bg-emerald-500/10 p-3 text-sm">
      <div className="font-semibold text-emerald-800 dark:text-emerald-300">Acesso pronto — anote ou envie agora</div>
      <div className="mt-1 text-zinc-700 dark:text-zinc-300">
        E-mail: <b>{email}</b> · Senha provisória: <b className="font-mono">{password}</b>
      </div>
      <div className="mt-1 text-xs text-zinc-500">Essa senha não aparece de novo. Se perder, gere uma nova.</div>
      <div className="mt-2 flex gap-2">
        <Btn
          small
          primary
          onClick={() =>
            void navigator.clipboard.writeText(texto).then(() => {
              setCopiado(true);
              setTimeout(() => setCopiado(false), 2000);
            })
          }
        >
          {copiado ? "Copiado ✓" : "Copiar mensagem pro WhatsApp"}
        </Btn>
        <Btn small onClick={onClose}>
          Fechar
        </Btn>
      </div>
    </div>
  );
}

function Status({ m }: { m: Member }) {
  if (m.disabled) return <Pill tone="off">Desativado</Pill>;
  if (m.must_change_password) return <Pill tone="warn">Aguardando 1º acesso</Pill>;
  return <Pill tone="ok">Ativo</Pill>;
}

function Acoes({ m, busy, run }: { m: Member; busy: boolean; run: (body: Record<string, unknown>, confirmMsg?: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Btn small disabled={busy} onClick={() => run({ action: "nova-senha", userId: m.user_id })}>
        Nova senha provisória
      </Btn>
      <Btn small disabled={busy} onClick={() => run({ action: m.disabled ? "ativar" : "desativar", userId: m.user_id })}>
        {m.disabled ? "Reativar" : "Desativar"}
      </Btn>
      {m.role === "gestor" ? (
        confirm ? (
          <>
            <span className="text-xs text-zinc-500">Apagar o login? As contas continuam com ele como responsável.</span>
            <Btn small onClick={() => setConfirm(false)}>
              Cancelar
            </Btn>
            <button
              onClick={() => run({ action: "remover", userId: m.user_id })}
              disabled={busy}
              className="h-7 rounded-lg bg-red-600 px-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Apagar login
            </button>
          </>
        ) : (
          <Btn small disabled={busy} onClick={() => setConfirm(true)}>
            Apagar login
          </Btn>
        )
      ) : null}
    </div>
  );
}

export default function AcessosPage() {
  const { gestoresFull } = useEstr();
  const [me, setMe] = useState<{ role: Role; email: string; userId: string } | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [senha, setSenha] = useState<{ email: string; password: string } | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [novoEstr, setNovoEstr] = useState({ name: "", email: "" });

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/acessos", { cache: "no-store" }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      setMe(d.me);
      setMembers(d.members);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega a lista ao abrir a tela
    void load();
  }, [load]);

  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call(body);
      if (r.password && r.email) setSenha({ email: r.email, password: r.password });
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const meusGestores = (members ?? []).filter((m) => m.role === "gestor" && (!me || m.owner_id === me.userId));
  const porNome = new Map(meusGestores.map((m) => [(m.display_name ?? "").trim().toLowerCase(), m]));
  const estrategistas = (members ?? []).filter((m) => m.role === "estrategista");
  const semCadastro = meusGestores.filter((m) => !gestoresFull.some((g) => g.name.trim().toLowerCase() === (m.display_name ?? "").trim().toLowerCase()));

  return (
    <div className="flex flex-col">
      <PageHeader title="Acessos" sub="Quem entra no Hub — cada pessoa com o próprio e-mail e senha" noFilter />
      <div className="flex max-w-4xl flex-col gap-4 p-4 lg:p-6">
        {error ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div> : null}
        {senha ? <Senha email={senha.email} password={senha.password} onClose={() => setSenha(null)} /> : null}

        <Card>
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-white/10">
            <div className="font-semibold">Gestores</div>
            <div className="text-xs text-zinc-500">
              O gestor vê só as contas em que ele é o Responsável. Não vê Feedback, Disparos, Configurações, Alertas nem a ficha do cliente.
            </div>
          </div>
          {members == null ? (
            <div className="p-4 text-sm text-zinc-500">Carregando…</div>
          ) : gestoresFull.length === 0 ? (
            <div className="p-4 text-sm text-zinc-500">Cadastre os gestores na aba Gestores primeiro.</div>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-white/10">
              {gestoresFull.map((g) => {
                const m = porNome.get(g.name.trim().toLowerCase());
                return (
                  <li key={g.name} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-[140px] flex-1">
                      <div className="font-semibold">{g.name}</div>
                      <div className="text-xs text-zinc-500">{m ? m.email : "sem acesso"}</div>
                    </div>
                    {m ? (
                      <>
                        <Status m={m} />
                        <Acoes m={m} busy={busy} run={(b) => void run(b)} />
                      </>
                    ) : (
                      <div className="flex w-full gap-2 sm:w-auto">
                        <input
                          type="email"
                          aria-label={`E-mail de ${g.name}`}
                          placeholder="e-mail do gestor"
                          value={emails[g.name] ?? ""}
                          onChange={(e) => setEmails((cur) => ({ ...cur, [g.name]: e.target.value }))}
                          className={`${inputCls} sm:w-64`}
                        />
                        <Btn
                          small
                          primary
                          disabled={busy || !(emails[g.name] ?? "").trim()}
                          onClick={() =>
                            void run({ action: "criar", role: "gestor", name: g.name, email: emails[g.name] }).then((ok) => {
                              if (ok) setEmails((cur) => ({ ...cur, [g.name]: "" }));
                            })
                          }
                        >
                          Criar acesso
                        </Btn>
                      </div>
                    )}
                  </li>
                );
              })}
              {semCadastro.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-[140px] flex-1">
                    <div className="font-semibold">{m.display_name}</div>
                    <div className="text-xs text-amber-600 dark:text-amber-400">{m.email} · não está mais na lista de Gestores</div>
                  </div>
                  <Status m={m} />
                  <Acoes m={m} busy={busy} run={(b) => void run(b)} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {me?.role === "master" ? (
          <Card>
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-white/10">
              <div className="font-semibold">Estrategistas</div>
              <div className="text-xs text-zinc-500">
                Carteira própria: as contas, gestores, WhatsApp e token da Meta dele. Não mexe nas Automações (só você).
              </div>
            </div>
            <ul className="divide-y divide-zinc-200 dark:divide-white/10">
              {estrategistas.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-[140px] flex-1">
                    <div className="font-semibold">{m.display_name}</div>
                    <div className="text-xs text-zinc-500">{m.email}</div>
                  </div>
                  <Status m={m} />
                  <Acoes m={m} busy={busy} run={(b) => void run(b)} />
                </li>
              ))}
              <li className="flex flex-wrap items-center gap-2 px-4 py-3">
                <input
                  aria-label="Nome do estrategista"
                  placeholder="Nome"
                  value={novoEstr.name}
                  onChange={(e) => setNovoEstr((c) => ({ ...c, name: e.target.value }))}
                  className={`${inputCls} sm:w-48`}
                />
                <input
                  type="email"
                  aria-label="E-mail do estrategista"
                  placeholder="e-mail"
                  value={novoEstr.email}
                  onChange={(e) => setNovoEstr((c) => ({ ...c, email: e.target.value }))}
                  className={`${inputCls} sm:w-64`}
                />
                <Btn
                  small
                  primary
                  disabled={busy || !novoEstr.name.trim() || !novoEstr.email.trim()}
                  onClick={() =>
                    void run({ action: "criar", role: "estrategista", ...novoEstr }).then((ok) => {
                      if (ok) setNovoEstr({ name: "", email: "" });
                    })
                  }
                >
                  Criar estrategista
                </Btn>
              </li>
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
