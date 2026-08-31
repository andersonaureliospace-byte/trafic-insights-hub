import { createServiceClient } from "@/lib/supabase/server";
import { getAccountInsight } from "@/lib/meta/insights";
import { getAccountsDailyCpa } from "@/lib/meta/daily-cpa";
import { fmtCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PublicDashboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createServiceClient();

  const { data: dashboard } = await supabase
    .from("public_dashboards")
    .select("user_id, ad_account_id, account_name")
    .eq("public_token", token)
    .maybeSingle();

  if (!dashboard) {
    return <InvalidLink />;
  }

  const { data: cred } = await supabase
    .from("user_meta_credentials")
    .select("access_token")
    .eq("user_id", dashboard.user_id)
    .maybeSingle();
  const accessToken = cred?.access_token as string | undefined;

  const { data: binding } = await supabase
    .from("account_bindings")
    .select("client_name, cpa_target, monthly_investment")
    .eq("user_id", dashboard.user_id)
    .eq("ad_account_id", dashboard.ad_account_id)
    .maybeSingle();

  const accountName = binding?.client_name || dashboard.account_name || dashboard.ad_account_id;

  if (!accessToken) {
    return <InvalidLink message="Essa conta ainda não tem uma integração com o Meta configurada." />;
  }

  let insight: Awaited<ReturnType<typeof getAccountInsight>> | null = null;
  let daily: Awaited<ReturnType<typeof getAccountsDailyCpa>>[string] = [];
  let loadError: string | null = null;
  try {
    insight = await getAccountInsight(accessToken, dashboard.ad_account_id, "last_7d");
    const dailyMap = await getAccountsDailyCpa(accessToken, [dashboard.ad_account_id], 14);
    daily = dailyMap[dashboard.ad_account_id] ?? [];
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Não foi possível carregar os dados agora.";
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-4xl px-4 py-10 md:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
          Trafic Insight Hub · Dashboard público
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{accountName}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Últimos 7 dias.</p>

        {loadError ? (
          <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {loadError}
          </div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Investido" value={fmtCurrency(insight?.spend ?? 0)} />
              <Kpi label="Resultados" value={insight?.results ? String(Math.round(insight.results)) : "—"} />
              <Kpi label="CPA" value={fmtCurrency(insight?.cost_per_result)} />
              <Kpi label="Meta de CPA" value={fmtCurrency(binding?.cpa_target ?? null)} />
            </div>

            {binding?.monthly_investment ? (
              <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
                Investimento mensal combinado: <strong className="text-zinc-700 dark:text-zinc-300">{fmtCurrency(binding.monthly_investment)}</strong>
              </p>
            ) : null}

            <div className="mt-8 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Últimos 14 dias</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                      <th className="px-4 py-2 font-medium">Data</th>
                      <th className="px-4 py-2 text-right font-medium">Investido</th>
                      <th className="px-4 py-2 text-right font-medium">Resultados</th>
                      <th className="px-4 py-2 text-right font-medium">CPA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.map((d) => (
                      <tr key={d.date} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                        <td className="px-4 py-2 text-zinc-500 dark:text-zinc-400">
                          {new Date(`${d.date}T12:00:00`).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(d.spend)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{d.results ? Math.round(d.results) : "—"}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(d.cpa)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <p className="mt-10 text-center text-xs text-zinc-400">Trafic Insight Hub</p>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</p>
    </div>
  );
}

function InvalidLink({ message }: { message?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Link inválido</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {message ?? "Esse link público não existe mais ou foi removido."}
        </p>
      </div>
    </div>
  );
}
