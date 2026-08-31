# Trafic Insight Hub

Painel interno de acompanhamento de tráfego pago (Meta Ads) — reconstrução do
projeto original, agora como instância única (um só login) hospedada na
Vercel, com Supabase, n8n e uazapi (WhatsApp).

Estado atual: **etapas 1 e 2 do plano concluídas** — base do Supabase/login
único, e o Painel já fecha 100%: seletor de "contas exibidas" (só mostra o
que você marcar, nunca todas as contas do seu token), KPIs, Acompanhamento
de Resultados com dados reais da Meta (CPA, valor usado, investimento
diário, Cliente/Meta de CPA/Investimento mensal editáveis), grupos de foco
(agrupar contas e focar a tabela num grupo), atualização de status em massa
(classifica a prioridade pelo CPA dos últimos 3 dias vs. a meta cadastrada),
Controle de Saldo/PIX e Visão Geral por Campanhas/Conjuntos/Anúncios com
pausar/ativar nos 3 níveis. Configurações → Meta e Configurações → WhatsApp
já funcionam de verdade (conectar a instância uazapi via QR ou código de
pareamento, ver status, desconectar, e escolher o grupo que recebe os
avisos de saldo). Mensagens → Envio também já funciona de verdade: escolher
destinatários pelos grupos do WhatsApp (com o nome do cliente vinculado no
Painel), enviar agora, agendar (uma vez ou recorrente) e cancelar
agendamentos — o disparo agendado é efetivado por um hook público que o n8n
chama periodicamente. Auditoria também já funciona de verdade: verificação
de Localização (conjunto ativo com Brasil país inteiro ou expansão de
público ligada) e de Erros de veiculação (anúncio reprovado/restrito/em
análise, ou conjunto ativo sem nenhum anúncio ativo) — o botão "Verificar
agora" roda na hora e pausa sozinho o que encontrar de errado, e um segundo
hook público (`audit-tick`) permite automatizar essa verificação pelo n8n
em intervalos maiores (ex.: a cada 30-60 minutos). CRM também já funciona
de verdade: instâncias de funil com kanban simples (Novo → Em contato →
Qualificado → Proposta → Venda/Perdido), detalhe do lead com histórico, e
ingestão de leads via n8n (hook público `crm-lead-ingest`). Cada instância
tem um link público (`/c/:token`) pro cliente acompanhar sem login, e cada
conta do Painel pode gerar um link público de dashboard (`/d/:token`) —
os dois são somente leitura. Quando um lead entra no estágio "Venda", o
app notifica um webhook do n8n (se configurado na instância) automaticamente.
Mensagens → Relatórios também já funciona de verdade: modelos de relatório
com variáveis (`{cliente}`, `{investido}`, `{resultados}`, `{cpa}`, etc.),
agendamento por conta(s) + grupo do WhatsApp + recorrência (diária/semanal/
mensal), pausar/retomar/excluir — o envio de fato é efetivado por um
terceiro hook público (`report-tick`) chamado pelo n8n. Mensagens → Avisos
e Configurações → Status continuam como placeholder.

⚠️ **Antes de testar o WhatsApp**: essa entrega inclui uma nova migração
(`0002_whatsapp_instance_unique.sql`) — rode ela no SQL Editor do Supabase
(além da 0001, que você já rodou) antes de usar a aba WhatsApp, senão o
"Salvar" das credenciais vai dar erro de conflito.

⚠️ **Pra agendamentos de mensagem realmente saírem**: cadastre a variável
`WHATSAPP_DISPATCH_SECRET` (veja o passo 4) e configure um workflow no n8n
que chame `POST https://SEU_DOMINIO/api/public/hooks/whatsapp-dispatch-tick`
a cada 1 minuto, enviando o mesmo valor no header `x-webhook-secret`. Sem
isso, os agendamentos ficam salvos como "pending" mas nunca são enviados —
o Vercel sozinho não dispara nada por conta própria.

