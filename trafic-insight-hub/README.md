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
Painel, nas 4 abas. Painel > Análise foi reorganizada por conjunto em vez
de por criativo: mostra só conjunto ATIVO — dando duplo clique no conjunto,
expande a lista dos criativos daquele conjunto com gasto, conversas e custo
por conversa de cada um. Agora são duas análises separadas por uma aba no
topo da tela: "CPA acima da meta" (custo por conversa iniciada R$ 4 ou mais
acima da Meta CPA, ou sem nenhuma conversa iniciada com o próprio gasto R$
4 ou mais acima) com o botão "Pausar conjunto" (mexe só no conjunto) e
"Pausar criativo" em cada criativo expandido (mexe só naquele anúncio); e
"CPA abaixo da meta" (pelo menos uma conversa iniciada e custo por conversa
abaixo da Meta CPA — candidato a receber mais verba) com o botão "Aumentar
+R$2,50", que soma R$2,50 fixo ao orçamento diário daquele conjunto. A
coluna Campanha saiu da tabela (menos poluição visual — o nome ainda entra
na busca por texto). Nenhum dos botões duplica ou renomeia mais nada, e
nenhum deles mostra mais o popup de confirmação do navegador antes de agir
— o clique já dispara a ação direto; veja o ⚠️ abaixo sobre o histórico
dessa mudança de Análise e sobre a limitação do botão de aumentar
orçamento. Cada aba ganhou também um botão de ação em massa — "Pausar todos
os conjuntos listados" (aba "acima da meta") e "Aumentar todos os
orçamentos listados" (aba "abaixo da meta") — que aplica a ação em todo
mundo que está na tela naquele momento (respeitando a busca), um conjunto
de cada vez, com uma pequena pausa entre cada chamada de propósito, pra não
estourar o limite de chamadas da Meta numa conta com muitos conjuntos —
prefere demorar mais e terminar certo a arriscar bloqueio (veja o ⚠️
abaixo). Pra evitar clique sem querer numa ação que mexe em vários
conjuntos de uma vez, o botão pede um segundo clique de confirmação (sem
usar o popup do navegador) antes de rodar. Acompanhamento ganhou uma coluna
"Otimizado": um seletor simples — um clique alterna entre "Não otimizado"
(cinza) e "Otimizado" (verde), sem pedir motivo nem nada pra escrever (a
primeira versão pedia motivo antes de marcar; simplificado a pedido pra só
o clique mesmo). Um filtro Otimizado/Pendente/Todos foi junto (fixo em
"Todos" por padrão, mesmo padrão dos outros 3 filtros da tela). Essa
marcação é por dia — reseta sozinha à meia-noite (horário de Brasília) sem
precisar de nenhum job rodando por fora, veja o ⚠️ abaixo sobre como isso
funciona e sobre a nova
migração necessária. O aviso automático de saldo baixo (Mensagens → Avisos)
tinha um bug: quando o envio pro WhatsApp falhava (grupo de avisos não
configurado, instância desconectada, erro do uazapi), o erro era engolido
em silêncio — agora aparece na tela, num aviso vermelho, tanto no
carregamento normal quanto no "Verificar agora" (veja o ⚠️ abaixo). Mensagens
→ Avisos também ganhou uma segunda checagem: "Contas com erro no pagamento",
que olha o status de pagamento que a Meta devolve por conta (desabilitada,
pagamento pendente, aguardando liquidação, em período de carência) e avisa
o mesmo grupo do WhatsApp, com o mesmo cooldown de 24h — reaproveitando o
mesmo hook público que já existia (`balance-alert-tick`), sem precisar de
workflow novo no n8n (veja os ⚠️ abaixo). Em Acompanhamento, o nome da conta
agora também fica colorido: vermelho quando a conta está com erro no
pagamento, laranja quando está com saldo baixo (mesma checagem de Mensagens
→ Avisos, só que aqui em modo leitura, sem mandar aviso nenhum) — veja o ⚠️
abaixo sobre qual cor "ganha" quando os dois casos acontecem ao mesmo tempo.
A ordem da lateral do Painel mudou a pedido: Acompanhamento, Análise,
Evolução, Visão Geral, Controle de Saldo, Clientes. E o Painel agora lembra
em qual aba (e com quais filtros) você estava — dar F5 não joga mais de
volta pra Visão Geral do zero, volta pra onde você tinha deixado, com os
mesmos filtros. A aba "CPA acima da meta" de Análise ganhou dois critérios
diferentes (Etapa 40): Conjuntos (limite mais rígido — custo por conversa
no TRIPLO ou mais da Meta CPA, ou sem conversa com o próprio gasto já no
triplo ou mais — subiu do dobro pro triplo na Etapa 44) e Criativos
(limite mais sensível — R$4+ acima da Meta CPA, com ou sem conversa —
subiu de R$2 pra R$4 na Etapa 45 —, de propósito, pra pegar o problema no
criativo antes de precisar sinalizar o conjunto inteiro). A pedido
(Etapa 41), Conjuntos e
Criativos viraram duas TELAS separadas dentro da aba "CPA acima da meta"
— um botão igual ao de "CPA acima da meta"/"CPA abaixo da meta" alterna
entre as duas, em vez de ficarem empilhadas na mesma tela; a aba "CPA
abaixo da meta" continua só com Conjuntos, sem esse botão (não existe
Criativos ali). Conjuntos mantém a expansão pra ver os criativos daquele
conjunto por duplo clique; Criativos é uma lista à parte — cada uma com
seu próprio botão de pausar individual e em massa. Além do botão "Pausar
todos os listados" de cada tela, agora também dá pra marcar uma caixinha
por linha (Etapa 42) e usar "Pausar selecionados" pra pausar só quem foi
marcado, em vez de sempre todo mundo da lista. Cada tela só busca dado da
Meta enquanto você está olhando ela especificamente, economizando chamada
à API (veja o ⚠️ abaixo). As duas telas (Conjuntos e Criativos) destacam em
verde (bem sutil) qualquer conjunto ou criativo cuja média de custo por
conversa nos ÚLTIMOS 7 DIAS — sempre fixo, independente do período
escolhido na tela — já esteja abaixo da Meta CPA, como um aviso de "isso
pode já estar melhorando" (a aba "CPA abaixo da meta" não mudou e não tem
esse destaque, já que ali tudo já está abaixo da meta por definição). Veja
o ⚠️ abaixo sobre os limites e a checagem de 7 dias. A tela Conjuntos (aba
"CPA acima da meta") agora também mostra, com um selo vermelho "Sem
anúncio ativo" ao lado do nome, qualquer conjunto ativo que não tenha
nenhum anúncio ativo dentro dele (Etapa 46) — entra na lista mesmo que não
bata o limite de CPA, já que sem anúncio ativo às vezes nem tem gasto no
período pra calcular nada; veja o ⚠️ abaixo sobre como essa checagem
funciona e por que só está nessa tela/aba. O filtro de período de
Acompanhamento ganhou uma nova opção, "Ontem e hoje" (Etapa 47) — veja o
⚠️ abaixo. A tela Evolução (Etapa 48) ganhou uma coluna fixa "Mensal" (CPA
do mês atual, antes da coluna "Hoje"), corrigiu o dia de hoje que não
aparecia, e agora colore cada célula (diária ou mensal) comparando com o
CPA ideal do cliente — verde abaixo do ideal, laranja até R$2 acima,
vermelho passando de R$2 acima — em vez do corte fixo de R$2 igual pra
todo mundo que tinha antes; Mensagens → Avisos ganhou uma terceira
checagem, "CPA acima da meta ontem", que manda uma única mensagem pro
grupo de WhatsApp com todo cliente que passou R$2 do CPA ideal no dia
anterior, da conta mais crítica pra menos crítica, pensada pra rodar
automaticamente 1x por dia de manhã (07h sugerido) via um novo hook
público. Veja os ⚠️ abaixo sobre as duas coisas. A tela Evolução (Etapa
49) ganhou mais um ajuste: uma coluna "CPA ideal" antes da coluna
"Mensal", e as linhas agora vêm ordenadas pelo CPA do mês (coluna
"Mensal"), do maior pro menor — quem está pior aparece primeiro. O selo
"Sem anúncio ativo" em Análise → Conjuntos (Etapa 50) foi corrigido: antes
ficava escondido pelo corte de texto do nome em conjuntos com nome longo,
e as colunas de custo/diferença sempre voltavam em traço mesmo quando
havia gasto e conversa reais no período — agora o selo sempre aparece e as
métricas reais são mostradas normalmente. Com
isso, todas as
áreas do plano original + os extras pedidos ao longo do caminho estão
100% concluídas.

