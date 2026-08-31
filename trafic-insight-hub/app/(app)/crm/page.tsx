import { CrmBoard } from "@/components/crm/crm-board";

export default function CrmPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8">
      <h1 className="mb-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">CRM</h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Funil de leads por instância — kanban simples com estágios fixos e link público por token
        pro cliente acompanhar sem login.
      </p>

      <CrmBoard />
    </div>
  );
}
