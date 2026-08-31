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
chama periodicamente. Auditoria, CRM, Mensagens → Relatórios/Avisos e
Configurações → Status continuam como placeholder.

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

## Estrutura

```
app/
  login/, esqueci-senha/, redefinir-senha/, auth/callback/   → autenticação
  (app)/                                                     → área logada
    painel/         → contas exibidas, KPIs, Acompanhamento de Resultados
    mensagens/      → aba Envio funcional; Relatórios/Avisos ainda placeholder
    auditoria/ crm/   → ainda placeholder
    configuracoes/   → abas Meta e WhatsApp funcionais; Status ainda placeholder
  api/
    meta/credentials, meta/accounts, meta/insights, meta/breakdown,
    meta/status, meta/daily-cpa
    whatsapp/credentials, whatsapp/status, whatsapp/connect,
    whatsapp/disconnect, whatsapp/groups, whatsapp/alerts-group,
    whatsapp/send, whatsapp/message-templates, whatsapp/scheduled-dispatches
    public/hooks/whatsapp-dispatch-tick  → chamado pelo n8n, não pelo navegador
    selected-accounts, account-bindings, pix-accounts, focus-groups
lib/meta/
  client.ts     → chamadas cruas à Graph API (get/getAll/post, presets de data)
  shared.ts     → helpers compartilhados (isVaga, objetivos excluídos, acesso à Página)
  insights.ts   → getAdAccounts + getAccountInsight (regra de negócio: ignora
                  campanhas [VAGA], objetivos de reconhecimento/tráfego, soma
                  orçamento diário com CBO e lifetime→diário)
  breakdown.ts  → detalhamento por Campanha/Conjunto/Anúncio (Visão Geral)
  status.ts     → pausar/ativar nos 3 níveis (ligado na Visão Geral)
  daily-cpa.ts  → CPA diário por conta, usado na atualização de status em massa
lib/whatsapp/
  client.ts     → chamadas cruas à API do uazapi (status/connect/disconnect/grupos/envio)
  instance.ts   → helpers pra pegar a instância uazapi salva do usuário
  dispatch.ts   → regra de recorrência (próxima data) e interpolação de {cliente},
                  compartilhados entre a criação do agendamento e o hook de disparo
lib/supabase/
  client.ts     → cliente do navegador (Client Components)
  server.ts     → cliente do servidor (Server Components / Route Handlers)
                  + createServiceClient() para os links públicos e os
                  endpoints chamados pelo n8n
lib/current-user.ts → helpers pra pegar o usuário logado e o token Meta salvo
proxy.ts        → (antigo middleware.ts) protege as rotas logadas e renova a sessão
supabase/migrations/0001_init.sql → schema completo
supabase/migrations/0002_whatsapp_instance_unique.sql → constraint pra upsert de instância WhatsApp
```

## Próximas etapas (ver plano completo no artifact "Trafic Insight Hub")

1. ~~Base — Supabase + login único~~ ✅
2. ~~Painel de leitura~~ ✅ — completo: contas exibidas, KPIs, Acompanhamento
   de Resultados, grupos de foco, status em massa, Controle de Saldo/PIX,
   Visão Geral com pausar/ativar
3. Configurações → WhatsApp ✅ — conectar/desconectar (QR ou código de
   pareamento), status, grupo de alertas de saldo. Falta ainda a aba Status
   (personalizar rótulos/cores de prioridade)
4. Mensagens → Envio ✅ — destinatários pelos grupos do WhatsApp (com nome
   do cliente vinculado no Painel → coluna "Grupo WhatsApp"), modelos
   salvos, envio imediato e agendamento (único/recorrente) via hook
   `whatsapp-dispatch-tick` chamado pelo n8n. Falta ainda: Relatórios
   (relatório periódico por WhatsApp), Avisos (avisos automáticos —
   além do de saldo, que já funciona), e anexos de mídia (fica pra depois,
   precisa de um bucket no Supabase Storage)
5. Auditoria + fluxos n8n de auditoria/saldo
6. CRM + links públicos (`/d/:token`, `/c/:token`)