⚠️ **Antes de testar a coluna "Otimizado" (Acompanhamento)**: essa entrega
inclui as migrações `0010_client_optimized.sql` e `0011_drop_optimized_reason.sql`
— rode as duas (nessa ordem) no SQL Editor do Supabase antes de usar essa
coluna/filtro, senão vai dar erro de coluna inexistente. Sobre o reset à
meia-noite (BRT): não existe nenhum job/cron rodando por fora apagando a
marcação — a data de quando você marcou fica salva, e toda vez que a tela
de Acompanhamento busca os dados de novo (ao abrir a aba, dar F5, ou trocar
de aba e voltar) o servidor confere se essa data ainda é "hoje" em horário
de Brasília; se não for, devolve "Não otimizado" de novo pra tela, mesmo
sem apagar nada no banco. Ou seja, o reset é na LEITURA, não num horário
fixo cravado — se você deixar a aba de Acompanhamento aberta sem recarregar
atravessando a meia-noite, o selo só volta pra "Não otimizado" na próxima
vez que a tela buscar os dados de novo, não sozinho às 00h00 em tempo real.
Marcar como otimizado é por conta, não por cliente/campanha — pensado pra
revisão diária "essa conta eu já mexi hoje". Se você já rodou a
`0010_client_optimized.sql` numa entrega anterior, só falta rodar a nova
`0011` — ela apenas remove a coluna de motivo, que não existe mais na tela
(a marcação virou um clique só, sem pedir texto nenhum).

