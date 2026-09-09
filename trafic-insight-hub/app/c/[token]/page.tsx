import { createServiceClient } from "@/lib/supabase/server";
import { LEAD_STATUSES, leadStatusLabel } from "@/lib/crm/pipeline";

export const dynamic = "force-dynamic";

interface Lead {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  updated_at: string;
}

export default async function PublicCrmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createServiceClient();

  const { data: instance } = await supabase
    .from("crm_instances")
    .select("id, name")
    .eq("public_token", token)
    .maybeSingle();

  if (!instance) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Link inválido</h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Esse link público não existe mais ou foi removido.
          </p>
        </div>
      </div>
    );
  }

  const { data: leadsData } = await supabase
    .from("crm_leads")
    .select("id, name, phone, status, updated_at")
    .eq("crm_instance_id", instance.id)
    .order("updated_at", { ascending: false });
  const leads = (leadsData ?? []) as Lead[];

  const byStatus: Record<string, Lead[]> = {};
  for (const s of LEAD_STATUSES) byStatus[s.id] = [];
  for (const l of leads) (byStatus[l.status] ?? (byStatus[l.status] = [])).push(l);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
          Trafic Insight Hub · CRM público
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{instance.name}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{leads.length} lead(s) no funil.</p>

        <div className="mt-6 grid grid-cols-1 gap-3 overflow-x-auto sm:grid-cols-2 lg:grid-cols-6">
          {LEAD_STATUSES.map((s) => (
            <div key={s.id} className="min-w-[200px] rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {leadStatusLabel(s.id)} · {byStatus[s.id]?.length ?? 0}
                </h2>
              </div>
              <div className="flex flex-col gap-2 p-2">
                {(byStatus[s.id] ?? []).length === 0 ? (
                  <p className="px-2 py-3 text-xs text-zinc-400">—</p>
                ) : (
                  byStatus[s.id].map((l) => (
                    <div key={l.id} className="rounded-lg border border-zinc-100 bg-zinc-50 p-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
                      <p className="font-medium text-zinc-800 dark:text-zinc-200">{l.name}</p>
                      {l.phone ? <p className="text-zinc-500 dark:text-zinc-400">{l.phone}</p> : null}
                      <p className="mt-1 text-[11px] text-zinc-400">
                        {new Date(l.updated_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-zinc-400">Trafic Insight Hub</p>
      </div>
    </div>
  );
}
