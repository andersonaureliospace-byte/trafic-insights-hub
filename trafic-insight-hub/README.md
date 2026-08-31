# Trafic Insight Hub

Painel interno de acompanhamento de tráfego pago (Meta Ads) — reconstrução do
projeto original, agora como instância única (um só login) hospedada na
Vercel, com Supabase, n8n e uazapi (WhatsApp).

Estado atual: **etapa 1 do plano** — base do Supabase e login único. As
telas de Painel, Mensagens, Auditoria, CRM e Configurações existem como
placeholder, indicando o que entra em cada uma nas próximas etapas.

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
   (Se preferir usar a CLI do Supabase depois, essa mesma pasta já está no
   formato que `supabase db push` espera.)

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
`SUPABASE_SERVICE_ROLE_KEY` com os valores do passo 1.

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
3. Em **Environment Variables**, adicione as mesmas três chaves do `.env.local`.
4. Deploy. A Vercel detecta Next.js automaticamente, sem configuração extra.

## Estrutura

```
app/
  login/, esqueci-senha/, redefinir-senha/, auth/callback/   → autenticação
  (app)/                                                     → área logada
    painel/ mensagens/ auditoria/ crm/ configuracoes/
lib/supabase/
  client.ts     → cliente do navegador (Client Components)
  server.ts     → cliente do servidor (Server Components / Route Handlers)
                  + createServiceClient() para os links públicos e os
                  endpoints chamados pelo n8n
middleware.ts   → protege as rotas logadas e renova a sessão
supabase/migrations/0001_init.sql → schema completo
```

## Próximas etapas (ver plano completo no artifact "Trafic Insight Hub")

1. ~~Base — Supabase + login único~~ ✅ (este commit)
2. Painel de leitura (contas exibidas, KPIs, Acompanhamento de Resultados,
   Controle de Saldo, pausar/ativar)
3. Configurações (Meta, WhatsApp/uazapi, Status)
4. Mensagens + fluxos n8n de disparo/relatório
5. Auditoria + fluxos n8n de auditoria/saldo
6. CRM + links públicos (`/d/:token`, `/c/:token`)