⚠️ **Sobre o conserto do aviso de saldo baixo, e a nova checagem de erro de
pagamento (Etapa 38)**: o aviso de saldo baixo não estava saindo porque o
código que manda a mensagem pro WhatsApp engolia qualquer erro em silêncio
— se o grupo de avisos não estava configurado em Configurações → WhatsApp,
ou se o envio pelo uazapi falhava por qualquer motivo, a tela de Avisos
simplesmente não mostrava nada de errado (podia até dizer "Nenhuma conta com
saldo baixo agora" mesmo tendo conta com saldo baixo de verdade). Agora
qualquer erro nesse envio aparece direto na tela, num aviso vermelho, tanto
ao abrir a aba quanto ao clicar em "Verificar agora" — se ainda não sair o
WhatsApp, o motivo agora fica visível ali (grupo não configurado, instância
desconectada, erro do uazapi, etc.). Além disso, Mensagens → Avisos ganhou
uma segunda checagem, nova: "Contas com erro no pagamento" — olha o status
de pagamento que a própria Meta devolve pra cada conta vinculada (conta
desabilitada, pagamento pendente, aguardando liquidação, em período de
carência) e avisa o mesmo grupo do WhatsApp quando encontra alguma, com o
mesmo cooldown de 24h por conta do aviso de saldo. Essa checagem entrou no
MESMO hook público que já existia (`balance-alert-tick`) — não precisa criar
nenhum workflow novo no n8n, o que você já tem configurado (passo 8, item
"Deploy na Vercel") passa a rodar as duas checagens automaticamente. Essa
entrega inclui uma nova migração, `0012_payment_alerts.sql` — rode ela no
SQL Editor do Supabase (veja o passo 11) antes de usar essa nova seção,
senão dá erro de coluna inexistente.

⚠️ **Sobre o critério de "erro no pagamento" (Etapa 38)**: a Meta não tem um
campo único e óbvio pra "está com problema de pagamento" — o código combina
dois campos do Graph API: `account_status` (considerando erro quando vem
`DISABLED`, `UNSETTLED`, `PENDING_SETTLEMENT` ou `IN_GRACE_PERIOD` — os 4
status ligados a cobrança/liquidação, ignorando outros tipos de status como
revisão de risco) e `disable_reason` (só quando é especificamente
`RISK_PAYMENT`, ou seja, desabilitada por risco de pagamento). É uma leitura
por analogia com a documentação da Meta, não confirmada contra uma conta
real desabilitada — vale conferir o primeiro aviso de verdade contra a tela
de Cobranças e Pagamentos da conta antes de confiar de olhos fechados; se
sobrar ou faltar algum status nessa lista, me fala que ajusto.

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

⚠️ **Sobre os botões de ação em massa (Pausar todos / Aumentar todos)**: pra
reduzir o risco de bloqueio por limite de chamadas da Meta (rate limit) ao
mexer em muitos conjuntos de uma vez, as chamadas são feitas uma de cada
vez — nunca em paralelo — com uma pausa de 3s entre elas (aumentada a
pedido na Etapa 34, era ~0,8s); num lote de 20 conjuntos isso leva uns
60 segundos, de propósito (mais devagar, mais seguro). Além disso, toda chamada de escrita na Graph API (`metaPost`,
usada por pausar, ativar e aumentar orçamento — em massa ou individual)
agora tenta de novo sozinha até 3 vezes quando o erro é claramente
temporário (erro 5xx/429) ou um erro clássico de "muitas chamadas" da
própria Meta (códigos 4, 17, 32, 613, 80004), com uma espera bem maior
nesse segundo caso antes de tentar de novo. Erro de um conjunto específico
não trava o lote inteiro — o restante continua, e no final aparece um
resumo (nome + motivo) de quem não deu certo, pra você resolver manualmente
o que sobrou. Ainda assim, numa conta com dezenas de conjuntos flagrados ao
mesmo tempo, ainda existe a chance de a Meta aplicar um bloqueio temporário
de qualquer forma (o limite dela é por conta de anúncios/app, fora do
controle do código) — se isso acontecer, o jeito é esperar alguns minutos e
rodar de novo só o que ficou faltando.

⚠️ **Sobre o botão "Aumentar +R$2,50" (aba "CPA abaixo da meta")**: ele
aumenta o orçamento DIÁRIO do próprio conjunto (`daily_budget`), sempre um
valor fixo de R$2,50, sem lógica de porcentagem nem de escala progressiva —
cada clique soma mais R$2,50 em cima do que já está. Se o conjunto usa
orçamento vitalício (lifetime) em vez de diário, ou se o orçamento dele
está de fato na campanha (CBO puro, sem orçamento próprio no conjunto), o
botão avisa isso na tela e não muda nada — não há fallback automático pra
mexer na campanha. Depois de aumentar uma vez, o botão fica marcado "✓
Aumentado" e travado até você clicar em "Atualizar" ou trocar de aba/
período, só pra evitar clique duplicado sem querer; ele não reflete o
orçamento novo de verdade, é só uma trava visual da sessão.

⚠️ **Sobre a aba "CPA abaixo da meta"**: não tem um piso de distância da
meta (diferente da aba "acima" — veja os novos limites dela logo abaixo,
Etapa 40) — qualquer conjunto ativo com pelo menos 1 conversa iniciada e
custo por conversa menor que a Meta CPA já aparece, mesmo que seja só
alguns centavos abaixo. Se isso trouxer conjunto demais pra lista, é só
avisar que dá pra somar um piso.

⚠️ **Sobre os limites das telas Conjuntos/Criativos e o destaque de 7 dias
(Etapas 40, 44 e 45)**: a aba "CPA acima da meta" tem dois critérios
DIFERENTES um do outro, de propósito — Conjuntos exige uma diferença bem
maior (custo por conversa no TRIPLO ou mais da Meta CPA — subiu do dobro
pro triplo na Etapa 44 —, ou sem conversa com o próprio gasto já no
triplo ou mais, mesmo limite pros dois casos) antes de sugerir pausar o
conjunto inteiro, enquanto Criativos usa um limite mais sensível (R$4+
acima da Meta CPA, com ou sem conversa — subiu de R$2 pra R$4 na Etapa
45) pra pegar o criativo problemático cedo, antes que o conjunto precise
ser sinalizado. Além
disso, cada linha (conjunto ou criativo) busca também um recorte FIXO de
"últimos 7 dias" — sempre o mesmo, independente do período escolhido no
seletor da tela — só pra saber se a média de custo por conversa nesse
recorte fixo já está abaixo da Meta CPA; quando está, a linha fica com um
fundo verde bem sutil (só um aviso visual de "isso pode já estar
melhorando", não muda o que entra ou sai da lista nem interfere nos
botões de pausar). A tela Criativos é nova só na interface: a mesma
análise por criativo (com custo por conversa iniciada) já existia no
código desde as Etapas 11-17, só não estava mais ligada na tela desde que
a Etapa 31 reorganizou Análise por conjunto.

⚠️ **Sobre Conjuntos e Criativos virarem telas separadas (Etapa 41)**: até
a Etapa 40 as duas listas ficavam empilhadas na mesma tela, uma embaixo da
outra; a pedido, agora só uma aparece por vez, alternada por um botão
("Conjuntos" / "Criativos") igual ao de "CPA acima da meta"/"CPA abaixo da
meta", que só aparece quando a aba "CPA acima da meta" está selecionada (a
aba "CPA abaixo da meta" só tem Conjuntos, então não tem esse botão). Isso
trouxe um efeito colateral bom: antes as duas chamadas à Meta (Conjuntos e
Criativos) saíam juntas sempre que a aba "CPA acima da meta" abria ou
atualizava, mesmo se você estivesse olhando só uma das duas; agora só sai
a chamada da tela que está na frente, evitando gastar chamada à toa com a
tela que você não está olhando no momento.

⚠️ **Sobre a caixa de seleção pra pausar em massa (Etapa 42)**: Conjuntos e
Criativos (aba "CPA acima da meta") ganharam uma caixinha por linha, mais
um checkbox "Selecionar todos os listados" que marca/desmarca tudo que
está na tela naquele momento (respeitando a busca). O botão "Pausar todos
os conjuntos/criativos listados" continua exatamente igual, ignorando a
seleção — pausa todo mundo que está listado, marcado ou não. Do lado, um
novo botão "Pausar selecionados" só aparece com contagem quando pelo menos
uma caixinha está marcada, e some (volta a mostrar "(0)") quando nenhuma
está — segue o mesmo esquema de segundo clique pra confirmar dos outros
botões em massa, mesma pausa de 3s entre cada chamada, mesmo resumo de
erro no final. A seleção é só uma trava de tela: some sozinha ao trocar de
conta/período/tela ou ao dar "↻ Atualizar", já que a lista é buscada de
novo do zero. A tela "CPA abaixo da meta" (aumentar orçamento) não ganhou
caixinha — só as duas que pausam.

