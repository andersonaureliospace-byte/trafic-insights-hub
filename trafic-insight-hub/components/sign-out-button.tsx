"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Etapa 352: vários acessos no mesmo navegador — apaga os números guardados de quem saiu
    // (senão quem entrar depois veria, por um instante, a carteira do anterior)
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("estr_")) localStorage.removeItem(k);
    } catch {
      /* sem armazenamento */
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      Sair
    </button>
  );
}
