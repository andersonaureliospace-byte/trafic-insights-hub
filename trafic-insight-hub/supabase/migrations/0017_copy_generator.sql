-- Etapa 70: Gerador de Copy (Instituto Visão Solidária) — franquia de ótica
-- com centenas de unidades, ofertas praticamente iguais entre elas (só muda
-- o endereço). Categorias são fixas no código (geral/promocao/exames/
-- inauguracao) — o check abaixo trava exatamente essas 4. Subcategorias
-- (ex.: "Cobrimos oferta", "Armação por 1 real") o usuário cria/renomeia/
-- apaga livremente, uma tela de config comum. `extra_fields` guarda campos
-- extras específicos de uma subcategoria (ex.: Inauguração precisa de "Data
-- da inauguração"; Inauguração + Exame precisa também do "Valor do exame")
-- como um array [{"key":"...", "label":"..."}] — evita ter que alterar
-- código toda vez que aparecer mais um campo assim; a tela de gerar copy
-- monta os inputs a partir desse array.
create table copy_subcategories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('geral', 'promocao', 'exames', 'inauguracao')),
  name text not null,
  extra_fields jsonb not null default '[]',
  sort_order integer,
  created_at timestamptz not null default now()
);

create index copy_subcategories_user_id_idx on copy_subcategories (user_id);

alter table copy_subcategories enable row level security;
create policy "owner_all_copy_subcategories" on copy_subcategories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Dataset de referência (few-shot) por subcategoria — exemplos reais de
-- copy do IVS, usados só pra ensinar o padrão pra IA (gancho + oferta +
-- reforço + tagline da marca + CTA + condição). `endereco_exemplo` é só
-- ilustrativo (o endereço de verdade na geração vem do cadastro do
-- cliente em Clientes/account_bindings.address).
create table copy_reference_models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subcategory_id uuid not null references copy_subcategories(id) on delete cascade,
  endereco_exemplo text not null default '',
  copy text not null default '',
  oferta text not null default '',
  cta text not null default '',
  condicao text not null default '',
  sort_order integer,
  created_at timestamptz not null default now()
);

create index copy_reference_models_subcategory_id_idx on copy_reference_models (subcategory_id);

alter table copy_reference_models enable row level security;
create policy "owner_all_copy_reference_models" on copy_reference_models
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Histórico de gerações por cliente (pedido explícito: "quer histórico de
-- copies agrupado por cliente"). `category`/`subcategory_name` ficam
-- duplicados aqui (não só o id) pra o histórico continuar legível mesmo se
-- a subcategoria for renomeada ou apagada depois (por isso o "on delete set
-- null" em subcategory_id, sem cascade).
create table copy_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  subcategory_id uuid references copy_subcategories(id) on delete set null,
  category text not null,
  subcategory_name text not null,
  address text not null default '',
  extra_field_values jsonb not null default '{}',
  variations jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index copy_generations_user_account_idx on copy_generations (user_id, ad_account_id);

alter table copy_generations enable row level security;
create policy "owner_all_copy_generations" on copy_generations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