⚠️ **Sobre o bug do botão de ação em massa desarmando sozinho (Etapa 43)**:
reportado assim: clicar em "Pausar selecionados" mostrava o aviso vermelho
"Confirma...?" e voltava pro normal quase na hora, sem dar tempo nem pro
segundo clique de confirmação. Causa raiz: o código guarda o estado de
cada botão de ação em massa (armado, rodando, progresso, erros) num hook
próprio (`useBulkRunner`), e o efeito que desarma os botões sozinho ao
trocar de aba/tela/período estava, por engano, com esses objetos inteiros
na lista de dependências do `useEffect`, em vez de só a função de desarmar
de cada um. Como esses objetos são recriados a cada vez que a tela
renderiza de novo — inclusive no exato instante em que o clique em
"arm" acontece —, o efeito rodava de novo imediatamente e desarmava o
botão sozinho, no mesmo instante em que ele tentava armar. Na prática isso
podia afetar qualquer botão de ação em massa da tela (inclusive "Pausar
todos os listados"), não só o novo "Pausar selecionados" — só não tinha
sido notado antes. Corrigido trocando a dependência pelas funções de
desarmar isoladas (essas sim estáveis entre renders).

⚠️ **Sobre o selo "Sem anúncio ativo" em Conjuntos (Etapa 46)**: a
Auditoria já tinha, desde antes, uma checagem parecida ("Conjunto ativo
sem anúncio ativo") — a Etapa 46 trouxe essa mesma ideia pra dentro da
tela Análise → Conjuntos, na aba "CPA acima da meta". Um conjunto entra na
lista, com o selo vermelho, sempre que ele está ATIVO mas nenhum anúncio
dentro dele está ATIVO — não importa o CPA, entra mesmo com custo/conversa
baixo ou até sem nenhum gasto no período (o que costuma acontecer, já que
sem anúncio rodando não há mais gasto novo entrando). Nessas linhas as
colunas "Custo/conversa" e "Diferença" ficam com um traço — não fazem
sentido sem anúncio ativo gerando dado — e, se o conjunto expandido não
tiver nenhum anúncio com gasto no período, aparece um aviso no lugar da
lista de criativos em vez de uma tabela vazia. Assumi que esse aviso só
faz sentido na aba "CPA acima da meta" (é uma tela de "o que precisa de
atenção") — não entrou na aba "CPA abaixo da meta" (candidatos a escalar,
não faz sentido escalar um conjunto sem anúncio rodando) nem na tela
Criativos (o pedido foi especificamente "na tela de conjuntos"); se
quiser esse aviso em outro lugar também, é só pedir. Tecnicamente, a
checagem usa o mesmo truque de filtro de edge do Graph API que a
Auditoria já usava (`ads.effective_status(['ACTIVE']).limit(1)`) — traz,
pra cada conjunto ativo da conta, se existe pelo menos 1 anúncio ativo
dentro dele, numa única chamada extra por conta, sem precisar buscar a
lista inteira de anúncios de novo.

⚠️ **Conserto do selo "Sem anúncio ativo" (Etapa 50)**: dois problemas
reportados nessa linha. Primeiro, o selo vermelho "Sem anúncio ativo"
ficava dentro da mesma célula truncada do nome do conjunto — em nome
comprido (comum, tipo "PROMO SETEMBRO | MULTIFOCAL EM DOBRO (...)"), o
corte de texto (`truncate`) escondia o selo inteiro junto com o final do
nome, então na prática ele nunca aparecia. Corrigido separando o nome (que
trunca sozinho) do selo (que agora sempre fica visível do lado, sem
encolher). Segundo — e esse era o pedido principal — as colunas "Custo/
conversa" e "Diferença" dessas linhas estavam SEMPRE em traço, mesmo
quando o conjunto tinha gasto e conversa reais no período (só não tinha
anúncio ATIVO no momento — o anúncio que gerou aquele gasto pode ter sido
pausado depois). Agora essas colunas mostram a métrica de verdade sempre
que há dado pra calcular (mesma regra "sem conversa = traço" de qualquer
outra linha) — o selo continua avisando que não tem anúncio ativo, mas não
apaga mais o resultado real do período. Único caso que ainda mostra
traço/diferença negativa "estranha" é o conjunto SEM NENHUM gasto no
período (a entrada "vazia" que a Etapa 46 criou só pra avisar da falta de
anúncio ativo) — aí não tem métrica real nenhuma pra mostrar mesmo.

⚠️ **Sobre o novo filtro "Ontem e hoje" (Etapa 47)**: pedido pra
Acompanhamento, mas foi adicionado na lista compartilhada de períodos
(`DATE_PRESETS`) que várias telas usam — Acompanhamento, Análise, Visão
Geral e o agendamento de Relatórios (Mensagens) — então a nova opção
aparece em todos esses seletores, não só em Acompanhamento; se preferir
que fique só em Acompanhamento, é só pedir pra tirar dos outros. O cálculo
em si (ontem 00h00 até agora, fuso de Brasília) já existia pronto no
código desde a reconstrução original — só nunca tinha entrado em nenhum
filtro visível na tela.

⚠️ **Sobre os consertos da tela Evolução (Etapa 48)**: o dia de "Hoje"
ficava sempre "—" porque a busca por dia (que traz um dia por vez, do mais
antigo ao mais recente) parece simplesmente não trazer nenhuma linha pro
dia ainda em andamento — provavelmente uma particularidade da própria API
da Meta com esse tipo de busca quebrada por dia. Corrigido buscando hoje
SEPARADO, com `date_preset: "today"` (uma busca agregada, sem quebra por
dia) — a mesma técnica que Acompanhamento já usa com sucesso — e
substituindo o ponto de hoje no gráfico por esse valor. Mesmo com o
conserto, "Hoje" ainda pode aparecer como "—" por um tempo se ainda não
tiver nenhuma conversa iniciada registrada no dia (a Meta pode levar
algumas horas pra atribuir conversas do dia corrente) — isso é esperado,
não é bug, e é o mesmo comportamento de "sem conversa" que já existe no
resto do Painel. A cor de cada célula (diária ou da nova coluna Mensal)
agora usa a mesma régua da coluna CPA de Acompanhamento — verde abaixo do
CPA ideal do cliente, laranja até R$2 acima, vermelho passando de R$2
acima —, com banda de R$2 em vez dos R$1,40 de Acompanhamento, a pedido.
Cliente sem CPA ideal cadastrado fica sem cor (não dá pra comparar com
nada). A coluna "Mensal" reaproveita a mesma agregação de mês atual já
usada no Ritmo de Acompanhamento (`date_preset: "this_month"`), então o
número bate com o que você já vê lá.

⚠️ **Sobre a coluna CPA ideal e a ordenação de Evolução (Etapa 49)**: a
nova coluna "CPA ideal" só mostra o valor cadastrado (Clientes/
Acompanhamento) — sem cor, é só referência ao lado da coluna Mensal, que
já é colorida comparando com esse mesmo valor. A ordenação usa sempre o
CPA do MÊS (coluna Mensal), do maior pro menor, independente do CPA ideal
de cada um — não é ordenado pela diferença/pior-em-relação-à-meta, é o
valor absoluto do CPA mensal mesmo (dois clientes com CPA parecido ficam
próximos na lista mesmo que um deles tenha uma meta bem mais alta que o
outro); cliente sem dado de mês ainda (conta nova, por exemplo) vai pro
final da lista, não pro topo.

⚠️ **Sobre o aviso "CPA acima da meta ontem" (Etapa 48)**: roda pra toda
conta com CPA ideal cadastrado (Clientes/Acompanhamento) — quem não tem
CPA ideal não entra nem na tela nem no aviso, não tem como julgar "acima
da meta" sem uma meta. Entra na mensagem quem teve o CPA de ONTEM (usando
a mesma fonte oficial que Acompanhamento usa pro CPA, `cost_per_result`
da Meta, já com a mesma regra de excluir campanha [VAGA]/objetivo de
reconhecimento-tráfego e considerar só anúncio ativo) mais de R$2 acima do
CPA ideal — ficou na média ou abaixo não aparece na mensagem, só entra
quem está "vermelho". Vai numa única mensagem de texto pro grupo de
WhatsApp configurado em Configurações → WhatsApp (mesmo grupo dos outros
avisos), com nome do cliente, CPA ideal e CPA de ontem por linha, da conta
mais crítica (maior diferença acima da meta) pra menos crítica. Ao
contrário do aviso de saldo baixo e de erro no pagamento, ESSE aviso não
tem cooldown de 24h — a ideia é rodar uma vez por dia via o novo hook
`cpa-alert-tick` (passo 9 da seção de deploy), então não tem por que
segurar reenvio; se você clicar "Verificar agora" mais de uma vez no
mesmo dia com contas críticas, ele reenvia a mesma mensagem de novo — é
esperado, não um bug. Se nenhuma conta ficar acima do limite, nenhuma
mensagem é enviada (mesmo comportamento dos outros dois avisos — nunca
manda um "está tudo bem").

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

⚠️ **Sobre a cor do nome da conta em Acompanhamento (Etapa 39)**: usa a
mesma checagem de Mensagens → Avisos (saldo baixo e erro no pagamento — veja
os ⚠️ acima sobre os dois), só que em modo leitura, sem mandar nenhum aviso
pro WhatsApp — só busca esse status quando a aba Acompanhamento está ativa
(mesmo critério das outras chamadas do Meta no Painel) e atualiza junto com
o botão "↻ Atualizar" da aba. Se uma conta estiver com erro no pagamento E
com saldo baixo ao mesmo tempo, o vermelho (erro no pagamento) tem
prioridade sobre o laranja (saldo baixo) — passe o mouse no nome da conta
pra ver qual dos dois está sendo sinalizado. Herda as mesmas condições do
saldo baixo (só entra quem é Pré-paga/Híbrida com limite definido) e do erro
no pagamento (entra qualquer conta vinculada) já explicadas acima.

⚠️ **Sobre o Painel lembrar a aba/filtros entre sessões (Etapa 39)**: a aba
ativa e os filtros de Acompanhamento, Análise e Visão Geral ficam salvos no
Supabase (reaproveitando a tabela `user_ui_prefs` que já existia, sem
migração nova) — nunca em localStorage/sessionStorage, mesmo critério já
usado na reordenação por arrastar-e-soltar de Acompanhamento, pra valer
igual em qualquer navegador/computador que você use pra acessar o Painel.
Evolução, Controle de Saldo e Clientes não têm filtro nenhum pra lembrar
(Evolução tem período fixo; os outros dois não têm filtro de tela). Num
acesso totalmente novo (sem nada salvo ainda), o Painel continua abrindo em
Visão Geral, sem filtro nenhum ativo, do jeito que já era.

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
vez de uma escolha do navegador.

⚠️ **Sobre o menu suspenso ilegível no modo escuro, de novo de novo (Etapa
35)**: mesmo com o `color-scheme: dark` explícito da Etapa 23, o print que
você mandou (filtro "Investimento" em Acompanhamento) mostrou o popup do
`<select>` ainda desenhado claro, com a letra clara do tema escuro herdada
por cima — exatamente "letra branca em fundo branco". O motivo mais
provável: o `color-scheme` do popup do `<select>` tem suporte inconsistente
entre navegador/versão (mesmo declarando "dark" explícito, alguns não
repintam o popup de verdade), enquanto a cor do texto (herdada do resto da
página) muda de qualquer forma — daí o descompasso. Pra não depender mais
desse suporte instável, a solução mudou de estratégia: agora o popup do
`<select>` é sempre forçado pro esquema claro (`color-scheme: light` fixo
nele) com a cor do texto das opções travada em escuro
(`select option { color: #171717; background-color: #ffffff }`), não
importa o tema da página. Ou seja, o popup deixa de "seguir" o tema escuro
visualmente, mas fica sempre legível (fundo branco, letra escura) em
qualquer navegador — a caixa fechada do filtro continua no visual escuro
normal, só o menu aberto que agora é sempre claro, de propósito. Se mesmo
assim aparecer algo ilegível, me manda o navegador (nome + versão) porque
nesse ponto já seria um caso bem fora do padrão.

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

⚠️ **Sobre a Análise por conjunto e os botões de pausar — histórico (Etapas
28-31)**: as duas primeiras versões (Etapas 28 e 29) tentavam duplicar o
conjunto automaticamente pela Graph API — mesma ideia do "Duplicar" do
Gerenciador de Anúncios, feita na raça via chamadas diretas — pra criar uma
cópia pausada com todos os criativos originais, inclusive o que tinha
acabado de ser pausado. A Etapa 29 corrigiu um bug real de endpoint
(criava no nó errado, `/{campanha}/adsets` e `/{conjunto}/ads`, que só
servem pra listar; o certo é `/act_{conta}/adsets` e `/act_{conta}/ads`),
mas mesmo corrigido esbarrou num limite da própria Meta que não tem como
contornar por fora: criar um anúncio NOVO exige que a Página do criativo
esteja compartilhada (dona ou parceira) com o Portfólio de Negócios dono da
conta de anúncios, e nem toda conta do usuário tem esse compartilhamento. A
Etapa 30 simplificou pra um botão só de pausar + renomear (sem duplicar
nada), mas mesmo essa versão mais simples não funcionou como esperado ao
testar de verdade. Por isso a Etapa 31 simplificou de novo, isolando as
variáveis: os dois botões atuais ("Pausar conjunto" e "Pausar criativo")
não renomeiam nem duplicam mais nada — cada um faz só uma chamada de
pausar, exatamente a mesma chamada simples (`/api/meta/status`) que já
funciona hoje em Visão Geral/Controle de Saldo/Clientes. Se mesmo assim
"Pausar conjunto" continuar falhando, o próximo passo é comparar lado a
lado com o pausar de conjunto que já funciona em Visão Geral, pra achar a
diferença. Recriar o conjunto do zero (mesma segmentação/otimização/lance,
minus o criativo ruim) continua 100% manual, no Gerenciador de Anúncios.

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
11. Cole o conteúdo de `supabase/migrations/0010_client_optimized.sql`,
    depois `0011_drop_optimized_reason.sql` e depois
    `0012_payment_alerts.sql`, nessa ordem (a coluna "Otimizado" de
    Acompanhamento e o controle de reaviso da nova checagem de erro no
    pagamento).
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
9. (Opcional, mas recomendado) Crie um quinto workflow no n8n com **Schedule
   Trigger** configurado pra rodar 1x por dia, às 07h (horário de Brasília)
   → **HTTP Request** `POST` para
   `https://SEU_DOMINIO/api/public/hooks/cpa-alert-tick` com o mesmo header
   `x-webhook-secret`. Isso manda a mensagem de "CPA acima da meta ontem"
   (Mensagens → Avisos, Etapa 48) sozinha toda manhã. Veja o ⚠️ mais abaixo
   sobre esse aviso não ter cooldown — configure o Schedule Trigger pra
   rodar só uma vez por dia mesmo, sem repetir.
10. Anexos de mídia (Mensagens → Envio) não precisam de nenhum workflow novo
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
    alerts/payment  → status de erro no pagamento + "Verificar agora" (Mensagens > Avisos)
    alerts/cpa      → status de CPA acima da meta ontem + "Verificar agora" (Mensagens > Avisos, Etapa 48)
    priority-labels → rótulos/cores de prioridade personalizados (Configurações > Status)
    public/hooks/whatsapp-dispatch-tick  → chamado pelo n8n, não pelo navegador
    public/hooks/audit-tick              → idem, roda as duas auditorias
    public/hooks/crm-lead-ingest         → idem, cria lead novo por public_token
    public/hooks/report-tick             → idem, dispara os relatórios agendados
    public/hooks/balance-alert-tick      → idem, checa e avisa saldo baixo E erro no pagamento
    public/hooks/cpa-alert-tick          → idem, avisa CPA acima da meta ontem (Etapa 48, sugerido 1x/dia às 07h)
    selected-accounts, account-bindings, account-bindings/reorder,
    pix-accounts, focus-groups
    painel-ui-state  → lembra a aba ativa + filtros de Acompanhamento/Análise/
                       Visão Geral entre sessões (reaproveita user_ui_prefs)
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
                  e na tela Evolução (Etapa 48: hoje buscado à parte com
                  date_preset "today" pra não sumir quando a quebra por dia
                  não traz o dia em andamento; getAccountsMonthCpa para o
                  CPA fixo do mês atual, mesma agregação do Ritmo)
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
                  role); tem cooldown de 24h por conta pra não reavisar toda
                  hora; erro no envio (WhatsApp) volta explícito em vez de
                  ser engolido em silêncio (Etapa 38)
  payment.ts    → checa erro no pagamento (account_status/disable_reason da
                  Meta) em TODAS as contas vinculadas e manda o aviso pro
                  mesmo grupo — mesmo padrão de balance.ts (cooldown de 24h,
                  compartilhado entre "Verificar agora" e o hook público)
  cpa.ts        → Etapa 48: checa o CPA de ONTEM (getAccountsInsights, mesma
                  fonte oficial usada em Acompanhamento) de toda conta com
                  CPA ideal cadastrado, e manda UMA mensagem só, com quem
                  ficou mais de R$2 acima da meta, da mais crítica pra menos
                  crítica — compartilhado entre "Verificar agora" e o hook
                  público cpa-alert-tick; SEM cooldown de 24h (ver ⚠️)
