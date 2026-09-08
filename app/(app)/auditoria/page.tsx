import { LocationAudit } from "@/components/auditoria/location-audit";
import { ErrorAudit } from "@/components/auditoria/error-audit";

export default function AuditoriaPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8">
      <h1 className="mb-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">Auditoria</h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        Verificações automáticas de configuração das contas — a verificação pausa sozinha o que
        encontrar de errado.
      </p>

      <div className="flex flex-col gap-4">
        <LocationAudit />
        <ErrorAudit />
      </div>
    </div>
  );
}