⚠️ **Pra Auditoria rodar sozinha (sem precisar clicar em "Verificar
agora")**: configure um segundo workflow no n8n chamando
`POST https://SEU_DOMINIO/api/public/hooks/audit-tick` com o mesmo header
`x-webhook-secret` (a variável `WHATSAPP_DISPATCH_SECRET` protege os dois
hooks — o nome ficou do WhatsApp, mas hoje é o segredo geral dos hooks
internos do sistema). Sugestão de intervalo: a cada 30-60 minutos — é uma
verificação mais pesada que o tick de mensagens, porque consulta a Graph
API de todas as contas vinculadas.

⚠️ **Pra ingestão automática de leads no CRM (opcional)**: no n8n, quando um
lead novo chegar (formulário, WhatsApp etc.), faça um `POST` pra
`https://SEU_DOMINIO/api/public/hooks/crm-lead-ingest` com o header
`x-webhook-secret` (mesmo valor de `WHATSAPP_DISPATCH_SECRET`) e corpo
`{"public_token": "...", "name": "...", "phone": "...", "source": {...}}`
— o `public_token` é o mesmo do link público da instância (`/c/:token`),
copiável na tela de CRM.

⚠️ **Pra relatórios agendados realmente saírem**: configure um terceiro
workflow no n8n chamando `POST https://SEU_DOMINIO/api/public/hooks/report-tick`
com o mesmo header `x-webhook-secret`, a cada 15-30 minutos (o relatório
sai na primeira checagem depois do horário agendado, não no minuto exato —
por isso não precisa ser tão frequente quanto o tick de mensagens).

## 1. Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) → **New project**.
2. Guarde a senha do banco (Database password) em algum lugar seguro.
3. Depois de criado, vá em **Project Settings → API** e copie:
   - `Project URL`
   - `anon public key`
   - `service_role key` (fica em "Project API keys" — não confundir com a anon)

## 2. Rodar o schema

1. No painel do Supabase, abra **SQL Editor**.
2. Cole o conteúdo de `supabase/migrations/0001_init.sql` e rode.
3. Cole o conteúdo de `supabase/migrations/0002_whatsapp_instance_unique.sql`
   e rode também (adiciona uma constraint que faltava — só precisa rodar
   uma vez).
4. Cole o conteúdo de `supabase/migrations/0003_crm_public_links.sql` e rode
   (webhook de venda por instância do CRM + constraint pra gerar o link
   público de cada conta sem duplicar).
5. Cole o conteúdo de `supabase/migrations/0004_scheduled_reports_next_run.sql`
   e rode (adiciona o "próximo disparo" e o pausar/retomar dos relatórios
   agendados).
   (Se preferir usar a CLI do Supabase depois, essa mesma pasta já está no
   formato que `supabase db push` espera — ele aplica só as migrações que
   ainda não rodaram.)

## 3. Criar o seu usuário (login único, sem cadastro público)

Como o app não tem mais tela de "Cadastro" nem convite por admin — é uma
instância sua, só sua — o usuário é criado direto pelo painel do Supabase:

1. **Authentication → Users → Add user** → preencha seu e-mail e uma senha.
2. Em **Authentication → Providers → Email**, desmarque **"Enable email
   signups"**. Isso garante que ninguém consiga criar conta pelo site — só
   você, criado manualmente, consegue logar.

## 4. Variáveis de ambiente

```bash
cp .env.local.example .env.local
```

Preencha `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e
`SUPABASE_SERVICE_ROLE_KEY` com os valores do passo 1. Adicione também
`WHATSAPP_DISPATCH_SECRET` — invente uma senha longa e aleatória (ex.:
`openssl rand -hex 32`); é ela que protege o hook de disparo agendado de
WhatsApp contra chamadas de qualquer pessoa na internet.

## 5. Rodar localmente

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000) — deve redirecionar pra
`/login`. Entre com o e-mail/senha criados no passo 3.

## 6. Deploy na Vercel

1. Suba este projeto pra um repositório no GitHub.
2. Em [vercel.com/new](https://vercel.com/new), importe o repositório.
3. Em **Environment Variables**, adicione as mesmas quatro chaves do `.env.local`
   (incluindo `WHATSAPP_DISPATCH_SECRET`).
4. Deploy. A Vercel detecta Next.js automaticamente, sem configuração extra.
5. No n8n, crie um workflow com um node **Schedule Trigger** (a cada 1
   minuto) → **HTTP Request** fazendo `POST` para
   `https://SEU_DOMINIO/api/public/hooks/whatsapp-dispatch-tick` com o
   header `x-webhook-secret: <o mesmo valor de WHATSAPP_DISPATCH_SECRET>`.
   Ative o workflow — é isso que faz os agendamentos de Mensagens
   realmente saírem na hora certa.
6. (Opcional, mas recomendado) Crie um segundo workflow no n8n, igual ao de
   cima, mas com **Schedule Trigger** a cada 30-60 minutos → **HTTP
   Request** `POST` para `https://SEU_DOMINIO/api/public/hooks/audit-tick`
   com o mesmo header `x-webhook-secret`. Isso roda as duas verificações da
   Auditoria (Localização e Erros de veiculação) sozinho, sem precisar
   entrar no painel e clicar em "Verificar agora".
7. (Opcional, mas recomendado) Crie um terceiro workflow no n8n com
   **Schedule Trigger** a cada 15-30 minutos → **HTTP Request** `POST` para
   `https://SEU_DOMINIO/api/public/hooks/report-tick` com o mesmo header
   `x-webhook-secret`. Isso faz os relatórios agendados em Mensagens →
   Relatórios saírem sozinhos na hora certa.

## Estrutura

```
app/
  login/, esqueci-senha/, redefinir-senha/, auth/callback/   → autenticação
  d/[token]/      → dashboard público de UMA conta, somente leitura, sem login
  c/[token]/      → CRM público de UMA instância (kanban somente leitura), sem login
  (app)/                                                     → área logada
    painel/         → contas exibidas, KPIs, Acompanhamento de Resultados
    mensagens/      → abas Envio e Relatórios funcionais; Avisos ainda placeholder
    auditoria/      → Localização e Erros de veiculação, funcionais
    crm/            → instâncias, kanban, detalhe do lead — funcional
    configuracoes/   → abas Meta e WhatsApp funcionais; Status ainda placeholder
  api/
    meta/credentials, meta/accounts, meta/insights, meta/breakdown,
    meta/status, meta/daily-cpa
    whatsapp/credentials, whatsapp/status, whatsapp/connect,
    whatsapp/disconnect, whatsapp/groups, whatsapp/alerts-group,
    whatsapp/send, whatsapp/message-templates, whatsapp/scheduled-dispatches
    audit/location, audit/errors  → "Verificar agora" de cada auditoria
    crm/instances, crm/instances/[id], crm/leads, crm/leads/[id],
    crm/leads/[id]/events  → CRUD do CRM (instâncias, leads, histórico)
    reports/templates, reports/scheduled  → modelos e agendamentos de Relatórios
    public-dashboards  → gera/remove o link público (/d/:token) de uma conta
    public/hooks/whatsapp-dispatch-tick  → chamado pelo n8n, não pelo navegador
    public/hooks/audit-tick              → idem, roda as duas auditorias
    public/hooks/crm-lead-ingest         → idem, cria lead novo por public_token
    public/hooks/report-tick             → idem, dispara os relatórios agendados
    selected-accounts, account-bindings, pix-accounts, focus-groups
lib/meta/
  client.ts     → chamadas cruas à Graph API (get/getAll/post, presets de data)
  shared.ts     → helpers compartilhados (isVaga, objetivos excluídos, acesso à Página)
  insights.ts   → getAdAccounts + getAccountInsight (regra de negócio: ignora
                  campanhas [VAGA], objetivos de reconhecimento/tráfego, soma
                  orçamento diário com CBO e lifetime→diário)
  breakdown.ts  → detalhamento por Campanha/Conjunto/Anúncio (Visão Geral)
  status.ts     → pausar/ativar nos 3 níveis (ligado na Visão Geral e na Auditoria)
  daily-cpa.ts  → CPA diário por conta, usado na atualização de status em massa
lib/audit/
  location.ts   → verificação de localização (Brasil país inteiro / expansão de público)
  errors.ts     → verificação de erros de veiculação (anúncio reprovado/restrito/
                  em análise, conjunto ativo sem anúncio ativo)
  run.ts        → lógica compartilhada entre a rota "Verificar agora" (sessão do
                  usuário) e o hook público audit-tick (service role): roda a
                  auditoria, pausa o que encontrar, grava/atualiza/limpa as
                  tabelas audit_location_status e audit_error_status
lib/crm/
  pipeline.ts       → os 6 estágios fixos do funil (Novo…Perdido)
  sale-webhook.ts   → notifica o webhook de venda da instância (se configurado)
                      quando um lead entra no estágio "Venda", e registra a
                      entrega em crm_sale_webhook_deliveries
lib/reports/
  generate.ts   → monta o texto do relatório a partir do modelo + métricas reais
                  da(s) conta(s) (uma ou mais, concatenadas), com variáveis tipo
                  {cliente}/{investido}/{cpa}
lib/scheduling.ts → regra de recorrência genérica (soma o intervalo à última
                    ocorrência, preservando dia da semana/mês) — usada pelos
                    disparos de WhatsApp e pelos relatórios agendados
lib/whatsapp/
  client.ts     → chamadas cruas à API do uazapi (status/connect/disconnect/grupos/envio)
  instance.ts   → helpers pra pegar a instância uazapi salva do usuário
  dispatch.ts   → tipos do disparo de WhatsApp e interpolação de {cliente}
                  (a regra de recorrência em si vem de lib/scheduling.ts)
lib/supabase/
  client.ts     → cliente do navegador (Client Components)
  server.ts     → cliente do servidor (Server Components / Route Handlers)
                  + createServiceClient() para os links públicos e os
                  endpoints chamados pelo n8n
lib/current-user.ts → helpers pra pegar o usuário logado e o token Meta salvo
proxy.ts        → (antigo middleware.ts) protege as rotas logadas e renova a sessão
supabase/migrations/0001_init.sql → schema completo
supabase/migrations/0002_whatsapp_instance_unique.sql → constraint pra upsert de instância WhatsApp
supabase/migrations/0003_crm_public_links.sql → webhook de venda do CRM + constraint do link público de conta
supabase/migrations/0004_scheduled_reports_next_run.sql → próximo disparo + pausar dos relatórios agendados
```

## Próximas etapas (ver plano completo no artifact "Trafic Insight Hub")

1. ~~Base — Supabase + login único~~ ✅
2. ~~Painel de leitura~~ ✅ — completo: contas exibidas, KPIs, Acompanhamento
   de Resultados, grupos de foco, status em massa, Controle de Saldo/PIX,
   Visão Geral com pausar/ativar
3. Configurações → WhatsApp ✅ — conectar/desconectar (QR ou código de
   pareamento), status, grupo de alertas de saldo. Falta ainda a aba Status
   (personalizar rótulos/cores de prioridade)
4. Mensagens ✅ — Envio: destinatários pelos grupos do WhatsApp (com nome
   do cliente vinculado no Painel → coluna "Grupo WhatsApp"), modelos
   salvos, envio imediato e agendamento (único/recorrente) via hook
   `whatsapp-dispatch-tick` chamado pelo n8n. Relatórios: modelos com
   variáveis ({cliente}/{investido}/{cpa}/etc.), agendamento por conta(s) +
   grupo + recorrência via hook `report-tick`. Falta ainda: Avisos (avisos
   automáticos — além do de saldo, que já funciona) e anexos de mídia (fica
   pra depois, precisa de um bucket no Supabase Storage)
5. ~~Auditoria~~ ✅ — Localização (Brasil país inteiro / expansão de público)
   e Erros de veiculação (anúncio reprovado/restrito/em análise, conjunto
   ativo sem anúncio ativo), com pausa automática do que encontrar. Hook
   `audit-tick` permite automatizar pelo n8n
6. ~~CRM + links públicos~~ ✅ — instâncias de funil, kanban com 6 estágios
   fixos, detalhe do lead com histórico, ingestão via hook `crm-lead-ingest`
   (n8n), webhook de venda automático quando um lead vira "Venda", link
   público por instância (`/c/:token`) e link público de dashboard por
   conta (`/d/:token`, gerado a partir do Painel) — os dois somente leitura
