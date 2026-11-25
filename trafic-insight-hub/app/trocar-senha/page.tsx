"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

// Etapa 351: primeiro acesso — a pessoa entrou com a senha provisória e precisa criar a própria antes de usar o Hub.
export default function TrocarSenhaPage() {
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== password2) return setError("As senhas não conferem.");
    setLoading(true);
    try {
      const d = await fetch("/api/acessos/trocar-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }).then((r) => r.json());
      if (d.error) throw new Error(d.error);
      // renova a sessão com a marcação nova e abre o Hub
      await createClient().auth.refreshSession().catch(() => {});
      // recarga completa de propósito: o proxy precisa ver a sessão já sem a senha provisória
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/estrategia/trafego";
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  async function sair() {
    await createClient().auth.signOut();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

  const inputCls =
    "rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100";

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Crie sua senha</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Você entrou com uma senha provisória. Antes de continuar, crie uma senha só sua (mínimo 8 caracteres).
        </p>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Nova senha
            </label>
            <input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password2" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Repita a nova senha
            </label>
            <input id="password2" type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} className={inputCls} />
          </div>
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {loading ? "Salvando…" : "Salvar e entrar"}
          </button>
          <button type="button" onClick={() => void sair()} className="text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200">
            Sair
          </button>
        </form>
      </div>
    </div>
  );
}
