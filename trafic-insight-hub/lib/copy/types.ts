// Etapa 70: tipos compartilhados do Gerador de Copy (IVS) entre as rotas de
// API e a tela components/painel/copy-tab.tsx.

export type CopyCategory = "geral" | "promocao" | "exames" | "inauguracao";

export const COPY_CATEGORIES: { id: CopyCategory; label: string }[] = [
  { id: "geral", label: "Geral" },
  { id: "promocao", label: "Promoção" },
  { id: "exames", label: "Exames" },
  { id: "inauguracao", label: "Inauguração" },
];

export interface CopyExtraField {
  key: string;
  label: string;
}

export interface CopySubcategory {
  id: string;
  category: CopyCategory;
  name: string;
  extra_fields: CopyExtraField[];
  // Etapa 70 (ajuste): fixados na subcategoria (perguntados só na criação),
  // não mais digitados a cada geração. oferta vazia = IA infere pelos
  // modelos de referência; condicao/tom vazios = usam os defaults abaixo.
  oferta: string;
  condicao: string;
  tom: string;
  // Subcategoria que não pode ser apagada/renomeada pela tela (hoje só
  // "Geral + Neutro").
  fixed: boolean;
  sort_order: number | null;
}

// Defaults aplicados quando a subcategoria deixa Condição/Tom em branco —
// usados tanto na geração (app/api/copy/generate/route.ts) quanto na tela,
// como placeholder do formulário de criar subcategoria.
export const DEFAULT_CONDICAO_TEXT = "*Consulte condições, disponibilidade e regulamento na unidade.";
export const DEFAULT_TOM = "neutro";

export interface CopyReferenceModel {
  id: string;
  subcategory_id: string;
  endereco_exemplo: string;
  copy: string;
  oferta: string;
  cta: string;
  condicao: string;
}

// As 4 partes que a IA gera de fato — o Endereço não entra aqui porque vem
// direto do cadastro do cliente (account_bindings.address), sempre igual
// nas 5 variações.
export interface CopyVariation {
  copy: string;
  oferta: string;
  cta: string;
  condicao: string;
}

export interface CopyGeneration {
  id: string;
  ad_account_id: string;
  subcategory_id: string | null;
  category: CopyCategory;
  subcategory_name: string;
  address: string;
  extra_field_values: Record<string, string>;
  variations: CopyVariation[];
  created_at: string;
}