lib/scheduling.ts → regra de recorrência genérica (soma o intervalo à última
                    ocorrência, preservando dia da semana/mês) — usada pelos
                    disparos de WhatsApp e pelos relatórios agendados
lib/priority-context.tsx → Context/Provider dos rótulos de prioridade
                            personalizados (busca uma vez, compartilha entre
                            Painel, diálogo de status em massa e Configurações)
lib/hooks/use-painel-ui-state.ts → hook que carrega/salva (com debounce) a
                            aba ativa + filtros do Painel via /api/painel-ui-state
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
supabase/migrations/0010_client_optimized.sql → coluna "Otimizado" (+ data de referência) em Acompanhamento
supabase/migrations/0011_drop_optimized_reason.sql → remove a coluna de motivo do "Otimizado" (não usada mais)
supabase/migrations/0012_payment_alerts.sql → controle de reaviso (24h) da checagem de erro no pagamento
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
   hook `balance-alert-tick`, e aviso automático de CPA acima da meta
   ontem (mais de R$2 do CPA ideal, mensagem única e ordenada por
   criticidade) via hook `cpa-alert-tick` (Etapa 48)
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
23. ~~Botão "Recriar conjunto" em Análise + correção de endpoint (Etapas
    28-29)~~ ✅ — histórico: tentativa de duplicar o conjunto automaticamente
    pela Graph API (mesma ideia do "Duplicar" do Gerenciador de Anúncios);
    corrigido um bug real de endpoint na Etapa 29; substituído na Etapa 30
    (veja o item abaixo e o ⚠️ acima) por esbarrar num limite da própria
    Meta sem solução por fora (Página do criativo precisa estar
    compartilhada com o Portfólio de Negócios dono da conta)
