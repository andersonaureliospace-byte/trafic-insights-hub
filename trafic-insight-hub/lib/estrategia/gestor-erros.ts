// Etapa 302: histórico de erros dos gestores (Configurações → Gestores).
// Guardado em user_ui_prefs, chave "gestor_erros" — lista de registros, mais novo primeiro.
// Entra sozinho quando a automação acha (expansão/Brasil inteiro e WhatsApp trocado) e dá pra lançar/apagar à mão.
import type { SupabaseClient } from "@supabase/supabase-js";

export const GESTOR_ERROS_KEY = "gestor_erros";
export const GESTOR_ERROS_MAX = 2000;

export const ERRO_TIPOS = {
  brasil_expansao: "Campanha a nível Brasil ou expansão habilitada",
  whatsapp: "Campanha com o WhatsApp trocado",
} as const;
export type ErroTipo = keyof typeof ERRO_TIPOS;

export interface GestorErro {
  id: string;
  gestor: string | null; // responsável pela conta quando o erro aconteceu
  contaId: string | null; // sem act_
  conta: string; // nome da conta
  tipo: ErroTipo;
  quando: string; // ISO
  origem: "time" | "automacao";
  detalhe?: string; // conjunto / número etc.
  chave?: string; // evita registrar o mesmo achado da automação duas vezes
}

export function normalizeErros(raw: unknown): GestorErro[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is GestorErro => !!e && typeof e === "object" && typeof (e as GestorErro).id === "string" && (e as GestorErro).tipo in ERRO_TIPOS);
}

export const novoId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

type Achado = { check: string; acc: { id: string; name: string; responsible: string | null }; line: string; dedupe?: string };

// Chamado pela auditoria depois da rodada de expansão/WhatsApp. Ignora "ficha sem WhatsApp" (não é erro do gestor).
export async function registrarErrosAutomacao(db: SupabaseClient, userId: string, achados: Achado[]): Promise<number> {
  const novos = achados
    .filter((f) => (f.check === "expansao" || f.check === "whatsapp") && !(f.dedupe ?? "").startsWith("whatsapp-ficha"));
  if (novos.length === 0) return 0;
  const { data } = await db.from("user_ui_prefs").select("pref_value").eq("user_id", userId).eq("pref_key", GESTOR_ERROS_KEY).maybeSingle();
  const atual = normalizeErros(data?.pref_value);
  const vistos = new Set(atual.map((e) => e.chave).filter(Boolean));
  const agora = new Date().toISOString();
  const add: GestorErro[] = [];
  for (const f of novos) {
    const chave = f.dedupe ?? `${f.check}:${f.acc.id}:${f.line}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    add.push({
      id: novoId(),
      gestor: f.acc.responsible,
      contaId: f.acc.id,
      conta: f.acc.name,
      tipo: f.check === "whatsapp" ? "whatsapp" : "brasil_expansao",
      quando: agora,
      origem: "automacao",
      detalhe: f.line.slice(0, 300),
      chave,
    });
  }
  if (add.length === 0) return 0;
  const next = [...add, ...atual].slice(0, GESTOR_ERROS_MAX);
  await db.from("user_ui_prefs").upsert({ user_id: userId, pref_key: GESTOR_ERROS_KEY, pref_value: next }, { onConflict: "user_id,pref_key" });
  return add.length;
}
