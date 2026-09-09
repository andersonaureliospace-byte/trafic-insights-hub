"use client";

import { InlineNumber } from "@/components/painel/inline-number";
import { WhatsappGroupCell } from "@/components/painel/whatsapp-group-cell";

interface EditableBinding {
  cpa_target: number | null;
  monthly_investment: number | null;
  wa_group_id: string | null;
  wa_group_name: string | null;
}

// Modal de edição do cliente — tira Meta CPA / Meta de Investimento / Grupo
// WhatsApp da tabela principal de Acompanhamento (pedido explícito: não
// mostrar esses 3 campos na tela inicial). Cada campo salva sozinho ao
// perder o foco (ou ao escolher o grupo), igual já funcionava inline antes.
export function EditClientDialog({
  open,
  onClose,
  accountId,
  clientName,
  binding,
  onPatch,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string | null;
  clientName: string;
  binding: EditableBinding | undefined;
  onPatch: (accountId: string, patch: Partial<EditableBinding>) => Promise<void>;
}) {
  if (!open || !accountId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Editar {clientName}</h3>

        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm text-zinc-600 dark:text-zinc-300">Meta CPA</label>
            <InlineNumber value={binding?.cpa_target ?? null} onSave={(v) => onPatch(accountId, { cpa_target: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm text-zinc-600 dark:text-zinc-300">Meta de investimento (mensal)</label>
            <InlineNumber
              value={binding?.monthly_investment ?? null}
              onSave={(v) => onPatch(accountId, { monthly_investment: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm text-zinc-600 dark:text-zinc-300">Grupo WhatsApp</label>
            <WhatsappGroupCell
              groupId={binding?.wa_group_id ?? null}
              groupName={binding?.wa_group_name ?? null}
              onChange={(g) => void onPatch(accountId, { wa_group_id: g?.id ?? null, wa_group_name: g?.name ?? null })}
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