24. ~~Botão "⏸️ Pausar conjunto" simplificado (Etapa 30)~~ ✅ — histórico:
    trocou o botão anterior por só pausar o criativo, pausar o conjunto e
    acrescentar "AQUI" no final do nome dele — sem tentar duplicar nada;
    substituído de novo na Etapa 31 (veja o item abaixo e o ⚠️ acima) porque
    não funcionou como esperado ao testar de verdade
25. ~~Análise reorganizada por conjunto, com criativos expansíveis (Etapa
    31)~~ ✅ — a tela de Análise passou a listar CONJUNTO em vez de
    criativo: só conjunto ativo com custo por conversa iniciada R$ 4 ou mais
    acima da Meta CPA (ou, sem conversa nenhuma, com o próprio gasto R$ 4 ou
    mais acima) — duplo clique no conjunto expande a lista dos criativos
    dele (gasto, conversas, custo por conversa de cada). "Pausar conjunto" e
    "Pausar criativo" viraram dois botões isolados, cada um só faz a chamada
    simples de pausar (mesma usada em Visão Geral) — sem renomear, sem
    duplicar, pra isolar de vez qualquer causa de falha (veja o ⚠️ acima)
26. ~~Análise com duas abas (acima/abaixo da meta), coluna Campanha
    removida, aumento de orçamento e popups de confirmação removidos (Etapa
    32)~~ ✅ — Análise por conjunto agora tem duas abas: "CPA acima da
    meta" (comportamento de sempre, "Pausar conjunto"/"Pausar criativo") e a
    nova "CPA abaixo da meta" (conjunto ativo com conversa e custo por
    conversa menor que a Meta CPA), onde o botão vira "Aumentar +R$2,50" —
    soma um valor fixo ao orçamento diário do conjunto (veja os ⚠️ acima
    sobre os limites dele). A coluna Campanha saiu da tabela (nome ainda
    entra na busca). Os popups de confirmação do navegador antes de pausar
    também saíram — os botões agem direto no clique
