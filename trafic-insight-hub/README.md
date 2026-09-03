# Trafic Insight Hub

Painel interno de acompanhamento de tráfego pago (Meta Ads) — reconstrução do
projeto original, agora como instância única (um só login) hospedada na
Vercel, com Supabase, n8n e uazapi (WhatsApp).

Estado atual: **etapas 1 e 2 do plano concluídas** — base do Supabase/login
único, e o Painel já fecha 100%, agora organizado em subgrupos na lateral
esquerda (Acompanhamento, Evolução, Clientes, Controle de Saldo, Visão
Geral, Análise — a aba "Geral", que só mostrava 3 KPIs soltos e duplicava a
"Visão Geral", foi removida; a aba que abre por padrão agora é Visão Geral)
— cada um só
busca dado do Meta enquanto estiver ativo, pra não gastar requisição à toa
com abas que você não está olhando. Acompanhamento tem a tabela de
resultados com dados reais da
Meta (CPA, valor usado, investimento diário), grupos de foco (agrupar
contas e focar a tabela num grupo), atualização de status em massa
(classifica a prioridade pelo CPA dos últimos 3 dias vs. a meta cadastrada)
e um botão "Editar" por cliente que abre a Meta CPA/Meta de
Investimento/Grupo WhatsApp num modal — esses 3 campos não aparecem mais
direto na tabela. Clientes é novo: ficha única por cliente com Nome, Conta
(link pro Facebook), ID da conta (com botão de copiar), e os campos
preenchidos à mão — CPA ideal, Investimento mensal, Meta de leads, WhatsApp
de contato, Grupo WhatsApp (o mesmo vínculo usado nos disparos) e Endereço.
Controle de Saldo/PIX e Visão Geral por Campanhas/Conjuntos/Anúncios (agora
só lista campanha com impressão de verdade no período) continuam com
pausar/ativar nos 3 níveis, e o nome da conta em Acompanhamento, Clientes e
Visão Geral é link direto pro Gerenciador de Anúncios daquela conta — em
Controle de Saldo especificamente o link vai direto pra tela de Cobranças e
Pagamentos (billing hub) da conta, já que é essa a tela que trata de
saldo/pagamento. O Tipo de conta em Controle de Saldo (Pré-paga/Híbrida/
Pós-paga/Loja própria — essa última é nova) agora é puxado da Meta
automaticamente na primeira vez que a conta aparece sem tipo salvo
(Pré-paga ou Pós-paga, conforme a Meta classificar); Híbrida e Loja própria
continuam sendo escolha manual, já que a Meta não tem esse conceito. Depois
de puxado (ou escolhido) uma vez, o campo continua 100% editável e nunca
mais é sobrescrito sozinho — é só trocar no próprio seletor quando quiser. A
coluna "Saldo disponível" de Controle de Saldo (e o "Saldo" que aparece em
Mensagens → Avisos) agora mostra o fundo que realmente resta pra gastar
(teto de gasto da conta menos o que já foi gasto) em vez do campo bruto
`balance` da Meta, que na prática é "quanto já acumulou pra cobrar" — dava a
impressão de valor gasto recentemente, não saldo restante; a mesma correção
vale pro aviso automático de saldo baixo (Mensagens → Avisos), que usava o
mesmo campo errado. O quadro do Painel agora ocupa a tela inteira (sem limite de
largura), e em Acompanhamento o Status vem colorido de acordo com a cor
cadastrada em Configurações → Status pra cada nível — pra mudar a cor da
"Inauguração" (ou de qualquer outro nível), não precisa mexer em código, é
só trocar a cor lá. Em Acompanhamento também dá pra arrastar e soltar as
linhas pra reordenar os clientes do jeito que quiser — a ordem é salva por
conta no Supabase (atrelada ao seu login/e-mail), nunca no navegador, então
abre igual em qualquer computador/navegador que você use; a reordenação só
fica disponível com a busca e o grupo de foco desligados (com filtro ativo,
a posição na tela não bate com a posição real entre todas as contas). Em
Acompanhamento também tem a coluna Ritmo: quanto falta investir por dia
(dos dias que restam no mês, contando hoje, mês sempre considerado com 30
dias) pra bater o Investimento mensal cadastrado — (Investimento mensal −
Valor usado no mês corrente) ÷ dias restantes; a cor compara o Ritmo com o
Invest. diário já configurado na conta: verde quando a diferença é de até
R$ 10 pra mais ou pra menos (orçamento diário já está no ritmo certo),
laranja quando o Ritmo está mais de R$ 10 acima do orçamento diário atual
(precisaria investir mais do que está configurado) e vermelho quando o
Ritmo está mais de R$ 10 abaixo do orçamento diário atual (o orçamento
atual está investindo mais rápido do que precisa). A tela do Painel também
não fica mais presa em "Carregando…" de forma inconsistente — o indicador
de carregamento agora espera tanto a lista de contas selecionadas quanto a
lista de contas do Meta terminarem de carregar antes de mostrar a tabela,
evitando o "Mostrando 0 conta(s) selecionada(s)" passageiro que aparecia
quando a busca no Meta demorava um pouco mais. Todas as abas do Painel
(Acompanhamento, Clientes, Controle de Saldo, Visão Geral e Análise) agora
têm um botão "↻ Atualizar" pra puxar os dados de novo na hora, sem precisar
dar F5. O período de Acompanhamento ganhou a opção "Últimos 3 dias + hoje"
(mesma opção que já existia em Análise, agora disponível em qualquer
seletor de período do Painel). Acompanhamento também ganhou uma nova
coluna, CPA ideal (antes da coluna CPA, editável ali mesmo — e continua
editável em Clientes também, os dois lugares ficam sincronizados). Na
coluna CPA, a diferença CPA − CPA ideal agora aparece direto embaixo do
valor (não só numa dica ao passar o mouse), pequena e mais clara pra não
competir com o CPA — que fica em destaque, maior e em negrito — com sinal
+ ou - e cor: verde quando o CPA está abaixo do ideal, laranja quando está
até R$ 1,40 acima do ideal, vermelho quando passa de R$ 1,40 acima do
ideal. A dica ao
passar o mouse em cima do Ritmo também mudou: em vez do texto explicando a
fórmula, agora mostra direto a diferença Invest. diário − Ritmo, no mesmo
formato com sinal. E o menu suspenso dos filtros no modo escuro (o mesmo
problema da Etapa 18) recebeu um ajuste mais robusto — veja o ⚠️ abaixo.
Além disso, Acompanhamento ganhou 3 filtros novos, todos começando fixos em
"Todos": Status (filtra pelo nível de prioridade), CPA (mostra só CPA alto,
ou seja, CPA acima do CPA ideal) e Investimento (Baixo = laranja no Ritmo,
Alto = vermelho no Ritmo). Evolução é a aba nova: um quadro simples com o
CPA de cada cliente dia a dia, período fixo em "últimos 7 dias + hoje" (sem
seletor, não muda), colunas mais recentes primeiro com a data (dd/mm) e o
advérbio de tempo embaixo (Hoje, Ontem, Anteontem, e dia da semana abreviado
a partir do 3º dia atrás) — verde quando o CPA do dia é até R$ 2, vermelho
quando passa de R$ 2 (veja o ⚠️ sobre esse valor fixo). Análise
mostra criativo, com o filtro de Status "Ativos" (padrão) ou "Todos" (ativos +
pausados), com
custo por conversa iniciada R$ 4 ou mais acima da Meta CPA do cliente — ou,
quando não teve nenhuma conversa iniciada, com o próprio gasto R$ 4 ou mais
acima da Meta CPA (ex.: CPA ideal R$6, gastou R$10, zero conversa, também
entra) —, agrupado por cliente (nome da conta é link direto pro Gerenciador
de Anúncios), com busca por nome de criativo (vale pra todas as contas ao
mesmo tempo), botão de Atualizar (sem precisar dar F5), filtro de período
(padrão "Últimos 3 dias + hoje") e botão de pausar manual por anúncio —
nada é pausado sozinho aqui. O Tipo de conta em Controle de Saldo (ver
abaixo) é puxado da Meta uma única vez, na primeira vez que a conta aparece
sem tipo salvo — não fica reconsultando isso a cada carregamento do
Painel. Configurações → Meta e Configurações → WhatsApp
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
tem um link público (`/c/:token`) pro cliente acompanhar sem login. Quando
um lead entra no estágio "Venda", o app notifica um webhook do n8n (se
configurado na instância) automaticamente. (O link público de dashboard
por conta, `/d/:token`, existiu numa versão anterior e foi removido —
confundia com o link de relatório pro cliente; o link do CRM acima é o que
ficou.)
Mensagens → Relatórios também já funciona de verdade: modelos de relatório
com variáveis (`{cliente}`, `{investido}`, `{resultados}`, `{cpa}`, etc.),
agendamento por conta(s) + grupo do WhatsApp + recorrência (diária/semanal/
mensal), pausar/retomar/excluir — o envio de fato é efetivado por um
terceiro hook público (`report-tick`) chamado pelo n8n. Mensagens → Avisos
também já funciona de verdade: aviso automático de saldo baixo pra contas
pré-paga/híbrida com um limite definido (campo "Alertar quando <" no
Controle de Saldo/PIX, ou 20% do Valor base se ficar em branco) — manda
pro grupo configurado em Configurações → WhatsApp, com um "Verificar
agora" manual na tela e um quarto hook público (`balance-alert-tick`) pra
automatizar pelo n8n. Configurações → Status também já funciona de
verdade: personalizar o rótulo e a cor de cada nível de prioridade
(Inauguração/Baixa/Média/Alta/Crítica) usado no Painel — o critério de
classificação automática (CPA vs. meta) continua o mesmo, só muda como
aparece na tela. Mensagens → Envio agora também suporta anexo de mídia
(imagem/vídeo/áudio/documento) no envio imediato — sobe pro Supabase
Storage e vai como legenda pelo uazapi; disparos agendados continuam só
texto. Os filtros de seletor (período, tipo, prioridade etc.) no modo
escuro do navegador não ficam mais com letra clara em fundo claro dentro do
menu suspenso — o app avisa o navegador, via `color-scheme`, exatamente
quando é claro e quando é escuro (preso ao mesmo gatilho que já troca as
cores do resto da página), em vez de deixar o navegador "escolher" entre os
dois e às vezes desenhar esse menu no claro por padrão mesmo com a página
no escuro. Campanha com objetivo Tráfego (o que a Meta chama de "Visitas ao
perfil" também cai nesse objetivo) ou com "vaga" no nome já era excluída de
Acompanhamento e Evolução — agora essa mesma exclusão foi completada em
Análise e Visão Geral, que até então só excluíam pelo nome da campanha e
deixavam passar quem tinha objetivo Tráfego com outro nome; agora nenhuma
dessas campanhas aparece em nenhuma métrica, gráfico, total ou tela do
Painel, nas 4 abas. Painel > Análise ganhou um segundo botão por criativo,
"🔁 Recriar conjunto" — além do "Pausar" que já existia (e continua igual),
esse botão novo pausa o criativo, pausa o conjunto inteiro e cria uma cópia
pausada (rascunho) do conjunto com a mesma segmentação/otimização/lance e
todos os criativos originais, inclusive o que acabou de ser pausado; excluir
esse criativo na cópia, ativar o conjunto novo e publicar continua manual,
no Gerenciador de Anúncios — veja o ⚠️ abaixo sobre os limites dessa
duplicação. Com isso, todas as áreas do plano original + os extras pedidos
ao longo do caminho estão 100% concluídas.

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

⚠️ **Pra o aviso de saldo baixo rodar sozinho**: configure um quarto
workflow no n8n chamando `POST https://SEU_DOMINIO/api/public/hooks/balance-alert-tick`
com o mesmo header `x-webhook-secret`, a cada 3-6 horas (saldo não muda de
minuto a minuto, não precisa checar com frequência). Cada conta só é
reavisada depois de 24h, mesmo que o hook rode mais vezes que isso.

⚠️ **Pra anexos de mídia funcionarem em Mensagens → Envio**: rode a
migração `0006_whatsapp_media_bucket.sql` (veja o passo 6) — ela cria o
bucket `whatsapp-media` no Supabase Storage. Se o seu projeto Supabase
bloquear a criação de bucket público por SQL (política do próprio
Supabase, varia por plano), crie manualmente em **Storage → New bucket**
com o nome exato `whatsapp-media` marcando **Public bucket**, e rode só a
parte das `create policy` da migração. O contrato exato do `POST
/send/media` do uazapi (`{number, type, file, text, docName}`) foi
assumido por analogia com `/send/text` — não verificado contra a
documentação oficial, então confirme no primeiro envio de teste.

⚠️ **Sobre a nova aba Análise (custo por conversa iniciada)**: o Graph API
não tem um campo fixo e universal pra "conversa iniciada" — o nome do
`action_type` varia um pouco conforme a conta (o mais comum é
`onsite_conversion.messaging_conversation_started_7d`). O código casa
qualquer `action_type` que contenha `messaging_conversation_started`, o que
cobre a maioria dos casos, mas vale conferir os primeiros números contra o
Gerenciador de Anúncios antes de confiar de olhos fechados. Só entram na
lista contas com Meta CPA cadastrada (sem meta não dá pra saber o que é
"acima") — o rodapé da aba avisa quais ficaram de fora por esse motivo. Só
entra criativo ATIVO (pausado é descartado antes mesmo de calcular custo).
Um criativo também entra quando gastou R$ 4+ acima da Meta CPA mas não teve
NENHUMA conversa iniciada no período — nesse caso a coluna "Custo/conversa"
mostra "—" (não dá pra calcular sem conversa) e a "Diferença" usa o próprio
gasto menos a Meta CPA.

⚠️ **Link público de dashboard removido**: se você chegou a gerar algum
link `/d/:token` numa entrega anterior, ele para de funcionar com essa
atualização (a rota foi removida). A tabela `public_dashboards` continua no
banco sem uso — rode `supabase/migrations/0007_drop_public_dashboards.sql`
se quiser apagá-la de vez (opcional, não afeta nada não rodar).

⚠️ **Sobre o Tipo de conta puxado automaticamente (Controle de Saldo)**: a
Meta só informa `is_prepay_account` (pré-paga/pós-paga) pra quem tem acesso
de admin naquela conta especificamente — se o seu token só tiver acesso de
anúncios/análise numa conta, esse campo volta vazio e o Tipo dela fica em
branco pra você escolher manualmente (nunca trava em "Pré-paga" por
engano). Essa consulta é separada da listagem de contas de sempre e só roda
uma vez por conta nova (a que ainda não tem Tipo salvo) — não fica
reconsultando a Meta toda vez que o Painel carrega. O Business Manager dono
da conta (usado no link de Cobranças e Pagamentos) é diferente: vem junto
da listagem normal de contas, e quando a Meta não informa (conta sem
Business Manager, ou sem esse nível de acesso), o link ainda funciona, só
não vem pré-filtrado pelo negócio.

⚠️ **Sobre o "Saldo disponível" (Controle de Saldo e Avisos)**: o cálculo é
teto de gasto da conta (`spend_cap`) menos o já gasto (`amount_spent`) — é a
fórmula padrão do mercado pra "saldo disponível" de conta pré-paga da Meta
(recarregar = subir o teto). Quando a conta não tem teto de gasto definido
na Meta (`spend_cap` zerado/ausente — típico de conta pós-paga sem limite),
não existe "fundo" pra calcular, então cai de volta pro `balance` bruto (o
valor a pagar) — passe o mouse na célula pra ver qual dos dois está sendo
mostrado. Vale conferir os primeiros números contra a tela de Cobranças e
Pagamentos de uma conta pré-paga antes de confiar de olhos fechados,
principalmente se você notar alguma diferença por causa de imposto/desconto
que a Meta aplica na cobrança e que a API não reflete.

⚠️ **Sobre a coluna Ritmo (Acompanhamento)**: o cálculo é (Investimento
mensal − Valor usado no mês corrente) ÷ dias restantes do mês, sempre
considerando o mês com 30 dias (não os 28-31 reais do calendário) e contando
hoje como um dos dias restantes (ex.: dia 20, restam 11 dias — 30 − 20 + 1).
"Valor usado no mês corrente" é sempre o gasto de `this_month` da Meta,
independente do período escolhido no filtro da tabela (Hoje/Últimos 7
dias/etc. são pra CPA e Valor usado, não pro Ritmo). Sem Investimento
mensal cadastrado (Painel > Clientes ou no modal Editar), a coluna fica em
branco — não dá pra calcular ritmo sem meta.

⚠️ **Sobre a cor da coluna Ritmo (Etapa 21)**: o pedido foi "se tiver R$ 10
pra cima ou pra baixo, verde; pra baixo, vermelho; pra cima, laranja" — o
que faltava dizer era R$ 10 pra cima/baixo *de quê*. Implementei comparando
o Ritmo com o Invest. diário que já está configurado na conta (não com
zero), porque é a leitura que dá um sinal útil: verde = diferença de até R$
10 (orçamento diário já no ritmo certo), laranja = Ritmo mais de R$ 10
ACIMA do orçamento diário atual (precisaria investir mais por dia do que
está configurado), vermelho = Ritmo mais de R$ 10 ABAIXO do orçamento
diário atual (o orçamento atual está investindo mais rápido do que
precisa). Se a ideia era outra (por exemplo, comparar o Ritmo com zero, ou
com algum outro valor), me fala que ajusto rapidinho.

⚠️ **Sobre o menu suspenso ilegível no modo escuro, de novo (Etapa 23)**:
a correção da Etapa 18 usava `color-scheme: light dark`, que só avisa o
navegador que a página aceita os dois temas e deixa ele "escolher" — na
prática, alguns navegadores continuavam desenhando o menu do `<select>` no
claro mesmo com a página no escuro (o print que você mandou). Troquei para
`color-scheme: light` fora do modo escuro e `color-scheme: dark` dentro do
mesmo bloco `@media (prefers-color-scheme: dark)` que já troca as cores do
resto da página — agora é uma troca explícita, presa ao mesmo gatilho, em
vez de uma escolha do navegador. Se ainda aparecer claro em algum
navegador/computador específico, me avisa com o nome do navegador que uso
pra investigar esse caso.

⚠️ **Sobre o valor fixo de R$ 2 em Evolução (Etapa 24)**: o pedido foi "se
tiver até dois reais, verde; acima de dois reais, vermelho" — implementei
literal, R$ 2 fixo pro CPA do dia de qualquer cliente, sem comparar com o
CPA ideal de cada um (diferente do resto do Painel, onde tudo é relativo à
meta de cada cliente — ex.: o filtro "CPA alto" em Acompanhamento, ou o R$4
de Análise). Se a ideia era, por exemplo, "até R$ 2 acima do CPA ideal" (aí
sim comparando com a meta de cada cliente), me fala que ajusto — é rápido.

⚠️ **Pra arrastar e reordenar em Acompanhamento**: essa entrega inclui a
migração `0009_account_sort_order.sql` (veja o passo 10) — sem rodar ela, a
reordenação dá erro ao salvar. A ordem fica gravada em `account_bindings`
por usuário/conta (nunca em localStorage/sessionStorage do navegador), então
funciona igual em qualquer computador ou navegador que você usar pra
acessar o Painel.

⚠️ **Sobre "🔁 Recriar conjunto" em Análise (Etapa 28)**: esse botão faz na
raça, via chamadas diretas da Graph API, o mesmo que o "Duplicar" do
Gerenciador de Anúncios faz — não existe um endpoint oficial que copie o
conjunto excluindo um anúncio específico, então ele duplica com todos os
criativos originais (inclusive o pausado) e para por aí; excluir o criativo
pausado na cópia, ativar o conjunto e publicar é você que faz, manualmente,
no Gerenciador. Três pontos importantes: (1) o orçamento do conjunto novo
sempre sai fixo em R$ 15/dia (`daily_spend_cap`, teto por conjunto dentro da
campanha CBO) — não copia o valor do conjunto de origem, por pedido
explícito, já que todas as contas usam esse mesmo valor; (2) campos comuns
(segmentação, meta de otimização, evento de cobrança, estratégia de lance,
objeto promovido) são copiados como a Meta devolve na leitura, mas
configurações mais raras (regra de DSA por região, agendamento por horário,
criativo dinâmico) só entram se a Meta as retornar no conjunto de origem —
vale testar num conjunto de baixo risco antes de confiar nisso todo dia; (3)
como o anúncio duplicado entra em revisão de novo (mesmo reaproveitando o
mesmo criativo), existe uma janela de alguns minutos a até ~24h sem entrega
nesse conjunto entre pausar o antigo e o novo ser aprovado e você publicar —
isso é do próprio Meta, não tem como evitar duplicando de verdade.

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
6. Cole o conteúdo de `supabase/migrations/0005_balance_alerts.sql` e rode
   (adiciona o limite de alerta e o controle de reaviso do Controle de
   Saldo/PIX).
7. Cole o conteúdo de `supabase/migrations/0006_whatsapp_media_bucket.sql`
   e rode (cria o bucket `whatsapp-media` no Storage, público pra leitura,
   com upload/remoção restritos ao dono).
8. (Opcional) Cole o conteúdo de `supabase/migrations/0007_drop_public_dashboards.sql`
   e rode só se quiser apagar a tabela do antigo link público de dashboard
   (`/d/:token`, removido nessa entrega) — sem rodar essa, o app funciona
   normalmente do mesmo jeito.
9. Cole o conteúdo de `supabase/migrations/0008_client_profile_fields.sql`
   e rode (adiciona Meta de leads, WhatsApp de contato e Endereço na ficha
   de cliente — Painel > Clientes).
10. Cole o conteúdo de `supabase/migrations/0009_account_sort_order.sql` e
    rode (adiciona a coluna que guarda a ordem manual dos clientes em
    Acompanhamento).
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
8. (Opcional, mas recomendado) Crie um quarto workflow no n8n com
   **Schedule Trigger** a cada 3-6 horas → **HTTP Request** `POST` para
   `https://SEU_DOMINIO/api/public/hooks/balance-alert-tick` com o mesmo
   header `x-webhook-secret`. Isso faz o aviso de saldo baixo em Mensagens
   → Avisos rodar sozinho.
9. Anexos de mídia (Mensagens → Envio) não precisam de nenhum workflow novo
   no n8n — é um upload síncrono direto pro Supabase Storage, disparado na
   hora do envio.

## Estrutura

```
app/
  login/, esqueci-senha/, redefinir-senha/, auth/callback/   → autenticação
  c/[token]/      → CRM público de UMA instância (kanban somente leitura), sem login
  (app)/                                                     → área logada
    painel/         → subgrupos na lateral: Acompanhamento, Evolução,
                      Clientes, Controle de Saldo, Visão Geral, Análise —
                      cada um só busca no Meta enquanto está ativo
    mensagens/      → abas Envio, Relatórios e Avisos, todas funcionais
    auditoria/      → Localização e Erros de veiculação, funcionais
    crm/            → instâncias, kanban, detalhe do lead — funcional
    configuracoes/   → abas Meta, WhatsApp e Status, todas funcionais
  api/
    meta/credentials, meta/accounts, meta/insights, meta/breakdown,
    meta/status, meta/daily-cpa
    meta/payment-type  → puxa Pré-paga/Pós-paga da Meta, só p/ conta sem Tipo salvo (Controle de Saldo)
    analysis/creatives  → custo por conversa iniciada acima da Meta CPA (Painel > Análise)
    whatsapp/credentials, whatsapp/status, whatsapp/connect,
    whatsapp/disconnect, whatsapp/groups, whatsapp/alerts-group,
    whatsapp/send, whatsapp/media, whatsapp/message-templates,
    whatsapp/scheduled-dispatches
    audit/location, audit/errors  → "Verificar agora" de cada auditoria
    crm/instances, crm/instances/[id], crm/leads, crm/leads/[id],
    crm/leads/[id]/events  → CRUD do CRM (instâncias, leads, histórico)
    reports/templates, reports/scheduled  → modelos e agendamentos de Relatórios
    alerts/balance  → status de saldo baixo + "Verificar agora" (Mensagens > Avisos)
    priority-labels → rótulos/cores de prioridade personalizados (Configurações > Status)
    public/hooks/whatsapp-dispatch-tick  → chamado pelo n8n, não pelo navegador
    public/hooks/audit-tick              → idem, roda as duas auditorias
    public/hooks/crm-lead-ingest         → idem, cria lead novo por public_token
    public/hooks/report-tick             → idem, dispara os relatórios agendados
    public/hooks/balance-alert-tick      → idem, checa e avisa saldo baixo
    selected-accounts, account-bindings, account-bindings/reorder,
    pix-accounts, focus-groups
lib/meta/
  client.ts     → chamadas cruas à Graph API (get/getAll/post, presets de data)
  shared.ts     → helpers compartilhados (isVaga, objetivos excluídos, acesso à Página)
  insights.ts   → getAdAccounts + getAccountInsight (regra de negócio: ignora
                  campanhas [VAGA], objetivos de reconhecimento/tráfego, soma
                  orçamento diário com CBO e lifetime→diário)
  breakdown.ts  → detalhamento por Campanha/Conjunto/Anúncio (Visão Geral) —
                  no nível campanha só entra quem teve impressão no período
  status.ts     → pausar/ativar nos 3 níveis (ligado na Visão Geral, Auditoria e Análise)
  daily-cpa.ts  → CPA diário por conta, usado na atualização de status em massa
  creative-analysis.ts → custo por conversa iniciada por anúncio, com status (Painel > Análise)
  ads-manager-link.ts → monta a URL do Gerenciador de Anúncios (campanhas) e a
                         de Cobranças e Pagamentos (billing hub, usada só no
                         Controle de Saldo) a partir do ID da conta e do
                         Business Manager dono dela
  funds.ts      → "fundo disponível" de uma conta (teto de gasto − já gasto,
                  com fallback pro balance bruto quando não há teto) — usado
                  no Controle de Saldo e no aviso de saldo baixo
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
lib/alerts/
  balance.ts    → checa saldo baixo (pré-paga/híbrida com limite definido) e
                  manda o aviso pro grupo — compartilhado entre "Verificar
                  agora" (sessão) e o hook público balance-alert-tick (service
                  role); tem cooldown de 24h por conta pra não reavisar toda hora
lib/scheduling.ts → regra de recorrência genérica (soma o intervalo à última
                    ocorrência, preservando dia da semana/mês) — usada pelos
                    disparos de WhatsApp e pelos relatórios agendados
lib/priority-context.tsx → Context/Provider dos rótulos de prioridade
                            personalizados (busca uma vez, compartilha entre
                            Painel, diálogo de status em massa e Configurações)
lib/whatsapp/
  client.ts     → chamadas cruas à API do uazapi (status/connect/disconnect/
                  grupos/envio de texto e mídia)
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
supabase/migrations/0005_balance_alerts.sql → limite de alerta + controle de reaviso do saldo
supabase/migrations/0006_whatsapp_media_bucket.sql → bucket whatsapp-media (Storage) + policies de dono/leitura pública
supabase/migrations/0007_drop_public_dashboards.sql → (opcional) apaga a tabela do link público de dashboard removido
supabase/migrations/0008_client_profile_fields.sql → Meta de leads, WhatsApp de contato e Endereço na ficha de cliente
supabase/migrations/0009_account_sort_order.sql → ordem manual (drag-and-drop) dos clientes em Acompanhamento
```

## Próximas etapas (ver plano completo no artifact "Trafic Insight Hub")

1. ~~Base — Supabase + login único~~ ✅
2. ~~Painel de leitura~~ ✅ — completo: contas exibidas, KPIs, Acompanhamento
   de Resultados, grupos de foco, status em massa, Controle de Saldo/PIX,
   Visão Geral com pausar/ativar
3. ~~Configurações~~ ✅ — WhatsApp: conectar/desconectar (QR ou código de
   pareamento), status, grupo de alertas de saldo. Status: personalizar
   rótulo/cor de cada nível de prioridade (Painel > Acompanhamento de
   Resultados)
4. ~~Mensagens~~ ✅ — Envio: destinatários pelos grupos do WhatsApp (com nome
   do cliente vinculado no Painel → coluna "Grupo WhatsApp"), modelos
   salvos, envio imediato (com anexo opcional de imagem/vídeo/áudio/
   documento, via Supabase Storage) e agendamento (único/recorrente, só
   texto) via hook `whatsapp-dispatch-tick` chamado pelo n8n. Relatórios:
   modelos com variáveis ({cliente}/{investido}/{cpa}/etc.), agendamento
   por conta(s) + grupo + recorrência via hook `report-tick`. Avisos: aviso
   automático de saldo baixo (limite por conta ou 20% do Valor base) via
   hook `balance-alert-tick`
5. ~~Auditoria~~ ✅ — Localização (Brasil país inteiro / expansão de público)
   e Erros de veiculação (anúncio reprovado/restrito/em análise, conjunto
   ativo sem anúncio ativo), com pausa automática do que encontrar. Hook
   `audit-tick` permite automatizar pelo n8n
6. ~~CRM + links públicos~~ ✅ — instâncias de funil, kanban com 6 estágios
   fixos, detalhe do lead com histórico, ingestão via hook `crm-lead-ingest`
   (n8n), webhook de venda automático quando um lead vira "Venda", link
   público por instância (`/c/:token`), somente leitura. (O link público de
   dashboard por conta, `/d/:token`, existiu e foi removido na Etapa 11.)
7. ~~Ajustes do Painel (Etapa 11)~~ ✅ — subgrupos na lateral (Geral,
   Acompanhamento, Controle de Saldo, Visão Geral, Análise) com busca no
   Meta isolada por aba; link público de dashboard removido; Meta CPA/Meta
   de Investimento/Grupo WhatsApp saíram da tabela e foram pro modal
   "Editar" por cliente; Visão Geral só lista campanha com impressão no
   período; nova aba Análise com custo por conversa iniciada por criativo
   (filtro "3 dias + hoje" + demais períodos, agrupado por cliente, pausar
   manual, sem limite de quantos aparecem); nome da conta agora é link
   direto pro Gerenciador de Anúncios daquela conta (Acompanhamento,
   Controle de Saldo e um atalho "Abrir no Facebook" na Visão Geral)
8. ~~Painel > Clientes (Etapa 13)~~ ✅ — nova aba com a ficha de cada
   cliente numa tela só: Nome, Conta (link pro Facebook), ID da conta (com
   botão de copiar), CPA ideal, Investimento mensal, Meta de leads,
   WhatsApp de contato, Grupo WhatsApp e Endereço — os 3 primeiros
   preenchidos automaticamente pela Meta, o resto é tudo manual
9. ~~Painel em tela cheia + Status colorido + reordenar clientes (Etapa
   14)~~ ✅ — o quadro do Painel não tem mais limite de largura; o Status em
   Acompanhamento agora é colorido com a cor de cada nível (personalizável
   em Configurações → Status, sem precisar mexer em código); e dá pra
   arrastar e soltar os clientes em Acompanhamento pra reordenar do jeito
   que quiser, com a ordem salva no Supabase por conta/usuário (nunca no
   navegador) — funciona igual em qualquer computador que você acessar
10. ~~Cobranças e Pagamentos + Tipo de conta automático (Etapa 15)~~ ✅ — em
    Controle de Saldo, o nome da conta agora abre direto a tela de Cobranças
    e Pagamentos (billing hub) da conta, em vez do Gerenciador de Anúncios
    geral; o Tipo de conta (Pré-paga/Híbrida/Pós-paga/Loja própria — essa
    última é nova) é puxado automaticamente da Meta (Pré-paga/Pós-paga) na
    primeira vez que a conta aparece sem tipo salvo, e continua 100%
    editável depois disso pra Híbrida, Loja própria, ou pra corrigir o que
    a Meta classificou
11. ~~Saldo disponível de verdade (Etapa 16)~~ ✅ — "Saldo disponível" em
    Controle de Saldo (e "Saldo" em Mensagens → Avisos) agora é teto de
    gasto menos já gasto, não mais o campo bruto da Meta que parecia gasto
    recente; mesma correção aplicada no cálculo do aviso automático de
    saldo baixo, que usava o mesmo campo errado
12. ~~Tipo de conta 1x só + Análise refinada (Etapa 17)~~ ✅ — o Tipo de
    conta (Controle de Saldo) agora é uma consulta separada da listagem de
    contas de sempre, feita só uma vez por conta nova, sem ficar
    reconsultando a Meta a cada carregamento do Painel. Análise agora só
    lista criativo ativo (pausado nunca entra) e passou a também sinalizar
    criativo sem nenhuma conversa iniciada cujo gasto já está R$ 4+ acima
    da Meta CPA (antes esse caso era descartado por não ter custo por
    conversa calculável)
13. ~~Menu suspenso legível no modo escuro (Etapa 18)~~ ✅ — os `<select>`
    de filtro (período, prioridade, tipo de conta etc.) tinham o menu
    suspenso com letra clara em fundo claro no modo escuro do navegador
    (ilegível) — corrigido globalmente com `color-scheme` no CSS, sem
    precisar mexer em cada filtro um por um
14. ~~Análise: busca, atualizar, link e filtro de status + Ritmo em
    Acompanhamento (Etapa 19)~~ ✅ — Análise ganhou busca por nome de
    criativo (global, todas as contas), botão Atualizar (sem precisar dar
    F5), o nome da conta virou link direto pro Gerenciador de Anúncios, e
    um filtro de status Ativos (padrão) / Todos. Acompanhamento
    ganhou a coluna Ritmo: quanto investir por dia até o fim do mês (sempre
    considerado com 30 dias) pra bater o Investimento mensal cadastrado
15. ~~Filtro de status da Análise: Ativos/Todos (Etapa 20)~~ ✅ — o filtro de
    status da Análise trocou de "Ativos + checkbox Incluir pausados" para
    duas opções fixas, Ativos (padrão) e Todos (ativos + pausados)
16. ~~Cor da coluna Ritmo, remoção da aba Geral e correção do
    "Carregando…" (Etapa 21)~~ ✅ — a coluna Ritmo (Acompanhamento) agora
    fica verde/laranja/vermelho conforme a diferença com o Invest. diário
    já configurado na conta (veja o ⚠️ acima); a aba "Geral" (3 KPIs soltos,
    duplicava a Visão Geral) foi removida, e a aba Visão Geral passou a
    ser a que abre por padrão; e o indicador de carregamento do Painel
    agora espera a lista de contas do Meta também terminar de carregar,
    evitando o "Mostrando 0 conta(s) selecionada(s)" passageiro
17. ~~Botão Atualizar em todas as abas do Painel (Etapa 22)~~ ✅ — o botão
    "↻ Atualizar" que já existia só em Análise agora está também em
    Acompanhamento (dados da tabela + Ritmo), Clientes e Controle de Saldo
    (contas/saldo do Meta) e Visão Geral (Campanhas/Conjuntos/Anúncios da
    conta escolhida) — dá pra puxar os dados de novo na hora, sem F5
18. ~~Filtro 3 dias + hoje, CPA ideal editável, dica com sinal e 3 filtros
    novos em Acompanhamento + menu suspenso escuro de novo (Etapa 23)~~ ✅ —
    período "Últimos 3 dias + hoje" também em Acompanhamento; nova coluna
    CPA ideal, antes da coluna CPA (editável ali e em Clientes, sincronizado);
    as dicas ao passar o mouse em Ritmo e CPA agora mostram só a diferença
    (Invest. diário − Ritmo e CPA ideal − CPA), sempre com sinal + ou -; 3
    filtros novos em Acompanhamento — Status, CPA (CPA alto) e Investimento
    (Baixo/Alto) —, todos começando em "Todos"; e ajuste mais robusto no
    `color-scheme` do menu suspenso no escuro (veja o ⚠️ acima)
19. ~~Nova aba Evolução (Etapa 24)~~ ✅ — quadro simples com o CPA de cada
    cliente dia a dia, período fixo em "últimos 7 dias + hoje" (sem
    seletor), colunas mais recentes primeiro com data + advérbio de tempo
    (Hoje/Ontem/Anteontem/dia da semana), verde até R$ 2 e vermelho acima de
    R$ 2 — valor fixo, não relativo ao CPA ideal de cada cliente (veja o ⚠️
    acima)
20. ~~Correção do cálculo e cor da coluna CPA (Etapa 25)~~ ✅ — a diferença
    mostrada era CPA ideal − CPA, o certo é CPA − CPA ideal (corrigido); o
    resultado agora aparece direto embaixo do CPA (não só numa dica ao
    passar o mouse), com um pouco mais de destaque; e a coluna CPA ganhou
    cor: verde quando o CPA está abaixo do ideal, laranja até R$ 1,40 acima
    do ideal, vermelho acima de R$ 1,40 do ideal
21. ~~Ajuste fino da coluna CPA (Etapa 26)~~ ✅ — a diferença embaixo do CPA
    estava chamando tanta atenção quanto o CPA em si; agora ela é menor e
    mais clara (opacidade reduzida), e o CPA fica maior e em negrito — quem
    precisa se destacar de cara é o CPA, a diferença é só um complemento
22. ~~Exclusão de campanhas de Tráfego/[VAGA] em Análise e Visão Geral
    (Etapa 27)~~ ✅ — Acompanhamento e Evolução já excluíam corretamente
    campanha com objetivo Tráfego (inclui "Visitas ao perfil") e campanha
    com "vaga" no nome; Análise e Visão Geral só excluíam pelo nome — agora
    as duas também excluem pelo objetivo da campanha, então nenhuma dessas
    campanhas aparece mais em nenhuma métrica, tela ou total do Painel
23. ~~Botão "Recriar conjunto" em Análise (Etapa 28)~~ ✅ — novo botão por
    criativo, ao lado do "Pausar" que já existia: pausa o criativo, pausa o
    conjunto inteiro e cria uma cópia pausada (rascunho) do conjunto, mesma
    segmentação/otimização/lance, com todos os criativos originais
    (inclusive o pausado) — excluir esse criativo na cópia, ativar o
    conjunto novo e publicar continua manual, no Gerenciador de Anúncios
    (veja o ⚠️ acima sobre os limites dessa duplicação)

Com isso, as 6 áreas do plano original + todos os extras pedidos ao longo
do caminho (CRM, Relatórios, Avisos, Status, anexos de mídia, ajustes do
Painel, ficha de Clientes, tela cheia/status colorido/reordenar, Cobranças e
Pagamentos/Tipo de conta automático, saldo disponível corrigido, Tipo de
conta 1x só + Análise refinada, menu suspenso legível no escuro, Análise
com busca/atualizar/link/filtro de status + Ritmo, filtro Ativos/Todos da
Análise, cor do Ritmo/remoção da aba Geral/correção do carregamento, botão
Atualizar em todas as abas, filtro 3 dias + hoje/CPA ideal/dicas com
sinal/3 filtros novos em Acompanhamento, aba Evolução, correção do cálculo
e cor da coluna CPA, ajuste fino da coluna CPA, exclusão consistente de
campanhas de Tráfego/[VAGA] em Análise e Visão Geral, botão "Recriar
conjunto" em Análise) estão 100% concluídos. Não há mais nenhum item
pendente do escopo combinado — próximos pedidos são novos incrementos, a
critério seu.
