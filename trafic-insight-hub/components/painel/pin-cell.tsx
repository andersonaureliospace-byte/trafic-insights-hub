"use client";

// Botão "Fixar" das abas Acompanhamento e Acompanhamento de metas (Etapa 86).
// Conta fixada sobe pro topo da tabela, as demais ficam com as métricas
// embaçadas (PIN_BLUR) e o "↻ Atualizar" passa a buscar só as fixadas. A
// fixação fica salva (Supabase, via ui-state do Painel) até o usuário desafixar.

export function PinCell({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={pinned}
      title={
        pinned
          ? "Desafixar — volta pra posição normal e para de focar só nesta conta"
          : "Fixar no topo — foca nesta conta: as outras ficam embaçadas e o Atualizar busca só as fixadas"
      }
      className={`rounded-md border px-2 py-0.5 text-xs font-medium transition-colors ${
        pinned
          ? "border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200"
          : "border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }`}
    >
      {pinned ? "Fixada" : "Fixar"}
    </button>
  );
}

// Métricas das contas NÃO fixadas (quando há alguma fixada): embaçadas, mas
// voltam ao normal enquanto o mouse está na linha (a linha precisa ter `group`).
export const PIN_BLUR =
  "blur-[3px] opacity-50 select-none transition group-hover:blur-0 group-hover:opacity-100 group-hover:select-auto";