27. ~~Ações em massa na Análise, com backoff de rate limit (Etapa 33)~~ ✅ —
    cada aba ganhou um botão pra aplicar a ação em todos os conjuntos
    listados de uma vez ("Pausar todos os conjuntos listados" /
    "Aumentar todos os orçamentos listados"), pedindo um segundo clique de
    confirmação (sem popup do navegador) antes de rodar. As chamadas saem
    uma de cada vez com pausa entre elas (nunca em paralelo), e toda escrita
    na Graph API ganhou retry automático com backoff mais longo pra erro de
    "muitas chamadas" da própria Meta — prioriza terminar certo a arriscar
    bloqueio por volume (veja o ⚠️ acima)
28. ~~Pausa entre chamadas em massa aumentada pra 3s (Etapa 34)~~ ✅ — o
    intervalo entre cada chamada das ações em massa (Etapa 33) subiu de
    ~0,8s pra 3s, a pedido, pra ficar ainda mais folgado em relação ao
    limite de chamadas da Meta — um lote de 20 conjuntos passa a levar uns
    60 segundos em vez de 15-20
29. ~~Popup do &lt;select&gt; sempre legível no modo escuro, de vez (Etapa
    35)~~ ✅ — o `color-scheme: dark` explícito da Etapa 23 continuava
    inconsistente entre navegadores (popup do filtro ainda aparecia claro
    com letra clara por cima, como no print do filtro Investimento em
    Acompanhamento); trocado por uma abordagem que não depende mais do
    navegador honrar o tema escuro no popup: o menu do `<select>` agora é
    sempre forçado pro esquema claro com cor de texto escura fixa nas
    opções, garantindo contraste em qualquer navegador — só o menu aberto
    muda, a caixa fechada do filtro continua acompanhando o tema escuro
    normalmente (veja o ⚠️ acima)
30. ~~Coluna "Otimizado" em Acompanhamento, com reset diário (Etapa 36)~~ ✅
    — selo "Pendente"/"✓ Otimizado" por conta, marcado manualmente (pede o
    motivo inline, sem popup, ao marcar; desmarcar é direto), com filtro
    Otimizado/Pendente/Todos (fixo em "Todos"). Reseta sozinho à meia-noite
    (horário de Brasília) sem job/cron por fora — a leitura recalcula se a
    marcação ainda vale hoje (veja o ⚠️ acima sobre a migração nova e sobre
    como o reset funciona na prática); substituído no item abaixo (Etapa 37)
31. ~~Coluna "Otimizado" simplificada pra seletor sem motivo (Etapa 37)~~ ✅
    — a pedido, tirou o "pede motivo" da Etapa 36: agora é só um seletor —
    um clique alterna entre "Não otimizado" (cinza) e "Otimizado" (verde),
    sem caixa de texto nenhuma. A coluna de motivo saiu do banco também
    (migração `0011_drop_optimized_reason.sql`, veja o ⚠️ acima)
32. ~~Conserto do aviso de saldo baixo + nova checagem de erro no pagamento
    (Etapa 38)~~ ✅ — o envio do aviso de saldo baixo falhava em silêncio
    (grupo não configurado, instância desconectada, erro do uazapi) sem
    mostrar nada de errado na tela; agora qualquer falha no envio aparece
    num aviso vermelho em Mensagens → Avisos. Nova seção "Contas com erro no
    pagamento" na mesma aba: verifica `account_status`/`disable_reason` de
    cada conta vinculada na Meta e avisa o mesmo grupo do WhatsApp quando
    encontra conta desabilitada/pagamento pendente/aguardando liquidação/em
    período de carência, com cooldown de 24h — reaproveita o mesmo hook
    público `balance-alert-tick` (sem workflow novo no n8n). Veja os ⚠️
    acima sobre o critério usado e a nova migração `0012_payment_alerts.sql`
33. ~~Nome da conta colorido, ordem da lateral e Painel lembra aba/filtros
    (Etapa 39)~~ ✅ — em Acompanhamento, o nome da conta fica vermelho com
    erro no pagamento e laranja com saldo baixo (mesma checagem de Mensagens
    → Avisos, em modo leitura); a lateral do Painel mudou de ordem
    (Acompanhamento, Análise, Evolução, Visão Geral, Controle de Saldo,
    Clientes); e o Painel agora lembra a aba ativa + os filtros de
    Acompanhamento/Análise/Visão Geral entre sessões — dar F5 volta pra onde
    você tinha deixado, em vez de sempre abrir em Visão Geral do zero. Veja
    os ⚠️ acima sobre a prioridade de cor e o que fica salvo
