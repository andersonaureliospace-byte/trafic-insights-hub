-- Trafic Insight Hub — schema inicial (instância única / single-tenant)
-- Todas as tabelas usam user_id = auth.uid() via RLS. Como é um único usuário,
-- isso funciona só como trava de segurança extra (ex.: se um dia você criar
-- um segundo login de leitura), não como sistema multi-cliente.

create extension if not exists pgcrypto;

-- ========== Contas & métricas ==========

create table user_meta_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token text not null default '',
  default_ad_account_id text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table user_selected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, ad_account_id)
);

-- Tabela central: liga cada conta de anúncio a um cliente, metas e grupo de WhatsApp.
create table account_bindings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  client_name text not null default '',
  cpa_target numeric,
  monthly_investment numeric,
  daily_investment_target numeric,
  priority text,
  wa_group_id text,
  wa_group_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ad_account_id)
);

create table pix_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  payment_type text not null default 'prepaid' check (payment_type in ('prepaid', 'postpaid', 'hybrid')),
  base_amount numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ad_account_id)
);

-- Preferências livres de UI (grupos de foco, status configuráveis, colunas etc.)
create table user_ui_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pref_key text not null,
  pref_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, pref_key)
);

create table meta_insights_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cache_key text not null,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, cache_key)
);

create table meta_api_call_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  status_code int,
  created_at timestamptz not null default now()
);

-- ========== WhatsApp (uazapi) ==========

create table whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'principal',
  api_url text not null,
  token text not null,
  status text not null default 'disconnected',
  alerts_group_id text,
  alerts_group_name text,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table whatsapp_message_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  body text not null,
  media_path text,
  media_type text check (media_type in ('image', 'video', 'audio', 'document')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table whatsapp_scheduled_dispatches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message text not null,
  targets jsonb not null default '[]'::jsonb, -- [{ad_account_id, client_name, wa_group_id, wa_group_name}]
  scheduled_at timestamptz not null,
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  recurrence_config jsonb,
  media_path text,
  media_type text check (media_type in ('image', 'video', 'audio', 'document')),
  media_filename text,
  media_mime text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table whatsapp_scheduled_dispatch_runs (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references whatsapp_scheduled_dispatches(id) on delete cascade,
  ran_at timestamptz not null default now(),
  status text not null,
  detail jsonb
);

-- ========== Auditoria ==========

create table audit_location_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  adset_id text not null,
  adset_name text,
  status text not null, -- ex: 'brasil_sem_restricao' | 'expansao_ligada' | 'ok'
  detail jsonb,
  checked_at timestamptz not null default now(),
  unique (user_id, adset_id)
);

create table audit_error_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  entity_type text not null check (entity_type in ('campaign', 'adset', 'ad')),
  entity_id text not null,
  entity_name text,
  error_message text not null,
  checked_at timestamptz not null default now(),
  unique (user_id, entity_id, error_message)
);

-- ========== Relatórios ==========

create table report_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  body text not null,
  period_preset text not null default 'yesterday',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table scheduled_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid references report_templates(id) on delete set null,
  ad_account_ids jsonb not null default '[]'::jsonb,
  wa_group_id text,
  wa_group_name text,
  send_time time not null default '08:00',
  recurrence text not null default 'daily' check (recurrence in ('daily', 'weekly', 'monthly')),
  recurrence_config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table scheduled_report_runs (
  id uuid primary key default gen_random_uuid(),
  scheduled_report_id uuid not null references scheduled_reports(id) on delete cascade,
  ran_at timestamptz not null default now(),
  status text not null,
  detail jsonb
);

-- ========== Links públicos ==========

create table public_dashboards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  account_name text,
  public_token text not null default encode(gen_random_bytes(18), 'base64url'),
  created_at timestamptz not null default now(),
  unique (public_token)
);

-- ========== CRM ==========

create table crm_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  public_token text not null default encode(gen_random_bytes(18), 'base64url'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (public_token)
);

