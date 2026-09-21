import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { generateCopyVariations } from "@/lib/ai/gemini";
import {
  COPY_CATEGORIES,
  DEFAULT_CONDICAO_TEXT,
  DEFAULT_TOM,
  type CopyCategory,
  type CopyExtraField,
} from "@/lib/copy/types";

// Etapa 70: gera as 5 variações de copy pra um cliente + subcategoria.
// Endereço/nome do cliente vêm sempre do cadastro (account_bindings) — nunca
// digitados na tela — e cada geração fica salva em copy_generations pra
// formar o histórico por cliente.
//
// Etapa 70 (ajuste): Oferta/Condição/Tom não são mais digitados a cada
// geração — vêm fixados na própria subcategoria (preenchidos na criação).
// Oferta vazia continua deixando a IA inferir o mecanismo pelos modelos de
// referência; Condição/Tom vazios usam os defaults (texto padrão / neutro).
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const ad_account_id = String(body.ad_account_id ?? "").trim();
    const subcategory_id = String(body.subcategory_id ?? "").trim();
    const extraFieldValues = (body.extraFieldValues ?? {}) as Record<string, string>;
    // count/save: usados pra regenerar UMA variação isolada (botão "gerar de
    // novo só essa" na tela) sem criar uma entrada nova no histórico.
    const count = Number(body.count) > 0 ? Number(body.count) : 5;
    const save = body.save !== false;
    if (!ad_account_id) throw new Error("Selecione um cliente.");
    if (!subcategory_id) throw new Error("Selecione uma subcategoria.");

    const { data: binding, error: bindingError } = await supabase
      .from("account_bindings")
      .select("client_name, address")
      .eq("user_id", user.id)
      .eq("ad_account_id", ad_account_id)
      .maybeSingle();
    if (bindingError) throw bindingError;
    const address = ((binding?.address as string | null) ?? "").trim();
    if (!address) {
      throw new Error("Esse cliente não tem endereço cadastrado ainda (Painel → Clientes).");
    }
    const clientName = (binding?.client_name as string | null) ?? null;

    const { data: subcategory, error: subError } = await supabase
      .from("copy_subcategories")
      .select("*")
      .eq("id", subcategory_id)
      .eq("user_id", user.id)
      .single();
    if (subError) throw subError;

    const { data: models, error: modelsError } = await supabase
      .from("copy_reference_models")
      .select("endereco_exemplo, copy, oferta, cta, condicao")
      .eq("subcategory_id", subcategory_id)
      .eq("user_id", user.id)
      .order("sort_order");
    if (modelsError) throw modelsError;

    const extraFields = (subcategory.extra_fields ?? []) as CopyExtraField[];
    const extraFieldsForPrompt = extraFields.map((f) => ({
      label: f.label,
      value: (extraFieldValues[f.key] ?? "").trim(),
    }));
    const missing = extraFieldsForPrompt.find((f) => !f.value);
    if (missing) throw new Error(`Preencha o campo "${missing.label}" antes de gerar.`);

    const categoryLabel =
      COPY_CATEGORIES.find((c) => c.id === (subcategory.category as CopyCategory))?.label ?? subcategory.category;

    const offerText = ((subcategory.oferta as string | null) ?? "").trim();
    const condicao = ((subcategory.condicao as string | null) ?? "").trim() || DEFAULT_CONDICAO_TEXT;
    const tom = ((subcategory.tom as string | null) ?? "").trim() || DEFAULT_TOM;

    const rawVariations = await generateCopyVariations({
      categoryLabel,
      subcategoryName: subcategory.name as string,
      address,
      clientName,
      offerText,
      tom,
      extraFields: extraFieldsForPrompt,
      referenceModels: models ?? [],
      count,
    });

    // Oferta e condição são fixas na subcategoria (quando preenchidas) — a IA
    // não decide isso mais, só escreve o texto criativo em volta.
    const variations = rawVariations.map((v) => ({
      copy: v.copy,
      oferta: offerText || v.oferta,
      cta: v.cta,
      condicao,
    }));

    if (!save) {
      return NextResponse.json({ ok: true, address, variations });
    }

    const { data: saved, error: saveError } = await supabase
      .from("copy_generations")
      .insert({
        user_id: user.id,
        ad_account_id,
        subcategory_id,
        category: subcategory.category,
        subcategory_name: subcategory.name,
        address,
        extra_field_values: extraFieldValues,
        variations,
      })
      .select("*")
      .single();
    if (saveError) throw saveError;

    return NextResponse.json({ ok: true, address, generation: saved });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