34. ~~Análise "acima da meta" isolada em Conjuntos/Criativos + destaque de 7
    dias (Etapa 40)~~ ✅ — a aba "CPA acima da meta" ganhou dois critérios
    independentes: Conjuntos (limite subiu pro dobro da Meta CPA) e
    Criativos (limite mais sensível, R$2 acima da Meta CPA — reaproveitando
    uma análise por criativo que já existia desde as Etapas 11-17).
    Conjuntos mantém a expansão pra ver os criativos por duplo clique. As
    duas listas destacam em verde (sutil) qualquer linha cuja média de
    custo por conversa nos últimos 7 dias (sempre fixo) já esteja abaixo da
    Meta CPA. A aba "CPA abaixo da meta" não mudou. Veja os ⚠️ acima sobre
    os limites e o custo extra de chamadas ao Graph API
35. ~~Conjuntos e Criativos viram telas separadas (Etapa 41)~~ ✅ — Conjuntos
    e Criativos (aba "CPA acima da meta") deixaram de ficar empilhados na
    mesma tela e viraram duas telas alternadas por um botão, igual ao de
    "CPA acima da meta"/"CPA abaixo da meta"; cada uma só busca dado da
    Meta enquanto está sendo exibida. Veja o ⚠️ acima
36. ~~Caixa de seleção pra pausar em massa (Etapa 42)~~ ✅ — Conjuntos e
    Criativos ganharam uma caixinha por linha (mais "Selecionar todos os
    listados") e um novo botão "Pausar selecionados", que pausa só quem foi
    marcado; o botão "Pausar todos os listados" continua igual do lado,
    ignorando a seleção. Veja o ⚠️ acima
37. ~~Conserto do botão de ação em massa que desarmava sozinho (Etapa
    43)~~ ✅ — bug real reportado: clicar em "Pausar selecionados" (e,
    embora não relatado, provavelmente também "Pausar todos") mostrava o
    aviso vermelho de confirmação por uma fração de segundo e voltava
    sozinho ao normal, sem nem dar tempo do segundo clique. Corrigido —
    veja o ⚠️ abaixo pra causa raiz
38. ~~Limite de Conjuntos subiu pro triplo da Meta CPA (Etapa 44)~~ ✅ — a
    tela Conjuntos (aba "CPA acima da meta") passou a exigir o TRIPLO (não
    mais o dobro) da Meta CPA pra entrar na lista, com o mesmo limite
    valendo pros dois casos (com ou sem conversa iniciada) — antes o caso
    sem conversa usava um valor fixo (R$2 acima), agora usa o mesmo
    múltiplo. A tela Criativos não mudou
39. ~~Limite de Criativos subiu de R$2 pra R$4 (Etapa 45)~~ ✅ — a tela
    Criativos passou a exigir R$4 ou mais acima da Meta CPA (com ou sem
    conversa iniciada) pra entrar na lista, em vez de R$2. A tela Conjuntos
    não mudou
40. ~~Selo "Sem anúncio ativo" em Análise → Conjuntos (Etapa 46)~~ ✅ —
    conjunto ativo sem nenhum anúncio ativo dentro dele agora aparece na
    lista da aba "CPA acima da meta", com um selo vermelho ao lado do
    nome, mesmo que não bata o limite de CPA. Veja o ⚠️ acima
41. ~~Novo filtro de período "Ontem e hoje" (Etapa 47)~~ ✅ — nova opção
    no seletor de período de Acompanhamento (e, por ser uma lista
    compartilhada, também em Análise/Visão Geral/Relatórios). Veja o ⚠️
    acima
42. ~~Evolução com coluna Mensal, cor por CPA ideal e conserto do dia de
    hoje + aviso automático de CPA acima da meta ontem (Etapa 48)~~ ✅ —
    Evolução ganhou coluna fixa "Mensal", conserto do dia de hoje que não
    aparecia, e cor por cliente (verde/laranja/vermelho contra o CPA
    ideal, banda de R$2) em vez do corte fixo de antes; novo aviso em
    Mensagens → Avisos manda uma mensagem só por dia (via hook
    `cpa-alert-tick`, sugerido às 07h no n8n) com quem passou R$2 do CPA
    ideal ontem, do mais crítico pro menos crítico. Veja os ⚠️ acima
43. ~~Coluna CPA ideal e ordenação por CPA mensal em Evolução (Etapa
    49)~~ ✅ — nova coluna "CPA ideal" antes de "Mensal", e a lista agora
    vem ordenada pelo CPA do mês, do maior pro menor. Veja o ⚠️ acima
44. ~~Conserto do selo "Sem anúncio ativo" em Análise → Conjuntos (Etapa
    50)~~ ✅ — o selo ficava escondido pelo corte de texto em nome
    comprido, e as colunas Custo/conversa e Diferença voltavam sempre em
    traço mesmo com gasto e conversa reais no período. Agora o selo
    sempre aparece e a métrica real é mostrada. Veja o ⚠️ acima

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
campanhas de Tráfego/[VAGA] em Análise e Visão Geral, Análise reorganizada
por conjunto com criativos expansíveis e botões de pausar isolados, Análise
com abas acima/abaixo da meta e aumento de orçamento fixo, ações em massa
com backoff de rate limit e pausa de 3s entre chamadas, popup do select
sempre legível no escuro, coluna Otimizado com reset diário em
Acompanhamento simplificada pra seletor sem motivo, conserto do aviso de
saldo baixo silencioso e nova checagem de erro no pagamento, nome da conta
colorido por saldo/pagamento + nova ordem da lateral + Painel lembrando
aba/filtros entre sessões, Análise "acima da meta" com critérios próprios
por Conjuntos/Criativos e destaque de tendência de 7 dias, Conjuntos e
Criativos virando telas separadas alternadas por botão, caixa de seleção
pra pausar em massa só quem foi marcado, conserto do bug que desarmava
sozinho o botão de ação em massa, limite de Conjuntos subindo pro triplo
da Meta CPA, limite de Criativos subindo de R$2 pra R$4, selo "Sem
anúncio ativo" em Análise → Conjuntos, novo filtro de período "Ontem e
hoje", Evolução com coluna Mensal/cor por CPA ideal/conserto do dia de
hoje + aviso automático de CPA acima da meta ontem, coluna CPA ideal +
ordenação por CPA mensal em Evolução, e conserto do selo "Sem anúncio
ativo" em Análise → Conjuntos) estão 100%
concluídos. Não há mais nenhum item pendente do escopo combinado —
próximos pedidos são novos incrementos, a critério seu.
