// Etapa 113: manda a prioridade (status) dos clientes direto pro Asana, sem passar pelo Claude.
//
// Projeto "ESTRATEGISTA SPEED DIGITAL", seção "Anderson - (Denner)": cada tarefa é um cliente e
// o campo personalizado "Prioridade" (single-select) recebe o status do Trafic Insight Hub.
// Só mexe nesse campo, só em tarefas dessa seção, e só quando o valor atual é diferente.
//
// Precisa da variável ASANA_ACCESS_TOKEN (Personal Access Token do Asana) na Vercel. Sem ela,
// a sincronização fica desligada e nada acontece (não dá erro).

const ASANA_API = "https://app.asana.com/api/1.0";

// GIDs do workspace do Anderson (os mesmos da skill asana-speed).
export const ASANA_SECTION_GID = "1215678225685772"; // Anderson - (Denner)
export const ASANA_PRIORITY_FIELD_GID = "1208798639166832"; // campo "Prioridade"

// IDs de prioridade do app -> opção do campo no Asana. "inauguracao" fica de fora de propósito
// (as opções INAUG - * dependem de ALTA/MÉDIA/BAIXA e a automação não mexe em inauguração).
export const ASANA_PRIORITY_OPTIONS: Record<string, string> = {
  baixa: "1208798639166834", // Baixa
  media: "1208798639166835", // Médio
  alta: "1208798639166833", // Alta
  critica: "1212345107704975", // Alta - Crítica
};

export interface AsanaSyncItem {
  clientName: string;
  priority: string; // baixa | media | alta | critica
}

export interface AsanaSyncSummary {
  configured: boolean;
  updated: string[]; // clientes cuja prioridade foi trocada no Asana
  unchanged: number; // já estavam certos
  notFound: string[]; // sem tarefa com esse nome na seção
  ambiguous: string[]; // mais de uma tarefa plausível (não mexeu)
  errors: string[];
}

export function asanaConfigured(): boolean {
  return Boolean(process.env.ASANA_ACCESS_TOKEN);
}

// Sem maiúsculas, sem acento, sem pontuação (hífen, parênteses, colchetes) e sem espaços sobrando
// (o Asana tem nomes com espaço no fim). Assim "IVS BLUMENAU(P)" = "IVS BLUMENAU - P" e
// "IVS - ITAPETININGA" = "IVS ITAPETININGA".
export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface AsanaTask {
  gid: string;
  name: string;
  notes?: string;
  html_notes?: string;
  custom_fields?: Array<{ gid: string; enum_value?: { gid: string } | null }>;
}

export async function asanaFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${ASANA_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as { errors?: Array<{ message?: string }> };
  if (!res.ok) throw new Error(json.errors?.[0]?.message ?? `Asana respondeu ${res.status}`);
  return json;
}

export async function listSectionTasks(
  optFields = "name,custom_fields.gid,custom_fields.enum_value.gid",
): Promise<AsanaTask[]> {
  const tasks: AsanaTask[] = [];
  let offset: string | null = null;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({
      limit: "100",
      opt_fields: optFields,
    });
    if (offset) qs.set("offset", offset);
    const json = (await asanaFetch(`/sections/${ASANA_SECTION_GID}/tasks?${qs}`)) as {
      data?: AsanaTask[];
      next_page?: { offset?: string } | null;
    };
    tasks.push(...(json.data ?? []));
    offset = json.next_page?.offset ?? null;
    if (!offset) break;
  }
  return tasks;
}

// Acha a tarefa do cliente: nome igual (normalizado) primeiro; senão, um único nome que contenha
// o outro. Zero ou mais de um candidato = não chuta (devolve null + motivo).
export function matchTask(
  clientName: string,
  tasks: Array<{ gid: string; name: string }>,
): { task: { gid: string; name: string } | null; reason?: "notFound" | "ambiguous" } {
  const n = normName(clientName);
  if (!n) return { task: null, reason: "notFound" };
  const exact = tasks.filter((t) => normName(t.name) === n);
  if (exact.length === 1) return { task: exact[0] };
  if (exact.length > 1) return { task: null, reason: "ambiguous" };
  const partial = tasks.filter((t) => {
    const tn = normName(t.name);
    return tn.includes(n) || n.includes(tn);
  });
  if (partial.length === 1) return { task: partial[0] };
  return { task: null, reason: partial.length > 1 ? "ambiguous" : "notFound" };
}

export async function syncAsanaPriorities(items: AsanaSyncItem[]): Promise<AsanaSyncSummary> {
  const summary: AsanaSyncSummary = { configured: asanaConfigured(), updated: [], unchanged: 0, notFound: [], ambiguous: [], errors: [] };
  if (!summary.configured) return summary;

  const wanted = items.filter((i) => ASANA_PRIORITY_OPTIONS[i.priority] && i.clientName.trim());
  if (wanted.length === 0) return summary;

  let tasks: AsanaTask[];
  try {
    tasks = await listSectionTasks();
  } catch (e) {
    summary.errors.push(`Não consegui ler a seção no Asana: ${(e as Error).message}`);
    return summary;
  }

  for (const item of wanted) {
    const { task, reason } = matchTask(item.clientName, tasks);
    if (!task) {
      (reason === "ambiguous" ? summary.ambiguous : summary.notFound).push(item.clientName);
      continue;
    }
    const optionGid = ASANA_PRIORITY_OPTIONS[item.priority];
    const full = tasks.find((t) => t.gid === task.gid);
    const current = full?.custom_fields?.find((f) => f.gid === ASANA_PRIORITY_FIELD_GID)?.enum_value?.gid ?? null;
    if (current === optionGid) {
      summary.unchanged++;
      continue;
    }
    try {
      await asanaFetch(`/tasks/${task.gid}`, {
        method: "PUT",
        body: JSON.stringify({ data: { custom_fields: { [ASANA_PRIORITY_FIELD_GID]: optionGid } } }),
      });
      summary.updated.push(item.clientName);
    } catch (e) {
      summary.errors.push(`${item.clientName}: ${(e as Error).message}`);
    }
  }
  return summary;
}

// Texto curto pro alerta/tela.
export function describeAsanaSync(s: AsanaSyncSummary): string {
  if (!s.configured) return "Asana: não configurado (falta ASANA_ACCESS_TOKEN na Vercel).";
  const parts = [`Asana: ${s.updated.length} atualizado(s), ${s.unchanged} já estava(m) certo(s)`];
  if (s.notFound.length) parts.push(`sem tarefa com esse nome: ${s.notFound.join(", ")}`);
  if (s.ambiguous.length) parts.push(`mais de uma tarefa parecida (não mexi): ${s.ambiguous.join(", ")}`);
  if (s.errors.length) parts.push(`erros: ${s.errors.join("; ")}`);
  return parts.join(" · ");
}