create table crm_leads (
  id uuid primary key default gen_random_uuid(),
  crm_instance_id uuid not null references crm_instances(id) on delete cascade,
  name text not null,
  phone text,
  status text not null default 'novo',
  source jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table crm_lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm_leads(id) on delete cascade,
  event_type text not null default 'status_change',
  from_status text,
  to_status text,
  note text,
  created_at timestamptz not null default now()
);

create table crm_sale_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references crm_leads(id) on delete cascade,
  payload jsonb not null,
  status text not null default 'pending',
  delivered_at timestamptz
);

-- ========== RLS ==========
-- Tabelas de dado próprio: só o dono (auth.uid()) lê/escreve.
-- Tabelas dependentes de crm_instances/whatsapp_scheduled_dispatches/scheduled_reports
-- herdam a trava via join na tabela pai.
-- Leitura pelos links públicos (/d/:token e /c/:token) acontece nas Route Handlers
-- do Next.js usando a service role key (não pelo cliente anon do navegador) —
-- por isso essas tabelas não precisam de política "public".

alter table user_meta_credentials enable row level security;
alter table user_selected_accounts enable row level security;
alter table account_bindings enable row level security;
alter table pix_accounts enable row level security;
alter table user_ui_prefs enable row level security;
alter table meta_insights_cache enable row level security;
alter table meta_api_call_log enable row level security;
alter table whatsapp_instances enable row level security;
alter table whatsapp_message_templates enable row level security;
alter table whatsapp_scheduled_dispatches enable row level security;
alter table audit_location_status enable row level security;
alter table audit_error_status enable row level security;
alter table report_templates enable row level security;
alter table scheduled_reports enable row level security;
alter table public_dashboards enable row level security;
alter table crm_instances enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'user_meta_credentials', 'user_selected_accounts', 'account_bindings',
    'pix_accounts', 'user_ui_prefs', 'meta_insights_cache', 'meta_api_call_log',
    'whatsapp_instances', 'whatsapp_message_templates', 'whatsapp_scheduled_dispatches',
    'audit_location_status', 'audit_error_status', 'report_templates',
    'scheduled_reports', 'public_dashboards', 'crm_instances'
  ]
  loop
    execute format(
      'create policy "owner_all_%1$s" on %1$s for all using (user_id = auth.uid()) with check (user_id = auth.uid());',
      t
    );
  end loop;
end $$;

-- Tabelas filhas: RLS via join na tabela pai.
alter table whatsapp_scheduled_dispatch_runs enable row level security;
create policy "owner_all_whatsapp_scheduled_dispatch_runs" on whatsapp_scheduled_dispatch_runs
  for all using (
    exists (select 1 from whatsapp_scheduled_dispatches d where d.id = dispatch_id and d.user_id = auth.uid())
  );

alter table scheduled_report_runs enable row level security;
create policy "owner_all_scheduled_report_runs" on scheduled_report_runs
  for all using (
    exists (select 1 from scheduled_reports r where r.id = scheduled_report_id and r.user_id = auth.uid())
  );

alter table crm_leads enable row level security;
create policy "owner_all_crm_leads" on crm_leads
  for all using (
    exists (select 1 from crm_instances c where c.id = crm_instance_id and c.user_id = auth.uid())
  );

alter table crm_lead_events enable row level security;
create policy "owner_all_crm_lead_events" on crm_lead_events
  for all using (
    exists (
      select 1 from crm_leads l join crm_instances c on c.id = l.crm_instance_id
      where l.id = lead_id and c.user_id = auth.uid()
    )
  );

alter table crm_sale_webhook_deliveries enable row level security;
create policy "owner_all_crm_sale_webhook_deliveries" on crm_sale_webhook_deliveries
  for all using (
    exists (
      select 1 from crm_leads l join crm_instances c on c.id = l.crm_instance_id
      where l.id = lead_id and c.user_id = auth.uid()
    )
  );
