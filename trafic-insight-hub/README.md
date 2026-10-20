# Trafic Insight Hub

Painel interno de acompanhamento de tráfego pago (Meta Ads) — reconstrução do
projeto original, agora como instância única (um só login) hospedada na
Vercel, com Supabase, n8n e uazapi (WhatsApp).

Estado atual: **etapas 1 e 2 do plano concluídas** — base do Supabase/login
único, e o Painel já fecha 100%, agora organizado em subgrupos na lateral
esquerda (Acompanhamento, Evolução, Monitor de CPA, Clientes, Controle de
Saldo, Visão Geral, Análise — a aba "Geral", que só mostrava 3 KPIs soltos e duplicava a
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
(até a Etapa 84: (Investimento mensal − Valor usado) ÷ dias restantes; desde a
Etapa 85 é o ritmo pra alcançar o Ideal até hoje, ver abaixo); a cor compara o Ritmo com o
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
workflow novo no n8n (veja os ⚠️ abaixo).
Mensagens → Avisos ganhou mais uma automação (Etapa 55): "Atualização de
status em massa" reclassifica sozinha o status de toda conta exibida com o
CPA dos últimos 3 dias (sem contar hoje) — mesma lógica do botão manual de
Acompanhamento —, atualiza quem mudou, reordena o quadro inteiro (status
mais crítico primeiro, e dentro de cada status do maior CPA pro menor) e
manda uma única mensagem com o status de TODO cliente classificado (mudou
ou manteve), sempre só "cliente: status", sem dizer qual dos dois casos é
e sem nenhum outro comentário; pensada pra rodar segunda e quinta de
madrugada via n8n. Veja o ⚠️ mais abaixo. Em Acompanhamento, o nome da conta
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
no DOBRO da Meta CPA + R$1 ou mais, ou sem conversa com o próprio gasto
já nesse patamar — era 2x a Meta CPA, subiu pro triplo na Etapa 44 e
voltou pra 2x + R$1 fixo na Etapa 52) e Criativos
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
métricas reais são mostradas normalmente. O nome do cliente na tela
Evolução (Etapa 51) agora é um link direto pro Gerenciador de Anúncios da
conta correspondente, abrindo em nova aba — mesmo padrão de link
(sublinhado pontilhado) já usado em Acompanhamento, Controle de Saldo,
Visão Geral e Clientes. O limite da tela Conjuntos (aba "CPA acima da
meta", Etapa 52) mudou de novo: em vez do triplo da Meta CPA (Etapa 44),
agora é o DOBRO da Meta CPA mais R$1 fixo (ex.: Meta CPA R$6 → limite
R$13), mesmo cálculo pro caso sem conversa iniciada. Veja o ⚠️ acima.
Mensagens → Avisos ganhou 4 automações novas (Etapa 53), pensadas pra rodar
sozinhas via n8n: pausar Criativos acima da meta (05h/09h/13h/23h), pausar
Conjuntos acima da meta (05h05/09h05/13h05/23h05), aumentar em R$2,50 fixo
o orçamento de Conjuntos com CPA bom nos últimos 3 dias (06h) e avisar
(sem mexer em nada) contas com investimento baixo, de segunda a sexta
(07h/09h15/13h) — as 3 primeiras usam a MESMA lógica/limite das telas de
Análise e Acompanhamento (nada de critério novo), e cada uma também ganhou
um botão manual em Mensagens → Avisos. Veja o ⚠️ acima sobre os detalhes
importantes dessas 4 (a automação de aumento de orçamento foi removida na
Etapa 58, mais abaixo — hoje restam 3). O aviso de investimento baixo (Etapa 54) ficou mais
rigoroso: em vez de só entrar passando de R$10 de diferença, agora entra
qualquer conta com orçamento diário menor que o Ritmo, mesmo que seja por
centavos — sem mudar a cor da coluna Ritmo nem o filtro Investimento de
Acompanhamento, que continuam com a banda de R$10 (a Etapa 56, mais abaixo,
devolveu essa banda especificamente pro aviso). Com isso, mais a nova
automação de atualização de status em massa (Etapa 55), todas as
áreas do plano original + os extras pedidos ao longo do caminho estavam
100% concluídas — até a Etapa 56, três ajustes pedidos depois de testar as
automações da Etapa 53/55 em produção: (1) as pausas automáticas de
Criativos e Conjuntos (`creatives-pause-tick`, `adsets-pause-tick`) agora
mandam as requisições de pausa pra Meta uma de cada vez, com 3s de intervalo
entre elas, em vez de todas em paralelo — mesma cautela dos botões manuais
de ação em massa de Análise, reduzindo o risco de rate limit em listas
grandes; (2) o aviso de investimento baixo voltou a usar a banda de R$10
(estava sem banda desde a Etapa 54) — diferenças pequenas (R$0,70 a R$4,72,
nos exemplos que motivaram o pedido) não entram mais no aviso; e (3) o
aumento automático de orçamento ganhou um teto de R$25,00 (removida na
Etapa 58, ver abaixo — histórico mantido aqui). A tela Visão
Geral (Etapa 57) ganhou uma busca por nome de Campanha/Conjunto/Anúncio —
o campo de busca ignora a conta selecionada no seletor ao lado e pesquisa
sempre em TODAS as "Contas exibidas" de uma vez (fixo, sem opção de
escolher uma conta ou algumas), mostrando de qual conta é cada resultado.
Veja o ⚠️ mais abaixo sobre como isso funciona sem sobrecarregar a Meta de
chamadas a cada letra digitada. A automação de aumento automático de
orçamento (Etapa 53, com teto de R$25 desde a Etapa 56) foi removida na
Etapa 58, por pedido — não fazia sentido pra como as contas costumam ser
geridas na prática. O botão manual "Aumentar +R$2,50" de Análise (aba
"abaixo da meta") continuou existindo normalmente; na Etapa 59, ganhou de
volta o mesmo teto de R$25,00 que a automação tinha — se o orçamento
diário atual do conjunto já estiver em R$25 ou mais, o botão simplesmente
não aumenta mais aquele conjunto (mensagem de aviso em vez de erro). A
tabela de Acompanhamento ganhou uma coluna "Leads" (Etapa 60), entre CPA
e Valor usado — é o número de conversas iniciadas (o mesmo "Resultado" do
Gerenciador de Anúncios, campo `results` da Meta), o mesmo dado que já
alimentava o cálculo do CPA dessa tabela, só que agora também exibido
como número.

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
60 segundos, de propósito (mais devagar, mais seguro). Desde a Etapa 56, as
automações de pausa via n8n (Criativos e Conjuntos acima da meta,
`creatives-pause-tick`/`adsets-pause-tick`) seguem a MESMA cautela —
`setEntitiesStatusSequential` em `lib/meta/status.ts` — em vez do
`Promise.all` (tudo em paralelo) que usavam antes; motivo do ajuste:
listas grandes de conjuntos/criativos flagrados de uma vez arriscavam
disparar rate limit da Meta. O toggle manual de status individual
(`app/api/meta/status/route.ts`) e a pausa automática de Auditoria
(`lib/audit/run.ts`, localização/erros de veiculação) continuam usando
`setEntitiesStatus` (em paralelo) — o primeiro só mexe em 1 item por vez,
e o segundo já pausa lotes bem menores, por conta; não foi pedido mexer
nesses dois. Além disso, toda chamada de escrita na Graph API (`metaPost`,
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
(Etapas 40, 44, 45 e 52)**: a aba "CPA acima da meta" tem dois critérios
DIFERENTES um do outro, de propósito — Conjuntos exige uma diferença bem
maior (custo por conversa no DOBRO da Meta CPA MAIS R$1 fixo — ex.: Meta
CPA R$6 → limite R$13 —, ou sem conversa com o próprio gasto já nesse
patamar, mesmo limite pros dois casos; passou por 2x → 3x na Etapa 44 →
2x+R$1 na Etapa 52) antes de sugerir pausar o conjunto inteiro, enquanto
Criativos usa um limite mais sensível (R$4+ acima da Meta CPA, com ou sem
conversa — subiu de R$2 pra R$4 na Etapa 45) pra pegar o criativo
problemático cedo, antes que o conjunto precise ser sinalizado. Além
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

⚠️ **Sobre as automações de Mensagens → Avisos (Etapa 53, uma removida na
Etapa 58)**: nasceram 4 — pausar Criativos, pausar Conjuntos, aumentar
orçamento e avisar investimento baixo —, todas reaproveitando EXATAMENTE a
mesma lógica/limite que a tela de Análise e Acompanhamento já usam (veja
`lib/meta/analysis-thresholds.ts` e `lib/meta/ritmo.ts`), rodando sozinhas
via hook do n8n em vez de esperar você clicar. A de aumentar orçamento foi
removida na Etapa 58 (histórico dela fica só no changelog, mais abaixo) —
hoje restam 3: pausar Criativos, pausar Conjuntos e avisar investimento
baixo. Pontos importantes:
- As 2 de pausa (Criativos e Conjuntos) usam período FIXO — "últimos 3 dias
  + hoje", independente de qualquer filtro escolhido em alguma tela; foi a
  leitura mais direta do pedido, ajustável se não for isso.
- Diferente de Saldo/Pagamento/CPA/Investimento baixo (que só avisam), as 2
  de pausa **JÁ EXECUTAM A AÇÃO DE VERDADE** assim que rodam — não existe
  um modo "só mostrar o que aconteceria". Por isso, na tela (Mensagens →
  Avisos), essas 2 não carregam nada sozinhas ao abrir a aba — só quando
  você clica em "Verificar e pausar agora", pro clique não pausar nada sem
  querer. Mesmo espírito que Auditoria → Erros de veiculação já usava.
- Nenhuma das 3 tem cooldown de TEMPO — quem controla a frequência é o
  próprio agendamento do n8n. Pra Criativos e Conjuntos isso não é
  problema, porque quem já foi pausado deixa de ser ATIVO e some da lista
  da próxima rodada (sem re-pausa nem re-aviso do mesmo item).
- O aviso de Investimento baixo usa a mesma conta de Ritmo do filtro
  Investimento de Acompanhamento. Histórico: nasceu (Etapa 53) com a mesma
  banda de R$10 do filtro de Acompanhamento; a Etapa 54 tirou essa banda
  (qualquer diferença, por menor que fosse, já disparava); a **Etapa 56
  trouxe a banda de volta** (`diff > RITMO_BAND`, mesma constante
  `RITMO_BAND = 10` de `lib/meta/ritmo.ts`) — motivo do pedido: o aviso
  estava chegando com diferenças de R$0,70 a R$4,72, poluindo a mensagem
  sem indicar um ajuste real necessário. Hoje o critério do aviso é
  IGUAL ao da cor da coluna Ritmo e do filtro Investimento (Baixo/Alto) de
  Acompanhamento — só entra passando de R$10 de diferença. "Investimento
  Alto" (investindo mais rápido que o necessário) segue sem entrar nesse
  aviso, já que só foi pedido aviso do caso baixo.

⚠️ **Sobre a busca por nome em Visão Geral (Etapa 57)**: o campo de busca
pesquisa Campanhas, Conjuntos ou Anúncios (o nível escolhido nas abinhas
logo abaixo), sempre em TODAS as "Contas exibidas" — pedido explícito pra
deixar o escopo fixo em "todas", sem opção de escolher uma conta específica
ou um subconjunto. Enquanto o campo está vazio, a tela funciona do jeito de
sempre (1 conta por vez, escolhida no seletor ao lado, pra não gastar
chamada à Meta à toa); assim que você digita algo, o seletor de conta fica
desabilitado (a busca ignora ele) e a tela busca o breakdown de TODAS as
contas de uma vez — uma chamada por conta, em paralelo. Detalhe de
performance importante: essa busca em todas as contas só é refeita quando
você começa a digitar (indo de campo vazio pra algo), troca de nível
(Campanhas/Conjuntos/Anúncios) ou de período enquanto o campo tem texto, ou
clica em "↻ Atualizar" — digitar mais letras no meio de uma busca não
dispara nenhuma chamada nova à Meta, só refina localmente o que já foi
buscado. O nome é comparado sem diferenciar maiúscula/minúscula nem acento
("itapetininga" acha "Itapetininga"). Uma conta específica que falhar
nessa busca (token vencido, conta restrita etc.) não derruba as outras —
só fica de fora da lista, silenciosamente (mesmo espírito das automações
em massa que já seguem esse padrão). Como a busca cobre todas as contas,
a tabela ganha uma coluna extra "Conta" nesse modo, pra saber de qual
conta é cada linha; o link "Abrir no Facebook" do cabeçalho (que aponta
pra uma conta só) fica escondido enquanto há busca ativa, já que não faria
sentido nesse modo.

⚠️ **Remoção do aumento automático de orçamento (Etapa 58)**: a automação
que aumentava sozinha, 1x/dia, o orçamento diário de todo conjunto com CPA
bom (nascida na Etapa 53, com teto de R$25 desde a Etapa 56) foi removida
por pedido explícito — não sobrou nenhum jeito de aumentar orçamento
automaticamente pelo n8n. Ficam removidos: a seção "Conjuntos com CPA bom
(aumento automático de orçamento)" de Mensagens → Avisos, a rota
`/api/alerts/budget-increase` (botão manual daquela seção) e o hook público
`/api/public/hooks/increase-budget-tick` (chamado pelo n8n). **Ação
necessária no seu n8n**: apague (ou desative) o workflow/node que chama
`increase-budget-tick` — como a rota não existe mais no app, ele vai passar
a dar 404 se continuar agendado. O botão manual "Aumentar +R$2,50" de
Painel → Análise (aba "abaixo da meta") CONTINUA existindo — só a
automação sozinha via n8n saiu, não a forma manual de aumentar orçamento
um conjunto de cada vez (o teto de R$25 do botão manual mudou de novo
logo em seguida, ver ⚠️ da Etapa 59 abaixo).

⚠️ **Teto de R$25 de volta no botão manual de aumento (Etapa 59)**: a
Etapa 58 tinha removido o teto de R$25 junto com a automação, deixando o
botão manual "Aumentar +R$2,50" de Análise sem limite nenhum — pedido
seguinte foi pra manter esse teto especificamente na ação manual. Hoje
`increaseAdSetDailyBudget` (`lib/meta/budget.ts`) sempre compara o
orçamento diário ATUAL do conjunto (buscado na Meta na hora, nada
guardado em banco) contra R$25: se já estiver em R$25 ou mais, o botão
não aumenta mais aquele conjunto (mostra um aviso em vez de aumentar); se
faltar menos de R$2,50 pra chegar em R$25, aumenta só o que falta em vez
do fixo R$2,50. Vale tanto pro botão individual quanto pro "Aumentar
todos os orçamentos listados" (em massa) — cada conjunto é conferido na
hora dele.

⚠️ **Sobre a automação "Atualização de status em massa" (Etapa 55)**: pensada
pra rodar segunda e quinta de madrugada (01h sugerido no n8n), reaproveita
EXATAMENTE a mesma lógica de classificação do botão manual já existente em
Acompanhamento (`components/painel/bulk-status-dialog.tsx`): CPA dos
últimos 3 dias sem contar hoje, abaixo da meta → Baixa, até +R$2 → Média,
até +R$3 → Alta, acima disso → Crítica; contas em inauguração, sem CPA
ideal cadastrado ou sem gasto nos últimos 3 dias não são reclassificadas
(ficam com o status que já tinham). Pontos que exigiram uma decisão minha,
sem confirmar antes:
- **Universo de contas**: usei "Contas exibidas" (`user_selected_accounts`,
  a lista de contas do Painel inteiro), não o que estiver filtrado numa
  tela específica no momento — a automação não tem estado de filtro nenhum
  pra respeitar, então pareceu o universo mais correto pra rodar sozinha de
  madrugada. Se a ideia era outro recorte de contas, me fala que ajusto.
- **Reordenar o quadro (pedido à parte, na mesma leva)**: além de
  reclassificar, essa automação também reordena `sort_order` de TODAS as
  contas exibidas — primeiro agrupando por status, da situação mais
  crítica pra menos crítica (Crítica → Alta → Média → Baixa → Inauguração
  por último), e dentro de cada status, do maior CPA (últimos 3 dias) pro
  menor; conta sem CPA calculável (sem gasto no período) fica por último
  dentro do próprio status, desempatando por ordem alfabética do nome do
  cliente. Esse reordenar é só dessa automação — o diálogo manual de
  Acompanhamento continua sem mexer no `sort_order` (ele trabalha só com o
  subconjunto filtrado da tela, onde reordenar o quadro inteiro podia
  bagunçar linhas que nem entraram na avaliação). Se o critério de
  ordenação não for esse (por exemplo, se quiser CPA absoluto sem separar
  por status antes), me fala que ajusto.
- A mensagem de WhatsApp leva o status de TODO cliente classificado nessa
  rodada — mudou ou manteve —, sempre só "cliente: status" por linha
  (rótulo já personalizado em Configurações → Status, se houver), sem dizer
  qual dos dois casos é e sem nenhum outro comentário/cabeçalho/emoji
  (ajuste pedido depois da primeira entrega, que mandava só quem tinha
  mudado). Só fica de fora quem foi pulado nessa rodada — inauguração, sem
  meta de CPA cadastrada ou sem gasto nos últimos 3 dias — já que esses não
  têm um status novo calculado pra reportar. Sem cooldown — rodar de novo
  com os mesmos dados simplesmente reclassifica pro mesmo status (o quadro
  é reordenado de novo, mas ninguém muda de fato).
- Sem GET/preview, mesmo motivo das outras 3 automações que já escrevem de
  verdade (Criativos/Conjuntos/Orçamento, Etapa 53): o próprio "check" já
  atualiza o status e reordena o quadro, então só o botão manual (POST)
  existe em Mensagens → Avisos.

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

⚠️ **(SUBSTITUÍDA pela Etapa 129 — ver item 117: voltou a ser "o que falta ÷ dias que faltam")** **Sobre a coluna Ritmo (Acompanhamento) — regra da Etapa 85**: o Ritmo
é o investimento diário pra ALCANÇAR o Ideal até hoje, não mais "o que falta
÷ dias restantes". Investimento diário normal = Investimento mensal ÷ dias
reais do mês (28-31, fuso de Brasília); Ideal até hoje = normal × dia de hoje;
diferença = Ideal até hoje − gasto do dia 01 até ONTEM (dias fechados,
preset `this_month_until_yesterday`, igual à Speed). Ritmo = normal + a
diferença, com o ajuste limitado a ±50% do normal. Ex.: meta 3.000 em mês de
30 dias → normal 100; dia 5, ideal 500, gasto 300 → falta 200 → Ritmo 150
(teto de +50 por dia: 150, 150, 150, 150 e volta a 100); se faltar 115 →
150, 150, 115, 100. Conta adiantada (gasto acima do ideal) desacelera na
mesma proporção, até −50% do normal (nunca abaixo de zero). No dia 01 o gasto
considerado é 0. A conta vale também pro aviso automático de investimento
baixo (`lib/alerts/low-investment.ts`, que passou a buscar
`this_month_until_yesterday`) e pra cor/filtro Investimento (Baixo/Alto), que
continuam comparando o Ritmo com o Invest. diário (banda de R$ 10). O gasto
usado é sempre o do mês até ontem, independente do período escolhido no
filtro da tabela (Hoje/Últimos 7 dias/etc. são pra CPA e Valor usado, não pro
Ritmo). Sem Investimento
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
    pagamento). Não tem migração nova desde então (Etapas 55-58 não mexem
    em schema).
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
`openssl rand -hex 32`); é ela que protege TODOS os hooks públicos
(`/api/public/hooks/*`, incluindo o novo `demand-ingest` da Etapa 68)
contra chamadas de qualquer pessoa na internet. Adicione também
`GEMINI_API_KEY` (Etapa 68) — chave da API do Google Gemini, gratuita,
gerada em [aistudio.google.com/apikey](https://aistudio.google.com/apikey);
é usada só pra transcrever literalmente os áudios recebidos no grupo de
Demandas (nunca pra interpretar texto). Adicione também `BOLETO_WEBHOOK_URL`
e `BOLETO_FINANCE_EMAIL` (Etapa 71) — a URL do workflow do n8n
(`n8n-workflows/boleto-email.json`, passo 17 da seção de deploy) e o e-mail
do financeiro que recebe o boleto; sem essas duas o botão "Enviar e-mail"
de Controle de Saldo responde com erro. O envio de Pix por WhatsApp (Etapa
73) não precisa de nenhuma variável nova — reaproveita a mesma instância
uazapi (`whatsapp_instances`) e o mesmo `WHATSAPP_DISPATCH_SECRET` já
configurados pra Mensagens &gt; Envio.

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
3. Em **Environment Variables**, adicione as mesmas chaves do `.env.local`
   (incluindo `WHATSAPP_DISPATCH_SECRET` e, desde a Etapa 68, `GEMINI_API_KEY`).
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
   → Avisos rodar sozinho — e, desde a Etapa 63, o mesmo hook também cobre
   o aviso de sexta-feira (saldo 2x/3x abaixo do limite) e o lembrete de
   verificação manual do Controle de Saldo, sem precisar de nenhum workflow
   novo no n8n.
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
11. (Etapa 53) Crie um sexto workflow no n8n com **Schedule Trigger**
    configurado pra rodar 4x por dia, às 05h, 09h, 13h e 23h (horário de
    Brasília) → **HTTP Request** `POST` para
    `https://SEU_DOMINIO/api/public/hooks/creatives-pause-tick` com o mesmo
    header `x-webhook-secret`. Isso pausa sozinho todo criativo acima da
    meta (Mensagens → Avisos, seção "Criativos acima da meta") e avisa o
    grupo de WhatsApp. Veja o ⚠️ mais abaixo sobre essas automações (eram
    4, uma foi removida na Etapa 58 — restam 3).
12. (Etapa 53) Crie um sétimo workflow igual ao de cima, mas 5 minutos
    depois — às 05h05, 09h05, 13h05 e 23h05 — chamando `POST` para
    `https://SEU_DOMINIO/api/public/hooks/adsets-pause-tick`. Isso pausa
    sozinho todo conjunto acima da meta (seção "Conjuntos acima da meta").
13. (Etapa 53) Crie um oitavo workflow com **Schedule Trigger** pra rodar de
    segunda a sexta, às 07h, 09h15 e 13h, chamando `POST` para
    `https://SEU_DOMINIO/api/public/hooks/low-investment-tick`. Isso só
    avisa (nunca muda nada) quais contas estão com investimento baixo
    (seção "Investimento baixo").
14. (Etapa 55) Crie um nono workflow com **Schedule Trigger** pra rodar
    segunda e quinta, às 01h, chamando `POST` para
    `https://SEU_DOMINIO/api/public/hooks/bulk-status-tick`. Isso
    reclassifica sozinho o status de toda conta exibida (CPA dos últimos 3
    dias, sem hoje), reordena o quadro de Acompanhamento e avisa só quem
    mudou (seção "Atualização de status em massa").

15. (Etapa 61) Crie um décimo workflow no n8n com **Schedule Trigger** pra
    rodar 1x por dia, às 07h10 (horário de Brasília — 5 minutos depois do
    `cpa-alert-tick` do passo 9, mesmo motivo de esperar a Meta terminar
    de consolidar a atribuição de ontem) → **HTTP Request** `POST` para
    `https://SEU_DOMINIO/api/public/hooks/cpa-board-cache-tick` com o
    mesmo header `x-webhook-secret`. Isso recalcula sozinho o cache de
    "Ontem" e "Últimos 3 dias" do Monitor de CPA (Painel). Sem esse
    workflow, esses dois períodos só atualizam quando você clicar em
    "Calcular agora" na própria tela.

16. (Etapa 68) Pra virar a aba Demandas, importe o workflow pronto
    `n8n-workflows/demandas-whatsapp.json` (Menu do n8n → Import from File).
    Ele já vem montado só com nós nativos (Webhook, IF, Edit Fields/Set,
    HTTP Request, Wait, NoOp — nenhum nó Code), porque o n8n não tem um jeito
    nativo de "esperar até parar de chegar mensagem": cada mensagem que
    chega no grupo é guardada num buffer (tabela nova
    `demand_message_buffer`), a execução espera ~15s, confere no banco se
    ainda é a mensagem mais recente desse remetente e só a última execução
    processa o pacote inteiro (juntando as mensagens, separando a última
    como nome do cliente) e cria a demanda — as outras param sozinhas.
    Depois de importar:
    1. Troque `SEU_DOMINIO` e `COLOQUE_AQUI_O_WHATSAPP_DISPATCH_SECRET` nos
       3 nós HTTP Request (tudo explicado no Sticky Note do próprio
       workflow).
    2. Confira/ajuste o ID do grupo no nó "É do grupo de Demandas?" — use o
       mesmo valor salvo em Configurações → WhatsApp → "Grupo para
       Demandas".
    3. No painel da uazapi, configure o webhook da instância (evento
       `messages`) pra chamar a URL de produção do node **Webhook** desse
       workflow.
    4. Ative o workflow.

    ✅ Campos de TEXTO confirmados com uma mensagem de teste real (não é
    mais palpite de documentação): `body.message.chatid` (ID do grupo),
    `body.message.sender`, `body.message.type` (já vem `"text"`/`"audio"`
    normalizado pela própria uazapi) e `body.message.text`. Um detalhe que
    só o teste real revelou: `fromMe` NÃO serve pra filtrar mensagem sua —
    como a instância é o seu próprio número, `fromMe` vem `true` até quando
    é você mesmo digitando a solicitação no grupo. Quem realmente indica
    "isso não foi o n8n/a API que mandou" é `wasSentByApi` — é esse campo
    que o workflow usa.

    ⚠️ Ainda NÃO confirmado: o campo com a URL do ÁUDIO (o teste real só
    cobriu mensagem de texto). O nó "Normalizar mensagem" está com um
    palpite (`fileURL`/`mediaUrl`) que pode estar errado. Antes de confiar
    no fluxo de áudio, manda uma mensagem de voz de teste no grupo e
    confere em "Executions" do n8n o nome real do campo — se for diferente,
    ajusta só a linha `mediaUrl` desse mesmo nó. Sem esse workflow ativo,
    nenhuma mensagem do grupo vira tarefa sozinha — dá pra testar o hook
    final sem n8n chamando `demand-ingest` direto (formato descrito na
    Estrutura, abaixo).

⚠️ (Etapa 58) Se você já tinha criado o workflow do
`increase-budget-tick` (antigo passo 13, "oitavo workflow"), apague ou
desative esse workflow no n8n — a rota não existe mais no app e vai passar
a responder 404 se continuar agendada.

17. (Etapa 71) Pra virar o "Enviar boleto por e-mail" (dentro de Controle de
    Saldo), importe o workflow pronto `n8n-workflows/boleto-email.json`
    (Menu do n8n → Import from File). Diferente dos workflows acima, esse
    não é chamado pelo n8n num horário fixo — é o próprio app que chama o
    webhook na hora que você clica em "Enviar e-mail". Só 2 nós de verdade,
    nativos (Webhook + Gmail — o meio do caminho é um HTTP Request que só
    baixa o PDF, sem nó Code):
    1. Ative o workflow e copie a URL de produção do nó **Webhook**.
    2. Cole essa URL na variável de ambiente `BOLETO_WEBHOOK_URL` (Vercel) e
       redeploy.
    3. Configure `BOLETO_FINANCE_EMAIL` com o e-mail que deve receber o
       boleto (ex.: financeiro@ivs.com.br).
    4. No nó **Enviar e-mail (Gmail)**, conecte sua credencial do Gmail
       (OAuth2).
    5. Teste pelo app: Painel → Controle de Saldo → "Enviar boleto por
       e-mail" → escolha o cliente, o vencimento, anexe um PDF e clique em
       "Enviar e-mail". O assunto vira o nome da loja e o corpo é sempre o
       mesmo texto fixo, só trocando loja/data/anexo — igual ao padrão que
       você já mandava manualmente pelo Gmail.

18. (Etapa 73) O botão "Enviar Pix" (Controle de Saldo) **não precisa de
    nenhum workflow novo no n8n** — tanto o envio imediato quanto o
    agendado reaproveitam a instância uazapi e, quando programado, o mesmo
    hook `whatsapp-dispatch-tick` que o passo 16 (Demandas) e a aba
    Mensagens &gt; Envio já usam. Se aquele workflow (Schedule Trigger →
    HTTP Request pro hook, a cada ~1 minuto) já está ativo, o agendamento
    de Pix funciona sozinho assim que a migração `0022_pix_whatsapp_dispatch.sql`
    for aplicada.

## Estrutura

```
app/
  login/, esqueci-senha/, redefinir-senha/, auth/callback/   → autenticação
  c/[token]/      → CRM público de UMA instância (kanban somente leitura), sem login
  (app)/                                                     → área logada
    painel/         → subgrupos na lateral: Acompanhamento, Evolução,
                      Monitor de CPA, Clientes, Controle de Saldo, Visão
                      Geral, Análise, Demandas (Etapa 68), Copy (Etapa 70)
                      — cada um só busca no Meta enquanto está ativo
                      (Demandas e Copy nem buscam no Meta, só nas próprias
                      tabelas)
    mensagens/      → abas Envio, Relatórios e Avisos, todas funcionais
    auditoria/      → Localização e Erros de veiculação, funcionais
    crm/            → instâncias, kanban, detalhe do lead — funcional
    configuracoes/   → abas Meta, WhatsApp e Status, todas funcionais
  api/
    meta/credentials, meta/accounts, meta/insights, meta/breakdown,
    meta/status, meta/daily-cpa
    meta/cpa-board-cache, meta/cpa-board-cache/refresh → leitura do cache
                      e "Calcular agora" do Monitor de CPA (Etapa 61)
    meta/payment-type  → puxa Pré-paga/Pós-paga da Meta, só p/ conta sem Tipo salvo (Controle de Saldo)
    analysis/creatives  → custo por conversa iniciada acima da Meta CPA (Painel > Análise)
    analysis/adsets     → conjuntos acima/abaixo da meta, com destaque de 7 dias (Painel > Análise)
    analysis/increase-budget → aumenta R$2,50 fixo o orçamento de UM conjunto (botão manual, Análise "abaixo da meta")
    whatsapp/credentials, whatsapp/status, whatsapp/connect,
    whatsapp/disconnect, whatsapp/groups, whatsapp/alerts-group,
    whatsapp/demands-group (Etapa 68, grupo dedicado de Demandas),
    whatsapp/send, whatsapp/media, whatsapp/message-templates,
    whatsapp/scheduled-dispatches
    demands, demands/[id] (GET/PATCH atribuir cliente manualmente/DELETE
                    "Finalizar"), demands/reorder → CRUD da aba Demandas (Etapa 68)
    audit/location, audit/errors  → "Verificar agora" de cada auditoria
    crm/instances, crm/instances/[id], crm/leads, crm/leads/[id],
    crm/leads/[id]/events  → CRUD do CRM (instâncias, leads, histórico)
    reports/templates, reports/scheduled  → modelos e agendamentos de Relatórios
    alerts/balance  → status de saldo baixo + "Verificar agora" (Mensagens > Avisos, Controle de Saldo)
    alerts/balance-friday → status de saldo de sexta-feira (2x/3x o limite) + "Verificar agora" (Etapa 63)
    alerts/manual-check, alerts/manual-check/verify → status de verificação manual pendente
                    e "Marcar como verificado" (Controle de Saldo, Etapa 63)
    alerts/payment  → status de erro no pagamento + "Verificar agora" (Mensagens > Avisos, Controle de Saldo)
    alerts/cpa      → status de CPA acima da meta ontem + "Verificar agora" (Mensagens > Avisos, Etapa 48)
    alerts/creatives-pause → pausa (de verdade) Criativos acima da meta + aviso (Etapa 53, sem GET/preview)
    alerts/adsets-pause    → pausa (de verdade) Conjuntos acima da meta + aviso (Etapa 53, sem GET/preview)
    alerts/low-investment  → status de investimento baixo (Ritmo) + "Verificar agora" (Etapa 53)
    alerts/bulk-status → reclassifica (de verdade) todas as contas exibidas + reordena o quadro + aviso (Etapa 55, sem GET/preview)
    priority-labels → rótulos/cores de prioridade personalizados (Configurações > Status; GET usa lib/priority-labels.ts desde a Etapa 55)
    public/hooks/whatsapp-dispatch-tick  → chamado pelo n8n, não pelo navegador
    public/hooks/audit-tick              → idem, roda as duas auditorias
    public/hooks/crm-lead-ingest         → idem, cria lead novo por public_token
    public/hooks/report-tick             → idem, dispara os relatórios agendados
    public/hooks/balance-alert-tick      → idem, checa e avisa saldo baixo, erro no pagamento,
                                            saldo de sexta-feira e verificação manual pendente (Etapa 63)
    public/hooks/cpa-alert-tick          → idem, avisa CPA acima da meta ontem (Etapa 48, sugerido 1x/dia às 07h)
    public/hooks/creatives-pause-tick    → idem, pausa Criativos acima da meta (Etapa 53, sugerido 05h/09h/13h/23h)
    public/hooks/adsets-pause-tick       → idem, pausa Conjuntos acima da meta (Etapa 53, sugerido 05h05/09h05/13h05/23h05)
    public/hooks/low-investment-tick     → idem, avisa investimento baixo (Etapa 53, sugerido seg-sex 07h/09h15/13h)
    public/hooks/bulk-status-tick        → idem, reclassifica status + reordena o quadro (Etapa 55, sugerido seg/qui 01h)
    public/hooks/cpa-board-cache-tick    → idem, recalcula o cache de Ontem/Últimos 3 dias do Monitor de CPA (Etapa 61, sugerido 1x/dia às 07h10)
    public/hooks/demand-ingest           → idem, recebe um pacote JÁ MONTADO de mensagens + nome do cliente e cria a tarefa (Etapa 68) — usado pra teste manual; o workflow oficial (passo 16) usa os 3 hooks de buffer abaixo em vez deste
    public/hooks/demand-buffer-append    → idem, guarda 1 mensagem recebida no buffer por remetente (Etapa 68, chamado a cada mensagem que chega no grupo de Demandas)
    public/hooks/demand-buffer-latest    → idem, devolve o horário da mensagem mais recente do buffer de um remetente — usado pelo n8n pra saber se ainda deve processar depois da espera de 15s (Etapa 68)
    public/hooks/demand-buffer-flush     → idem, monta o pacote com tudo que está no buffer de um remetente, cria a demanda (via lib/demands/ingest.ts) e limpa o buffer (Etapa 68)
    copy/subcategories, copy/subcategories/[id]  → lista (semeando o dataset
                    inicial na primeira vez)/cria/renomeia/apaga subcategorias
                    do Gerador de Copy (Etapa 70)
    copy/subcategories/[id]/bank → PUT salva (ou substitui) as 5 variações do
                    banco fixo da subcategoria, DELETE limpa (ajuste
                    pós-Etapa 70 — ver "Banco de 5 variações" mais abaixo)
    copy/generate   → gera as variações e salva no histórico — usa o banco
                    fixo direto (sem IA) se a subcategoria tiver as 5
                    salvas, senão chama o Gemini como sempre; aceita
                    count/save opcionais pro botão "gerar de novo só essa"
                    (Etapa 70)
    copy/generations → histórico de gerações por cliente (Etapa 70)
    boletos/upload  → sobe o PDF do boleto pro bucket boletos (Storage) e
                    devolve a URL pública (Etapa 71)
    boletos/send    → monta o e-mail padrão (assunto = nome da loja, corpo
                    fixo com vencimento) e dispara pro webhook do n8n
                    (BOLETO_WEBHOOK_URL), gravando o histórico em
                    boleto_sends (Etapa 71)
    boletos/history → últimos envios de boleto, pra listinha de histórico em
                    Controle de Saldo (Etapa 71)
    pix/send        → dispara (ou agenda) a sequência de Pix por WhatsApp —
                    saudação + texto fixo + texto do pix + print — resolvendo
                    o destino (grupo do cliente ou número) configurado em
                    pix_accounts; agendado insere em
                    whatsapp_scheduled_dispatches (campo `parts`) igual a
                    Mensagens > Envio (Etapa 73)
    pix/history     → últimos envios de Pix, pra listinha de histórico em
                    Controle de Saldo (Etapa 73)
    selected-accounts, account-bindings, account-bindings/reorder,
    pix-accounts, focus-groups
    painel-ui-state  → lembra a aba ativa + filtros de Acompanhamento/Análise/
                       Visão Geral entre sessões (reaproveita user_ui_prefs)
lib/meta/
  client.ts     → chamadas cruas à Graph API (get/getAll/post, presets de data)
  shared.ts     → helpers compartilhados (isVaga — nome com "vaga"/"seguidores"/
                  "tráfego", Etapa 65 —, objetivos excluídos, acesso à Página)
  insights.ts   → getAdAccounts + getAccountInsight (regra de negócio: ignora
                  campanhas [VAGA], objetivos de reconhecimento/tráfego, soma
                  orçamento diário com CBO e lifetime→diário)
  breakdown.ts  → detalhamento por Campanha/Conjunto/Anúncio (Visão Geral) —
                  no nível campanha só entra quem teve impressão no período
  status.ts     → pausar/ativar nos 3 níveis (ligado na Visão Geral, Auditoria e Análise);
                  setEntitiesStatus (paralelo) e, desde a Etapa 56,
                  setEntitiesStatusSequential (uma chamada de cada vez, 3s de
                  intervalo — usada pelas pausas automáticas de Criativos/Conjuntos)
  daily-cpa.ts  → CPA diário por conta, usado na atualização de status em massa
                  e na tela Evolução (Etapa 48: hoje buscado à parte com
                  date_preset "today" pra não sumir quando a quebra por dia
                  não traz o dia em andamento; getAccountsMonthCpa para o
                  CPA fixo do mês atual, mesma agregação do Ritmo)
  cpa-board-cache.ts → cache diário (em meta_insights_cache) de Ontem/Últimos
                  3 dias pro Monitor de CPA (Etapa 61) — "Hoje" e demais
                  períodos com o dia em andamento continuam sempre ao vivo
  creative-analysis.ts → custo por conversa iniciada por anúncio, com status (Painel > Análise)
  adset-cost-analysis.ts → agrega os anúncios de creative-analysis.ts por conjunto,
                         com o próprio "sem anúncio ativo" de cada um (Etapa 46)
  analysis-thresholds.ts → limites de "acima"/"abaixo da meta" de Conjuntos e
                         Criativos (Etapa 53) — extraídos pra serem reaproveitados
                         tanto pela tela de Análise quanto pelas automações de
                         pausa, sem duplicar o cálculo
  ritmo.ts      → cálculo do Ritmo + banda de R$10 (Etapa 53) — extraído pra ser
                  reaproveitado tanto pela tela de Acompanhamento quanto pelo
                  aviso automático de investimento baixo
  budget.ts     → aumenta o orçamento diário de UM conjunto em R$2,50 fixo,
                  com teto de R$25 — usado só pelo botão manual "Aumentar
                  +R$2,50" de Análise (aba "abaixo da meta"), já que a
                  automação que também usava essa função foi removida na
                  Etapa 58. O teto (R$25) tinha sido criado na Etapa 56 só
                  pra automação, saiu junto com ela na Etapa 58 e voltou na
                  Etapa 59, dessa vez fixo pro próprio botão manual: se o
                  orçamento diário atual do conjunto já estiver em R$25 ou
                  mais, não aumenta mais.
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
                  ser engolido em silêncio (Etapa 38). Desde a Etapa 63
                  também exporta checkFridayLowBalances: mesma ideia, mas só
                  conta numa sexta-feira (fuso America/Sao_Paulo) e usa
                  limite × friday_multiplier (2x ou 3x, configurado por
                  conta) em vez do limite normal — cooldown próprio
                  (friday_alert_sent_at), separado do saldo baixo comum
  payment.ts    → checa erro no pagamento (account_status/disable_reason da
                  Meta) em TODAS as contas vinculadas e manda o aviso pro
                  mesmo grupo — mesmo padrão de balance.ts (cooldown de 24h,
                  compartilhado entre "Verificar agora" e o hook público)
  manual-check.ts → Etapa 63: checagem de "verificação manual" — dia fixo da
                  semana ou "daqui X dias", não importa o tipo de conta.
                  computeManualCheckNextAt calcula a próxima data (usado
                  tanto ao configurar em Personalizar alertas quanto ao
                  reagendar depois de "Marcar como verificado"); mesmo
                  padrão de cooldown de 24h (manual_check_alert_sent_at) dos
                  outros alertas
  cpa.ts        → Etapa 48: checa o CPA de ONTEM (getAccountsInsights, mesma
                  fonte oficial usada em Acompanhamento) de toda conta com
                  CPA ideal cadastrado, e manda UMA mensagem só, com quem
                  ficou mais de R$2 acima da meta, da mais crítica pra menos
                  crítica — compartilhado entre "Verificar agora" e o hook
                  público cpa-alert-tick; SEM cooldown de 24h (ver ⚠️)
  creatives-pause.ts → Etapa 53: acha Criativos acima da meta (mesma lógica
                  de Análise) e JÁ PAUSA, avisando quem foi pausado —
                  compartilhado entre o botão manual e o hook público
                  creatives-pause-tick; SEM cooldown (ver ⚠️); desde a Etapa
                  56 pausa um de cada vez (setEntitiesStatusSequential), não
                  mais tudo em paralelo
  adsets-pause.ts → Etapa 53: idem, mas pra Conjuntos acima da meta (inclui
                  "sem anúncio ativo") — hook público adsets-pause-tick;
                  mesmo ajuste de pausa sequencial da Etapa 56
  low-investment.ts → Etapa 53 (limite tirado na 54, devolvido na 56): acha
                  contas com orçamento diário atual mais de R$10 MENOR que o
                  Ritmo (RITMO_BAND) e SÓ AVISA — hook público
                  low-investment-tick; SEM cooldown
  bulk-status-update.ts → Etapa 55: reclassifica toda "Conta exibida" com o
                  CPA dos últimos 3 dias sem hoje (mesma lógica do diálogo
                  manual de Acompanhamento), escreve o novo status em
                  account_bindings, reordena sort_order do quadro inteiro
                  (status mais crítico primeiro, CPA decrescente dentro de
                  cada status) e manda "cliente: status" de quem mudou —
                  hook público bulk-status-tick; SEM cooldown
lib/scheduling.ts → regra de recorrência genérica (soma o intervalo à última
                    ocorrência, preservando dia da semana/mês) — usada pelos
                    disparos de WhatsApp e pelos relatórios agendados
lib/priority-labels.ts → Etapa 55: getPriorityOptions(), extraído da rota
                    priority-labels (mescla os 5 IDs fixos com o rótulo/cor
                    personalizado salvo) — reaproveitado pela automação de
                    status em massa pra montar a mensagem com o rótulo
                    certo do usuário
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
lib/demands/ (Etapa 68)
  ingest.ts     → lógica compartilhada de criação de demanda (transcreve
                  áudio, organiza em título/itens, casa cliente, grava em
                  `demands`) — usada tanto por demand-ingest (pacote pronto)
                  quanto por demand-buffer-flush (pacote montado a partir do
                  buffer); resolveUserByDemandsGroup() acha o dono do grupo
  parse-request.ts → organiza o texto da solicitação (já com áudio
                  transcrito) em título + itens. Quem separa os pedidos é a
                  IA (splitDemandTasks, lib/ai/gemini.ts) — travada por
                  prompt pra só decidir ONDE um pedido termina e outro
                  começa, nunca reescrever/resumir/corrigir/inventar (pedido
                  explícito — "não é pra adivinhar a tarefa"): cada item sai
                  com o texto exatamente como foi escrito/falado. Se a
                  chamada à IA falhar, cai num split determinístico por
                  linha/marcador de lista (sem IA), como rede de segurança
                  pra nunca perder a solicitação
  match-client.ts → casa o nome de cliente digitado à mão no WhatsApp com
                  um `account_bindings.client_name` já cadastrado (nome
                  normalizado — sem acento/maiúscula/pontuação, igual ou
                  um contendo o outro); sem bater (ou sem nome nenhum
                  mandado), a demanda fica sem conta vinculada, nunca
                  bloqueada
lib/ai/gemini.ts → transcribeAudio() e splitDemandTasks() (Etapa 68) são os
                  dois usos de IA em Demandas, travados por prompt pra nunca
                  interpretar/resumir/inventar: transcribeAudio() faz a
                  transcrição literal de áudio via Google Gemini (camada
                  gratuita), proibido resumir, corrigir sentido ou completar
                  frases; splitDemandTasks() separa um texto (já transcrito)
                  em pedidos distintos quando vêm misturados sem quebra de
                  linha — só decide ONDE cortar, cada item sai com o texto
                  exatamente como foi escrito/falado, nunca reescrito.
                  generateCopyVariations() (Etapa 70) é o oposto de
                  propósito — escreve copy NOVA (com liberdade criativa de
                  verdade, pedido explícito) pro Gerador de Copy, usando os
                  modelos de referência da subcategoria como few-shot. Recebe
                  um `tom` (fixado na subcategoria, "neutro" por padrão) e só
                  gera copy/oferta/cta — condição é anexada depois, fixa
                  (ajuste pós-Etapa 70)
lib/copy/ (Etapa 70)
  types.ts       → tipos compartilhados do Gerador de Copy (categorias fixas,
                  subcategoria — com oferta/condicao/tom/fixed fixados na
                  criação (ajuste pós-Etapa 70) —, modelo de referência,
                  variação gerada); DEFAULT_CONDICAO_TEXT/DEFAULT_TOM = os
                  defaults quando a subcategoria deixa Condição/Tom em branco
  seed-defaults.ts → dataset inicial (subcategorias + modelos de referência,
                  extraídos de anúncios reais do IVS) semeado automaticamente
                  por usuário — checagem por item (categoria+nome), não só
                  "tabela vazia", pra poder adicionar novos defaults depois
                  (caso da subcategoria fixa "Neutro" em Geral) sem duplicar
                  nem sobrescrever o que o usuário já criou
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
supabase/migrations/0013_saldo_alertas_avancados.sql → multiplicador de sexta + campos de verificação manual em pix_accounts
supabase/migrations/0014_manual_check_multi_weekday.sql → manual_check_weekday (int) → manual_check_weekdays (array)
supabase/migrations/0015_demandas.sql → tabela demands + demands_group_id/demands_group_name em whatsapp_instances (Etapa 68)
supabase/migrations/0016_demand_message_buffer.sql → tabela demand_message_buffer, usada pelo workflow do n8n pra implementar o "~15s de silêncio" (Etapa 68)
supabase/migrations/0017_copy_generator.sql → tabelas copy_subcategories, copy_reference_models e copy_generations do Gerador de Copy IVS (Etapa 70)
supabase/migrations/0018_copy_subcategory_oferta_condicao_tom.sql → colunas oferta/condicao/tom/fixed em copy_subcategories — Oferta/Condição/Tom passam a ser fixados na subcategoria (perguntados só na criação) em vez de digitados a cada geração (ajuste pós-Etapa 70)
supabase/migrations/0019_copy_subcategory_bank.sql → coluna bank_variations (jsonb) em copy_subcategories — banco de 5 variações fixas por subcategoria, reusadas pra qualquer cliente sem chamar IA (ajuste pós-Etapa 70)
supabase/migrations/0020_boleto_sends.sql → tabela boleto_sends — histórico de envio de boleto por e-mail (Controle de Saldo, Etapa 71)
supabase/migrations/0021_boletos_bucket.sql → bucket boletos (Storage) + policies de dono/leitura pública, mesmo padrão do whatsapp-media (Etapa 71)
supabase/migrations/0022_pix_whatsapp_dispatch.sql → pix_target_type/pix_target_number em pix_accounts (destino do Pix), coluna parts em whatsapp_scheduled_dispatches (sequência de mensagens), last_run_at/last_error (bug pré-existente corrigido) e tabela pix_sends (histórico de envio de Pix) (Etapa 73)
supabase/migrations/0023_pix_dispatch_message_nullable.sql → message em whatsapp_scheduled_dispatches deixa de ser NOT NULL — disparo de Pix agendado insere parts e message null, e a coluna ainda exigia message desde a criação da tabela (0001_init.sql) (correção pós-Etapa 73)
```
n8n-workflows/demandas-whatsapp.json → workflow pronto pra importar no n8n (Menu → Import from File) que implementa o passo 16 da seção de deploy — só nós nativos (Webhook, IF, Set, HTTP Request, Wait, NoOp), sem nó Code
n8n-workflows/boleto-email.json → workflow pronto pra importar no n8n (Menu → Import from File) que implementa o passo 17 da seção de deploy — Webhook + HTTP Request (baixa o PDF) + Gmail, sem nó Code

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
    ganhou a coluna Ritmo: quanto investir por dia até o fim do mês (dias
    reais do mês desde a Etapa 82; antes fixo em 30) pra bater o Investimento mensal cadastrado
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
45. ~~Link direto pro Gerenciador de Anúncios no nome do cliente em
    Evolução (Etapa 51)~~ ✅ — o nome do cliente em cada linha da tela
    Evolução agora abre a conta correspondente no Facebook Ads Manager em
    nova aba, mesmo padrão visual e de link já usado em Acompanhamento,
    Controle de Saldo, Visão Geral e Clientes
46. ~~Limite de Conjuntos vira 2x a Meta CPA + R$1 fixo (Etapa 52)~~ ✅ —
    a tela Conjuntos (aba "CPA acima da meta") passou a exigir o DOBRO da
    Meta CPA MAIS R$1 (não mais o triplo) pra entrar na lista, com o
    mesmo cálculo valendo pros dois casos (com ou sem conversa iniciada).
    A tela Criativos não mudou. Veja o ⚠️ acima
47. ~~4 automações novas de pausa/aumento/aviso via n8n (Etapa 53)~~ ✅ —
    Mensagens → Avisos ganhou: pausa automática de Criativos acima da meta
    (05h/09h/13h/23h), pausa automática de Conjuntos acima da meta
    (05h05/09h05/13h05/23h05), aumento automático de R$2,50 fixo no
    orçamento de Conjuntos com CPA bom nos últimos 3 dias (06h), e aviso
    (só notifica, não muda nada) de investimento baixo, de segunda a sexta
    (07h/09h15/13h) — todas reaproveitando a mesma lógica/limite das telas
    de Análise e Acompanhamento, cada uma com hook público próprio pro n8n
    e botão manual na tela. Veja o ⚠️ acima
48. ~~Aviso de investimento baixo sem banda de tolerância (Etapa 54)~~ ✅ —
    o aviso automático "Investimento baixo" (Etapa 53) passou a disparar
    pra QUALQUER conta com orçamento diário menor que o Ritmo necessário,
    por menor que seja a diferença — antes só entrava passando de R$10,
    igual ao filtro de Acompanhamento. A cor da coluna Ritmo e o filtro
    Investimento de Acompanhamento continuam com a banda de R$10, sem
    mudança. Veja o ⚠️ acima
49. ~~Automação de atualização de status em massa + reordenar o quadro
    (Etapa 55)~~ ✅ — Mensagens → Avisos ganhou "Atualização de status em
    massa": reclassifica sozinha toda conta exibida com o CPA dos últimos 3
    dias (sem hoje), mesma lógica do botão manual de Acompanhamento, sempre
    desconsiderando inauguração; escreve o novo status de quem mudou,
    reordena o quadro inteiro (status mais crítico primeiro, CPA
    decrescente dentro de cada status) e manda uma única mensagem com o
    status de TODO cliente classificado — mudou ou manteve —, sempre só
    "cliente: status", sem dizer qual dos dois casos é e sem comentário —
    pensada pra rodar segunda e quinta de madrugada via n8n. Veja o ⚠️ acima
50. ~~Pausas sequenciais, banda de R$10 de volta e teto de R$25 no aumento
    automático (Etapa 56)~~ ✅ — três ajustes nas automações de Mensagens →
    Avisos depois de testar em produção: as pausas automáticas de Criativos
    e Conjuntos agora mandam as requisições pra Meta uma de cada vez, com
    3s de intervalo, em vez de todas em paralelo; o aviso de investimento
    baixo voltou a usar a banda de R$10 (estava sem banda desde a Etapa
    54); e o aumento automático de orçamento ganhou um teto de R$25,00 —
    se o orçamento diário do conjunto já estiver nesse valor ou mais, a
    automação não aumenta mais aquele conjunto. Veja os ⚠️ acima
51. ~~Busca por nome em Visão Geral (Etapa 57)~~ ✅ — novo campo de busca
    pesquisa Campanhas/Conjuntos/Anúncios (o nível escolhido) sempre em
    TODAS as "Contas exibidas" de uma vez, fixo, sem opção de escolher uma
    conta ou algumas; digitar mais letras não refaz a chamada à Meta, só
    refina localmente o que já foi buscado. Veja o ⚠️ acima
52. ~~Remoção do aumento automático de orçamento (Etapa 58)~~ ✅ — a
    automação que aumentava sozinha, 1x/dia via n8n, o orçamento diário de
    todo conjunto com CPA bom (nascida na Etapa 53, com teto de R$25 desde
    a Etapa 56) foi removida por pedido — saiu a seção "Conjuntos com CPA
    bom" de Mensagens → Avisos, a rota `alerts/budget-increase` e o hook
    `public/hooks/increase-budget-tick`. O botão manual "Aumentar +R$2,50"
    de Análise (aba "abaixo da meta") continuou existindo. Veja o ⚠️ acima
53. ~~Teto de R$25 de volta no botão manual de aumento (Etapa 59)~~ ✅ — a
    remoção da Etapa 58 tinha deixado o botão manual "Aumentar +R$2,50" de
    Análise sem teto nenhum; pedido explícito pra manter o teto de R$25,00
    (o mesmo que a automação tinha) só na ação manual — hoje o botão nunca
    aumenta um conjunto cujo orçamento diário já esteja em R$25 ou mais.
    Veja o ⚠️ acima
54. ~~Coluna Leads em Acompanhamento (Etapa 60)~~ ✅ — nova coluna entre
    CPA e Valor usado com o número de conversas iniciadas (campo
    `results` da Meta, o mesmo "Resultado" do Gerenciador de Anúncios) —
    dado que já existia (é a base do cálculo do CPA), só não aparecia
    como número na tabela
55. ~~Nova aba Monitor de CPA (Etapa 61)~~ ✅ — quadro exclusivo de CPA em
    Painel, um gráfico de barras por cliente sempre ordenado do pior CPA
    pro melhor (maior diferença acima do ideal primeiro), com o CPA ideal
    marcado dentro da própria barra (tracinho + valor) e a diferença
    logo depois. Cor por faixa: vermelho acima de R$2,00 do ideal
    (Crítico), laranja até R$2,00 acima (Atenção), verde dentro da meta.
    Filtro de período (Hoje / Ontem / Hoje e ontem / Últimos 3 dias /
    Este mês): "Hoje", "Hoje e ontem" e "Este mês" mudam a cada minuto e
    por isso são sempre buscados ao vivo na Meta, com um botão
    "Atualizar" manual; "Ontem" e "Últimos 3 dias" são dias fechados (não
    mudam mais depois que o dia vira), então ficam guardados num cache
    (reaproveitando a tabela `meta_insights_cache`, que já existia no
    schema sem uso) recalculado 1x por dia pelo novo hook
    `public/hooks/cpa-board-cache-tick` — sugerido às 07h10 no n8n, ver
    passo 15 da seção de deploy. Um botão "Calcular agora" na tela força
    esse cálculo na hora, útil só pra destravar o primeiro uso antes do
    hook ter rodado pela primeira vez. Toda conta selecionada em "Contas
    exibidas" aparece no quadro (mesmo critério das outras abas do
    Painel); quem ainda não tem CPA ideal cadastrado (Painel → Clientes)
    entra com a barra cinza, sem tracinho nem diferença, só mostrando o
    CPA real — correção de um bug (Etapa 61-bis): a primeira versão só
    mostrava quem já tinha CPA ideal, escondendo o resto, e o cache do
    hook também só cobria essas contas; agora tanto a tela quanto o cache
    diário cobrem toda conta exibida, com ou sem meta cadastrada
56. ~~Seletor de conjuntos em Análise "abaixo da meta" (Etapa 62)~~ ✅ —
    pedido explícito pra ficar igual à tela "acima da meta": agora a lista
    de Conjuntos "abaixo da meta" também tem checkbox por linha,
    "Selecionar todos os listados" e um botão "Aumentar selecionados", ao
    lado do "Aumentar todos os orçamentos listados" que já existia (esse
    continua igual, ignorando a seleção). Mesma lógica de confirmação em
    dois cliques e pausa de 3s entre chamadas das outras ações em massa
57. ~~Controle de Saldo vira quadro de monitoramento orientado a alerta
    (Etapa 63)~~ ✅ — pedido explícito: toda "Conta exibida" continua sendo
    monitorada sempre, mas a aba Controle de Saldo agora só lista quem está
    pendente ou com algum aviso — conta 100% OK simplesmente não aparece.
    Quatro tipos de monitoramento, todos por conta: (1) erro no pagamento
    (automático pra toda conta, reaproveitando a checagem que já existia);
    (2) saldo abaixo do limite, pré-paga/híbrida (já existia); (3) NOVO —
    sexta-feira: pré-paga/híbrida com um multiplicador configurado (2x ou
    3x) entra em alerta se o saldo disponível cair abaixo de limite ×
    multiplicador, pensado pra avisar a tempo do fim de semana (só é
    avaliado numa sexta-feira, fuso America/Sao_Paulo); (4) NOVO —
    verificação manual: não importa o tipo de conta, dá pra agendar um
    lembrete num dia fixo da semana ou "daqui X dias", com Repetir (o
    lembrete volta a se repetir sozinho depois de marcado como verificado)
    ou Pausar (fica dormente, configuração preservada, até religar). Os 3
    campos que já existiam — "Alertar quando <", Observação e Tipo de
    conta — foram mantidos, junto com o multiplicador de sexta e a
    verificação manual, todos editáveis no novo botão "Personalizar
    alertas" da aba, que abre um quadro com TODAS as contas (inclusive as
    OK) agrupadas por tipo de pagamento, igual a tela antiga fazia sempre.
    Quem tem uma verificação manual pendente ganha um botão "Marcar como
    verificado" direto na lista de pendências. Os dois avisos novos também
    saem no WhatsApp (grupo de Configurações → WhatsApp), reaproveitando o
    MESMO hook público que já existia (`balance-alert-tick`) — não precisa
    criar workflow novo no n8n, veja o passo 8 da seção de deploy. Nova
    migração (`0013_saldo_alertas_avancados.sql`) acrescenta a
    `pix_accounts`: `friday_multiplier`, `friday_alert_sent_at` (cooldown
    de 24h próprio, separado do saldo baixo comum) e as colunas de
    verificação manual (`manual_check_mode`, `manual_check_weekdays` —
    renomeada de `manual_check_weekday` na Etapa 67, ver abaixo —,
    `manual_check_interval_days`, `manual_check_repeat`,
    `manual_check_next_at`, `manual_check_last_verified_at`,
    `manual_check_alert_sent_at`)
58. ~~Campo de busca em Personalizar alertas~~ ✅ — o modal de Personalizar
    alertas (Controle de Saldo) ganhou um campo no topo pra buscar por nome
    do cliente, nome da conta na Meta ou ID da conta; grupo com resultado
    abre sozinho enquanto a busca está ativa
59. ~~Novo filtro "Este mês, até ontem" (Etapa 64)~~ ✅ — mesma ideia do
    "Mês atual" que já existia, mas sem o dia de hoje (que ainda está em
    andamento): do dia 01 do mês corrente até ontem, os dois já fechados.
    Entra na lista compartilhada `DATE_PRESETS`
    (`this_month_until_yesterday`), então aparece em toda tela que usa esse
    filtro — Acompanhamento (pedido original), Análise, Visão Geral e
    modelos de Relatório. Calculado como um `time_range` (dia 01 do mês até
    ontem, fuso America/Sao_Paulo), igual ao "Ontem e hoje"; no dia 1º do
    mês (quando "ontem" cairia no mês anterior) usa só o dia 01 em vez de
    mandar um intervalo invertido pra Meta
60. ~~Exclusão por nomenclatura "[TRÁFEGO]" (Etapa 65)~~ ✅ — pedido
    explícito: campanha com "[TRÁFEGO]" no nome (com ou sem acento) some de
    toda métrica/tela do Painel, exatamente como já acontecia com "[VAGA]".
    Como as duas exclusões por nome sempre passaram pela mesma função
    central (`isVaga`, em `lib/meta/shared.ts`, reaproveitada por
    Acompanhamento, Evolução, Análise, Visão Geral e Monitor de CPA), só
    precisou estender essa checagem — nenhuma tela precisou de ajuste
    separado. Continua diferente da exclusão por OBJETIVO da campanha
    (`EXCLUDED_OBJECTIVES`, que já pegava o objetivo "Tráfego" de verdade
    reportado pela Meta): agora as duas convivem, então uma campanha cai
    fora tanto por ter o objetivo Tráfego quanto por ter a tag no nome
61. ~~Coluna Observação em Controle de Saldo (Etapa 66)~~ ✅ — pedido
    explícito: a lista de contas pendentes/com aviso ganhou uma coluna
    "Observação" mostrando a nota já cadastrada em Personalizar alertas
    (campo `notes` de `pix_accounts`), sem precisar abrir o modal só pra ver
    esse texto
62. ~~Verificação manual em mais de um dia da semana (Etapa 67)~~ ✅ —
    pedido explícito: o modo "Dia fixo da semana" da verificação manual
    (Controle de Saldo → Personalizar alertas) deixou de aceitar só um dia
    — agora é uma seleção de dias (ex.: segunda E quinta), com um botão
    por dia da semana (Dom a Sáb, multi-seleção). Coluna
    `manual_check_weekday` (int único) virou `manual_check_weekdays`
    (array de int) em `pix_accounts` — migração
    `0014_manual_check_multi_weekday.sql` faz o backfill de quem já tinha
    um dia configurado (vira array de 1) e remove a coluna antiga, mesmo
    padrão de troca de coluna já usado na Etapa 37. `computeManualCheckNextAt`
    (`lib/alerts/manual-check.ts`) passou a achar o próximo dia dentre
    QUALQUER um dos escolhidos, não mais um único
63. ~~Nova aba Demandas — solicitações do WhatsApp viram tarefas (Etapa
    68)~~ ✅ — pedido explícito: um grupo dedicado do WhatsApp (configurado
    em Configurações → WhatsApp → "Grupo para Demandas", junto com o de
    alertas) recebe solicitações — texto ou áudio, podendo vir em mais de
    uma mensagem — seguidas de uma última mensagem só com o nome do
    cliente. Um workflow pronto pra importar no n8n (`n8n-workflows/demandas-whatsapp.json`,
    ver passo 16 da seção de deploy — só nós nativos, sem nó Code) guarda
    cada mensagem recebida num buffer (nova tabela `demand_message_buffer`)
    e junta as de um mesmo remetente depois de ~15s de silêncio (o n8n não
    tem um jeito nativo de "esperar até parar de chegar mensagem", então o
    workflow implementa isso conferindo no banco se ainda é a mensagem mais
    recente antes de processar). No fim, o pacote montado passa por
    lib/demands/ingest.ts, que usa Google Gemini (camada gratuita,
    `lib/ai/gemini.ts`) em duas etapas — ⚠️
    IMPORTANTE, pedido explícito ("a geração da tarefa não é pra adivinhar"):
    as duas são travadas por prompt pra NUNCA reescrever, resumir, corrigir
    ou inventar o que foi dito, só (1) transcrever áudio literalmente e (2)
    decidir ONDE separar os pedidos quando a mensagem traz mais de um
    misturado no mesmo texto (comum em áudio, que sai sem quebra de linha) —
    cada item final sai com o texto exatamente como foi escrito/falado (ex.:
    "Vamos começar amanhã as 09" vira a tarefa "Vamos começar amanhã as 09",
    sem reescrever). Se a chamada à IA falhar, cai num split determinístico
    por linha/marcador de lista como rede de segurança, pra nunca perder a
    solicitação; (3) tenta casar o nome de cliente digitado com um cliente
    já cadastrado (`lib/demands/match-client.ts`, por nome normalizado) —
    sem bater, ou se a mensagem com o nome nem foi mandada, a demanda entra
    "em aberto" (sem cliente vinculado) em vez de travar, e dá pra atribuir
    manualmente depois direto na aba Demandas ("+ atribuir cliente"). Cada
    demanda mostra dia/hora/minuto exatos da solicitação (fuso
    America/Sao_Paulo), o texto organizado e, quando tem mais de um item,
    a lista completa. Dá pra arrastar-e-soltar pra reordenar por
    prioridade (a mais antiga fica em primeiro por padrão, até alguém
    mexer manualmente). Um botão "Finalizar" por tarefa — pedido explícito:
    finalizar já APAGA a linha de vez, sem manter histórico nenhum. Nova
    tabela `demands` + colunas `demands_group_id`/`demands_group_name` em
    `whatsapp_instances` (migração `0015_demandas.sql`)
64. ~~Reordenação de colunas em Acompanhamento (Etapa 69)~~ ✅ — pedido
    explícito: ordem nova é Otimizado, Cliente, Conta, Status, Valor usado,
    Leads, CPA, CPA ideal, Invest. diário, Ritmo. Além de mover, dois
    ajustes de exibição: "CPA ideal" ganhou o prefixo "R$" do lado do campo
    editável (antes era só um número solto, sem indicar que é dinheiro); a
    diferença que só aparecia como dica ao passar o mouse em cima do Ritmo
    (Invest. diário − Ritmo) virou uma linha sempre visível embaixo do
    valor de "Invest. diário", com a mesma cor condicional que já existia
    (verde/laranja/vermelho, `ritmoColorClass`) — exatamente como a coluna
    CPA já mostra a diferença pro CPA ideal embaixo do valor. A coluna
    Ritmo, em troca, ficou só com o valor puro, sem cor nem dica ao passar
    o mouse
65. Nova aba **Copy** (Etapa 70) — gerador de copy de anúncio pro Instituto
    Visão Solidária (franquia de ótica com centenas de unidades, oferta
    praticamente igual entre elas, só muda o endereço). 4 categorias fixas
    (Geral, Promoção, Exames, Inauguração) e subcategorias criadas livremente
    pelo usuário dentro de cada uma (ex.: "Geral + Cobrimos oferta",
    "Promoção + Armação por 1 real"); Inauguração já nasce com 3
    subcategorias pré-criadas (Armação 1 real, Padrão, Exame) e campos
    extras configuráveis por subcategoria (`extra_fields`, ex.: "Data da
    inauguração", "Valor do exame") — evita ter que mexer em código toda vez
    que uma subcategoria precisar de um campo novo. Ao gerar, o cliente (e
    seu endereço, de Clientes/`account_bindings`) + categoria + subcategoria
    viram um prompt pro Gemini com os modelos de referência daquela
    subcategoria como exemplo (few-shot, extraídos de anúncios reais do IVS)
    — ao contrário da IA de Demandas (só transcreve/separa texto literal,
    nunca inventa), aqui foi pedido explicitamente liberdade criativa de
    verdade. Sempre 5 variações (Copy + Oferta + CTA + Condição — Endereço
    vem fixo do cadastro), cada uma com botão de copiar e "gerar de novo só
    essa", e histórico salvo por cliente. Novas tabelas `copy_subcategories`,
    `copy_reference_models` e `copy_generations` (migração
    `0017_copy_generator.sql`), semeadas automaticamente com o dataset
    inicial na primeira abertura da aba (`lib/copy/seed-defaults.ts`).
    **Ajuste pedido depois de testar em produção:** Oferta/Condição/Tom
    deixaram de ser digitados a cada geração — agora são fixados na própria
    subcategoria, perguntados só na hora de criar uma nova (a tela ganhou um
    formulário "+ Nova subcategoria" com esses 3 campos, todos opcionais).
    Oferta vazia continua deixando a IA inferir o mecanismo pelos modelos de
    referência; Condição vazia usa um texto padrão genérico
    (`DEFAULT_CONDICAO_TEXT`) e Tom vazio vira "neutro" (`DEFAULT_TOM`) —
    escrita direta e informativa, sem gatilho mental nem emoji de ênfase. A
    categoria Geral ganhou uma subcategoria fixa **"Neutro"** (não pode ser
    apagada/renomeada pela tela, coluna `fixed` em `copy_subcategories`),
    sempre disponível como opção sem tom nenhum. Nova migração
    `0018_copy_subcategory_oferta_condicao_tom.sql` (colunas `oferta`,
    `condicao`, `tom`, `fixed` em `copy_subcategories`). **Banco de 5
    variações fixas por subcategoria (outro ajuste pós-produção):** pedido
    explícito do usuário pra parar de chamar a IA toda vez que gera pra um
    cliente diferente da mesma oferta. Fluxo: gera as 5 com IA normalmente
    (uma vez), revisa o texto na tela, e clica em "💾 Salvar essas 5 como
    banco fixo" — dali em diante, gerar pra QUALQUER cliente dessa
    subcategoria reusa essas 5 variações tal e qual, sem chamar o Gemini,
    trocando só o endereço (que já é um campo separado, vindo do cadastro do
    cliente, nunca embutido no texto de "copy" mesmo no fluxo de IA — por
    isso "trocar só o endereço" não precisou de lógica nova). Um aviso amarelo
    aparece na tela quando a subcategoria está nesse modo, com um botão
    "Remover banco" pra voltar a gerar com IA. Nova coluna
    `bank_variations` (jsonb) em `copy_subcategories` (migração
    `0019_copy_subcategory_bank.sql`) e nova rota
    `PUT/DELETE /api/copy/subcategories/[id]/bank`
66. **Enviar boleto por e-mail (Etapa 71)** — dentro de Controle de Saldo,
    uma seção nova "📧 Enviar boleto por e-mail": escolhe o cliente, a data
    de vencimento e sobe o PDF do boleto; um clique em "Enviar e-mail"
    dispara pro financeiro o mesmo e-mail que já era mandado manualmente
    pelo Gmail — assunto com o nome da loja, corpo fixo ("Solicito
    verificar a possibilidade do pagamento do boleto em anexo, {loja} até
    {dia da semana} {data}. Obrigado!..."), sempre pro mesmo destinatário
    (`BOLETO_FINANCE_EMAIL`). O app não manda e-mail direto: sobe o PDF pro
    bucket `boletos` (Storage, público — mesmo motivo do `whatsapp-media`,
    é o n8n que baixa o arquivo pela URL) e faz um POST pro webhook do n8n
    (`BOLETO_WEBHOOK_URL`), que manda de verdade pelo nó nativo do Gmail —
    mesmo padrão "app empurra pro n8n" do webhook de venda do CRM. Workflow
    pronto `n8n-workflows/boleto-email.json` (Webhook + HTTP Request pra
    baixar o PDF + Gmail, sem nó Code — passo 17 da seção de deploy).
    Histórico de envios (loja, vencimento, arquivo, status) numa listinha
    "Ver histórico" na mesma seção, guardado na nova tabela `boleto_sends`
    (migração `0020_boleto_sends.sql`; bucket em `0021_boletos_bucket.sql`).
67. **Reordenar junto com "Atualizar status em massa" (Etapa 72)** — o botão
    manual de Acompanhamento (`components/painel/bulk-status-dialog.tsx`),
    além de reclassificar o status, agora também reordena a lista pedido à
    parte: **Inauguração no topo**, depois Crítica, Alta, Média e Baixa —
    ⚠️ ordem DIFERENTE da automação agendada da Etapa 55
    (`lib/alerts/bulk-status-update.ts`), que deixa Inauguração por último;
    são dois critérios de ordenação distintos, um por tela. Dentro de cada
    grupo, **ajuste pedido depois de testar em produção**: não é mais o CPA
    absoluto (últimos 3 dias) — é a diferença entre o CPA real e o CPA
    ideal DA PRÓPRIA CONTA (`cpa - cpa_target`, a mesma conta de
    `classify()`), maior diferença primeiro. Isso evita o caso de uma conta
    com meta mais alta (CPA absoluto maior, mas relativamente mais perto da
    própria meta) furar na frente de outra que estourou mais a própria
    meta com um CPA absoluto menor. Só reordena quando a lista está sem
    busca, grupo de foco ou filtro de Status/CPA/Investimento/Otimizado
    ativo (mesma trava do arrastar-e-soltar) — com algum desses ativos, o
    botão continua reclassificando normalmente, só sem mexer na ordem, com
    um aviso explicando o motivo na tela de confirmação.
68. **Enviar Pix por WhatsApp (Etapa 73)** — igual ao boleto por e-mail, só
    que por WhatsApp: na coluna Ação de cada conta pendente em Controle de
    Saldo, um botão "📲 Enviar Pix" abre um modal com o destino já resolvido
    (grupo do cliente ou um número fixo — configurado uma vez em
    Personalizar alertas &gt; "Destino do Pix", raramente muda), um campo
    pro texto do Pix (copia e cola) e o upload do print. Ao confirmar, manda
    4 mensagens em sequência no chat, igual ao que já era feito manualmente:
    saudação (Bom dia/Boa tarde/Boa noite, conforme o horário de Brasília na
    hora do envio), o texto fixo "Segue pix para adicionar saldo na conta de
    anúncios", o texto do Pix, e por último o print. Dá pra **enviar agora**
    ou **programar** o disparo pra uma data/hora — o agendado reaproveita o
    mesmo sistema de agendamento de Mensagens &gt; Envio
    (`whatsapp_scheduled_dispatches` + o hook `whatsapp-dispatch-tick`, sem
    workflow novo no n8n — ver passo 18 da seção de deploy), só que com uma
    nova coluna `parts` (sequência de mensagens) em vez do `message` único
    usado por Mensagens &gt; Envio; a lista "Agendados" dessa aba mostra um
    rótulo "📲 Pix — {cliente}" pra esses agendamentos. Um botão "📲
    Histórico de Pix" no topo de Controle de Saldo mostra os últimos envios
    (loja, destino, status, agendado para quando) — nova tabela `pix_sends`.
    Nova coluna "Destino do Pix" em Personalizar alertas (grupo/número +
    campo do número quando aplicável). De brinde, corrigido um bug antigo:
    o hook `whatsapp-dispatch-tick` já gravava `last_run_at`/`last_error`
    desde sempre (e a tela de Mensagens &gt; Envio já lia esses campos), mas
    as colunas nunca existiram na tabela — o update final de cada disparo
    vinha silenciosamente falhando. ⚠️ O contrato de `/send/media` da uazapi
    usado aqui (mesmo já usado pelos anexos de Mensagens &gt; Envio) foi
    montado por analogia com `/send/text` e nunca foi confirmado contra a
    documentação oficial — teste com atenção o primeiro envio de print.
    Tudo na migração `0022_pix_whatsapp_dispatch.sql`.
69. **Correção: lista de grupos do WhatsApp incompleta (Etapa 74)** — em
    qualquer tela que lista grupos pra vincular/selecionar (Painel →
    Clientes, Mensagens → Envio, Relatórios), quem tem muitos grupos via de
    menos grupos do que realmente existem, sem nenhum erro na tela — nem o
    botão "Atualizar grupos" resolvia. Causa: `POST /group/list` da uazapi é
    paginado (`limit`/`offset`), e o código só pedia uma página, sem nunca
    pedir as seguintes — o problema nunca foi cache (por isso "Atualizar"
    não fazia diferença), era faltar paginar. `listGroups`
    (`lib/whatsapp/client.ts`) agora busca todas as páginas (100 por vez, até
    uma página vir incompleta) antes de devolver a lista.
70. **Colar o print do Pix direto (Ctrl+V) no modal "Enviar Pix" (ajuste
    pós-Etapa 73)** — em vez de só o botão "📎 Anexar print" (que abre o
    seletor de arquivo), agora dá pra tirar o print e colar direto no modal
    com Ctrl+V (Cmd+V no Mac) — sobe pro mesmo bucket `whatsapp-media` de
    sempre. ⚠️ Se o upload (por botão ou por colar) responder "Bucket not
    found", o bucket `whatsapp-media` (Storage) não existe nesse projeto do
    Supabase — rode de novo o SQL da migração `0006_whatsapp_media_bucket.sql`
    (idempotente, pode rodar de novo mesmo que parte já exista).
71. **Correção: Pix agendado falhava com erro de banco (ajuste pós-Etapa
    73)** — programar o disparo de Pix (em vez de mandar na hora) respondia
    `null value in column "message"... violates not-null constraint`. A
    coluna `message` de `whatsapp_scheduled_dispatches` é obrigatória desde a
    criação da tabela, mas o Pix agendado sempre insere `message: null` (usa
    `parts`, a sequência de mensagens, no lugar) — ninguém tinha liberado essa
    coluna pra aceitar null. Corrigido na migração
    `0023_pix_dispatch_message_nullable.sql`.
72. **Coluna "Invest. diário" em Controle de Saldo (Etapa 75)** — na tabela
    de contas pendentes, nova coluna mostra o orçamento diário atual dos
    conjuntos/campanhas ativos de cada conta (`insight.daily_budget`), o
    mesmo dado já usado na coluna de mesmo nome em Acompanhamento — sem o
    comparativo com o Ritmo que existe lá, só o valor. Controle de Saldo
    passou a buscar `insights` da Meta (antes só rodava fora da aba
    Acompanhamento).
73. **Correção: pausa automática de Criativos/Conjuntos mexendo em conta
    fora do Painel (ajuste pós-Etapa 53)** — as automações "Criativos
    pausados automaticamente" e "Conjuntos pausados automaticamente"
    (`lib/alerts/creatives-pause.ts` e `lib/alerts/adsets-pause.ts`, tanto no
    botão manual de Mensagens → Avisos quanto no disparo automático via n8n)
    varriam TODA conta com meta de CPA cadastrada em `account_bindings`, sem
    checar se ela ainda está entre as "Contas exibidas" do Painel
    (`user_selected_accounts`) — uma conta desmarcada do Painel, mas com meta
    de CPA de uma configuração antiga, continuava tendo criativos/conjuntos
    pausados sozinha, sem aparecer em lugar nenhum da tela (relatado com a
    conta "Marcia Dantas"). Agora as duas automações usam o mesmo universo de
    contas já usado pela atualização de status em massa
    (`lib/alerts/bulk-status-update.ts`): só quem está selecionado no Painel.
74. **Monitor de CPA sempre abre em "Hoje" (Etapa 77)** — o período inicial
    era "Ontem" toda vez que a aba era aberta (não tem nada persistido de
    uma sessão pra outra, era só o valor padrão mesmo); trocado pra "Hoje".
75. **Análise → Conjuntos (acima da meta): separação dos "Sem anúncio
    ativo" (Etapa 78)** — os conjuntos com o selo "Sem anúncio ativo" agora
    sempre aparecem primeiro dentro de cada conta, com um divisor "Com
    anúncio ativo" separando o resto da lista (mesmo sem nenhum filtro
    ligado), e um novo filtro "Só sem anúncio ativo" ao lado da busca
    esconde o restante quando só interessa ver esses.
76. **Controle de Saldo reorganizado em sub-abas por Tipo de conta (Etapa
    79)** — a tela virou abas: Pendências (só quem tem algum aviso agora,
    de qualquer tipo), Pix, Híbrida, Boleto e Cartão (cada uma mostrando
    TODAS as contas daquele tipo, pendente ou não) e Configurações (onde
    cada conta é classificada manualmente num desses 4 tipos — antes era o
    modal "Personalizar alertas"). "Enviar Pix" só aparece pra Pix/Híbrida,
    "Enviar boleto" só pra Boleto (o formulário de boleto mudou pra dentro
    dessa aba), e Cartão não tem ação específica, só os avisos normais
    (saldo/pagamento/verificação manual). O campo Tipo de conta é o mesmo
    de sempre (antes Pré-paga/Híbrida/Pós-paga/Loja própria), só que agora
    é preenchido manualmente — parou de puxar automático da Meta (Pós-paga
    misturava quem paga por boleto e por cartão, sem distinguir os dois) —
    e, como não dava pra migrar esse valor sozinho, toda conta começa "sem
    tipo definido" até ser reclassificada (o resto da configuração de cada
    uma — Observação, limites, sexta-feira, verificação manual — continua
    intacto).
77. **Controle de Saldo: coluna "Saldo" deixa claro se é disponível ou a
    pagar (Etapa 80)** — a mesma coluna misturava dois significados opostos
    sob o mesmo rótulo "Saldo disponível": em conta Pix/Híbrida com teto de
    gasto, o número é o quanto ainda dá pra gastar antes de recarregar
    (cai com o uso); em conta Boleto/Cartão sem teto, o número bruto da
    Meta é o valor JÁ acumulado desde a última cobrança (sobe com o uso —
    é o que vai ser cobrado, não sobra nenhuma). Agora cada linha mostra um
    selo "disponível" ou "a pagar" do lado do valor, com o detalhe (teto −
    gasto, ou aviso de que é valor acumulado) explicado ao passar o mouse.
78. **"Saldo por fundos", independente do Tipo de conta (Etapa 81)** — a
    Meta não expõe pela API o "Fundos" que aparece no Ads Manager (testado
    direto: nem o campo `balance`, nem `funding_source_details` trazem
    esse número — só o valor acumulado a pagar e o método de pagamento).
    Pra conta cujo saldo real não bate com o cálculo padrão de Pix/Híbrida/
    Boleto/Cartão (ex.: uma conta classificada como Boleto que na prática
    também recebe pagamento manual), dá pra ligar em Configurações um
    cálculo à parte, conta por conta: você informa o saldo atual real (que
    já vê no Ads Manager) uma vez, e dali em diante o app soma todo
    pagamento manual/PIX e subtrai toda cobrança da Meta que acontecer
    (reconstruído do histórico de atividades da conta, que a própria Meta
    só guarda por ~90 dias — por isso não dá pra reconstruir "desde
    sempre", só rastrear pra frente a partir do saldo informado). Atualiza
    via um novo hook (`/api/public/hooks/funds-balance-tick`, mesmo padrão
    dos outros — precisa ser chamado periodicamente pelo n8n) e aparece na
    coluna Saldo de Controle de Saldo com o selo "fundos" no lugar do
    cálculo padrão, só nas contas em que foi ligado.

79. **Aba "Acompanhamento de metas" + Ritmo com dias reais do mês (Etapa 82)** —
    nova aba na lateral do Painel, modelada no dashboard de referência da
    Speed (Gerenciamento de Contas). Investimento e CPA vêm do dia 01 até
    ontem (preset `this_month_until_yesterday`, já existente, sem rota nova
    nem migração), comparados com o **Ideal até hoje** = Investimento
    mensal ÷ dias reais do mês × dia de hoje (contando hoje) — igual à
    Speed, que chama de "Ideal até hoje" (ex.: dia 04 de outubro, meta
    R$ 3.000 → 3.000 ÷ 31 × 4 = R$ 387,10; conferido contra as contas da
    Speed, todas batendo com 31 dias e nenhuma com 30). ⚠️ A primeira versão
    usava só os dias já fechados (dia − 1) no ideal e a conta IVS Teresina
    aparecia "Acima do ideal" enquanto na Speed estava "Dentro da meta" —
    corrigido pra contar hoje, como a Speed faz (o investimento continua até
    ontem, só o ideal conta o dia de hoje). Colunas: Invest. mensal, Investimento até ontem (com a
    diferença em R$ pro ideal), Ideal até hoje, % de investimento (barra com o
    tracinho do ideal e dica com atual/meta/ideal), Invest. diário e Ritmo
    (iguais aos de Acompanhamento — o Ritmo usa o gasto do mês inteiro, contando
    hoje, numa busca à parte; a cor da diferença `ritmoColorClass` passou a
    morar em `lib/meta/ritmo.ts`), CPA atual (com a
    diferença pro CPA ideal) e CPA ideal. Status de investimento: abaixo de
    80% do ideal = laranja "Faltam"; de 80% a 120% = verde "Dentro da
    meta"; acima de 120% = vermelho "Acima do ideal" (o limite de 80% foi
    deduzido da Speed; o de 120% é palpite, a Speed não mostra esse caso —
    `INVEST_LOW_RATIO`/`INVEST_HIGH_RATIO` em `lib/meta/metas.ts`). CPA: mesma
    banda do Acompanhamento (até R$ 1,40 acima do ideal = aceitável, mais
    que isso = crítico). 4 ordenações: Mais crítica (CPA crítico + investimento
    fora primeiro, depois só um dos problemas, depois quem está ok), CPA
    elevado (maior diferença pro ideal primeiro), Investimento fora pra cima
    e Investimento fora pra baixo — aqui "fora" é a diferença Invest. diário −
    Ritmo (a mesma mostrada embaixo de Invest. diário): pra cima, o orçamento
    diário mais acima do que precisa primeiro; pra baixo, o mais abaixo
    primeiro (ninguém é escondido, só desce na lista; a primeira versão
    ordenava pelo investido − ideal em R$ e foi trocada a pedido) Conta sem meta cadastrada vai pro fim.
    **Junto disso o Ritmo de Acompanhamento deixou de fixar o mês
    em 30 dias** e passou a usar os dias reais (28-31, fuso de Brasília) —
    a mesma base da nova aba; isso também vale pro aviso automático de
    investimento baixo, que reaproveita a mesma conta (`monthCalendarSP` em
    `lib/meta/ritmo.ts`).

80. **Coluna "Otimizado" em Acompanhamento de metas (Etapa 83)** — a aba
    Acompanhamento de metas ganhou a sua própria coluna Otimizado (primeira
    coluna), com o mesmo comportamento da de Acompanhamento: um clique
    alterna entre "Não otimizado" e "Otimizado", filtro Otimizado/Pendente na
    barra da aba e reset à meia-noite (horário de Brasília) — a marcação só
    vale se a data gravada (`tab_optimized_date`) for hoje. Cada aba tem a
    sua: marcar na de Acompanhamento não muda nada na de metas e vice-versa,
    e os filtros Otimizado/Pendente também são separados. (Uma primeira
    versão criou por engano uma aba "Otimizado" à parte; foi removida e a
    coluna foi pra aba de metas.) Colunas novas em `account_bindings`
    (`tab_optimized`, `tab_optimized_date`) — **precisa rodar a migração
    `supabase/migrations/0026_otimizado_tab.sql`** no SQL Editor do Supabase.

81. **Reconhecimento/tráfego/visitas ao perfil contam no investimento, não no CPA (Etapa 84)** —
    campanhas de objetivo Reconhecimento, Alcance, Tráfego/cliques no link
    (inclui visitas ao perfil), vídeo, engajamento e curtidas de página
    (`EXCLUDED_OBJECTIVES` em `lib/meta/shared.ts`) eram ignoradas por
    completo nos totais por conta. Agora o **investimento** delas entra
    (Valor usado em Acompanhamento, Investimento até ontem em Acompanhamento
    de metas, o gasto do mês que alimenta o Ritmo, o aviso de investimento
    baixo e o "investido" dos relatórios) e o **orçamento diário** ativo
    delas entra em Invest. diário (pra não comparar um Ritmo que já conta o
    gasto delas com um orçamento que não conta). Resultado, CPA e custo por
    resultado continuam **só das demais campanhas** (o custo por resultado
    usa o gasto sem elas, `cpaSpend` em `lib/meta/insights.ts`). **Só campanha
    com [VAGA] no nome fica fora de tudo** (`isJobCampaign` em
    `lib/meta/shared.ts`). Campanha com [TRÁFEGO] ou [SEGUIDORES] no nome
    (tags que `isVaga` também pegava) agora conta no investimento e no
    orçamento diário, mas continua fora de resultado/CPA, igual aos objetivos
    acima. Não mudou: telas por campanha/conjunto/
    anúncio (Visão Geral, Análise), Evolução, Monitor de CPA e a classificação
    de status em massa, que são de CPA e seguem sem essas campanhas.

82. **Ritmo agora acelera/desacelera pra alcançar o Ideal até hoje (Etapa 85)** —
    em Acompanhamento, Acompanhamento de metas e no aviso de investimento
    baixo, o Ritmo = investimento diário normal (meta ÷ dias do mês) + a
    diferença pro Ideal até hoje, limitada a ±50% do normal (detalhes e
    exemplo no aviso "Sobre a coluna Ritmo", acima). Antes era (meta − gasto)
    ÷ dias restantes.

83. **Botão Fixar em Acompanhamento e Acompanhamento de metas (Etapa 86)** —
    coluna "Fixar" no começo de cada tabela. Conta fixada sobe pro topo; as
    demais ficam com as métricas embaçadas (passar o mouse na linha mostra os
    números) e o "↻ Atualizar" passa a buscar só as fixadas (mescla no que já
    está na tela). A busca automática (entrar na aba, trocar período) continua
    trazendo todas. Pode fixar várias; cada aba tem a sua lista (`pinnedIds` /
    `metasPinnedIds`, salvas no ui-state do Painel — sem migration) e fica até
    desafixar. Com conta fixada, o arrastar-e-soltar de Acompanhamento é
    desabilitado.

84. **Ordenação de Acompanhamento de metas replicada em Acompanhamento (Etapa
    87)** — novo seletor ao lado do período com "Ordem personalizada
    (arrastar)" (padrão, a de antes) + os mesmos 4 modos da aba de metas
    (Mais crítica / CPA elevado / Investimento fora pra cima / pra baixo).
    CPA = o da coluna CPA (período escolhido) vs CPA ideal; investimento
    fora = Invest. diário − Ritmo. Contas fixadas continuam no topo. Arrastar
    só funciona em "Ordem personalizada". Escolha salva no ui-state. Também
    corrigido o comparador de ordenação da aba de metas (empate entre contas
    sem dado não gera mais NaN).

85. **Invest. diário ignora conjunto/campanha "Concluído" (Etapa 88)** — conjunto
    com `end_time` (ou campanha com `stop_time`) já passado aparece como
    Concluído no Gerenciador mesmo com a chavinha ligada, mas o Graph API
    continua devolvendo `effective_status` ACTIVE; o orçamento dele estava
    entrando no Invest. diário (ex.: Novo Hamburgo mostrava R$ 120 em vez de
    R$ 100). Agora, em `lib/meta/insights.ts`, quem já terminou não soma.
    (Visão Geral/Análise, em `breakdown.ts`, ainda não aplicam essa regra.)

86. **Ritmo não usa mais "gasto zero" quando a busca do mês falha (Etapa 89)** —
    caso IVS Muriaé: gasto real de R$ 680,42 (Ritmo certo ≈ R$ 94), mas a tela
    mostrava R$ 145,16, que é exatamente o Ritmo com gasto 0 (teto de +50%). A
    busca de insights de uma conta falhava em silêncio (provável limite de
    requisições da Meta com muitas contas em paralelo) e virava spend 0.
    Agora: `AccountInsight.insights_failed`; `getAccountsInsights` tenta de
    novo as contas que falharam (2 rodadas, pausa de 1,5 s); `ritmoFromInsight`
    devolve null (— na tela) sem dado; Acompanhamento e Acompanhamento de metas
    mostram um aviso vermelho com quantas contas não carregaram; o aviso de
    investimento baixo (WhatsApp) ignora conta sem dado em vez de disparar alerta falso.

87. **Menos requisições à Meta + transparência do Ritmo (Etapa 90)** — (a) o ↻ com
    conta fixada atualiza SÓ as fixadas, inclusive sem refazer o status de
    saldo/pagamento (que consultava todas as contas); (b) a busca automática ao
    entrar na aba só repete se mudou período/contas ou passou de 5 min (antes
    refazia tudo a cada volta de aba; metas-tab usa cache de módulo); (c) no
    Acompanhamento, o gasto do mês (Ritmo) é pedido em modo `spendOnly` (só
    `campaign_id,campaign_name,spend`, sem as 3 chamadas de orçamento — que não
    mudam com o período) e repete 1x se a Meta devolver lista vazia; (d) no
    máximo 5 contas em paralelo (antes todas, ≈100 chamadas de uma vez),
    `maxDuration = 60` na rota; (e) falha de busca guarda o motivo
    (`insights_error`) e o aviso vermelho mostra o texto da Meta; (f) a coluna
    Ritmo ganhou dica (passar o mouse) com mensal ÷ dias, ideal até hoje, gasto
    até ontem, diferença e ajuste usados na conta.

88. **Ritmo passa a contar o gasto de hoje + faixa "dentro da meta" (Etapa 91)** —
    achado olhando o painel real: IVS Muriaé gastou R$ 156 só hoje (Valor usado
    R$ 680 em "Mês atual"), mas o Ritmo comparava só o gasto até ONTEM (R$ 524)
    com o ideal que já inclui hoje (R$ 581) → "atrasada" → Ritmo no teto (R$ 145).
    Agora o gasto é do dia 01 até AGORA (preset `this_month`, só `spend`), e se
    ele estiver entre 80% e 120% do Ideal até hoje, o Ritmo é o normal (mensal ÷
    dias do mês; Muriaé = R$ 96,77); fora da faixa acelera/desacelera pela
    diferença, limitada a ±50% do normal (igual antes). Vale em Acompanhamento,
    Acompanhamento de metas (busca extra só-gasto; o resto da aba segue "até
    ontem") e no aviso de investimento baixo. A dica da coluna Ritmo mostra a conta.

89. **Acompanhamento de metas: "Investimento atual" no lugar de "até ontem" (Etapa 92)** —
    a coluna "Investimento até ontem" não fazia sentido ao lado do "Ideal até hoje"
    (que conta hoje). Agora a coluna se chama "Investimento atual" e mostra o gasto
    do dia 01 até AGORA (preset `this_month`, com hoje); a diferença, a cor, a barra
    de % e a ordenação "Mais crítica" usam esse mesmo valor. A aba passa a fazer uma
    busca só (antes eram duas): o CPA atual também passa a ser do mês até agora, e o
    Ritmo usa o mesmo gasto. Também saem desta aba as colunas Fixar e Otimizado, o
    filtro de Otimizado e o modo foco (↻ só das fixadas): Acompanhamento de metas
    fica só pra análise; Fixar e Otimizado continuam apenas em Acompanhamento.
    (A migration 0026 e o campo `tab_optimized` ficaram sem uso — são inofensivos.)

90. **CPA atual de Acompanhamento de metas: atenção até R$ 2,50 (Etapa 93)** — nessa
    aba, o CPA fica verde quando está no ideal ou abaixo, amarelo (atenção) até
    R$ 2,50 acima do CPA ideal, e vermelho acima disso (antes o corte era R$ 1,40).
    Etapa 94: Acompanhamento passou a usar o mesmo corte de R$ 2,50 (constante única
    `CPA_ACCEPTABLE_BAND`). Os avisos automáticos de CPA no WhatsApp seguem com a
    regra própria deles (acima de R$ 2,00).

91. **Aviso de saldo baixo usa o Saldo por fundos quando ligado (Etapa 95)** — IVS
    Teresina 2 (Híbrida) aparecia em Pendências com "Saldo baixo (R$ 50,08 < R$
    250,00)" mesmo com R$ 1.002,43 de fundos. A coluna Saldo já mostrava os fundos,
    mas o aviso (Pendências, WhatsApp e alerta de sexta) usava o `balance` bruto da
    Meta (valor a pagar). Agora, em conta com "Saldo por fundos" ligado, os avisos
    comparam o limite com esse saldo; sem fundos ligados, nada muda.

92. **Pix e boleto enviados resolvem o aviso + aviso no WhatsApp + boleto só com contas
    Tipo Boleto (Etapa 96)** — (a) ao enviar um Pix (imediato) ou um boleto, o app
    manda uma mensagem no grupo de avisos ("📲 Pix enviado — Cliente" / "📄 Boleto
    enviado ao financeiro — Cliente (vencimento …)"); se a mensagem falhar, o envio
    em si continua valendo e a tela mostra o motivo. (b) Por 30 minutos depois do envio, a
    conta some de Pendências (Saldo baixo e alerta de sexta, pra Pix ou boleto; Erro
    no pagamento, só pra boleto) e o WhatsApp automático não reavisa; passou disso e
    o problema persiste, o aviso volta. Pix agendado só conta quando é de fato
    enviado. Em Mensagens > Avisos a linha mostra "Enviado (30 min)". (c) O formulário
    "Enviar boleto por e-mail" lista só contas com Tipo = Boleto. Helper novo:
    `lib/alerts/recent-sends.ts`. Sem migration.

93. **Aviso volta 30 min depois do envio (Etapa 97)** — a janela em que o Pix/boleto
    enviado esconde o aviso da conta passou de 24h pra 30 minutos.

94. **Ordenação "Prioridade + maior diferença do CPA" em Acompanhamento (Etapa 98)** —
    nova opção no seletor de ordem: agrupa por Prioridade (Inauguração, Crítica,
    Alta, Média, Baixa, sem prioridade) e, dentro de cada grupo, ordena pela mesma
    diferença que aparece embaixo da coluna CPA (CPA do período − CPA ideal), da
    maior pra menor; sem CPA ou sem CPA ideal vai pro fim do grupo. Ao terminar o
    "Atualizar status em massa", a tela passa sozinha pra essa ordenação (antes só
    ficava a ordem por status, e a diferença usada dentro do grupo era a dos
    últimos 3 dias, que não batia com a mostrada na tela). O filtro de Prioridade
    continua sendo o seletor "Status" da linha de filtros.

95. **Pausa automática de Conjuntos com histórico de 7 dias + quarentena (Etapa 99)** —
    ⚠️ rodar `supabase/migrations/0027_adset_quarantine.sql` no Supabase antes do
    deploy (sem a tabela a verificação para com uma mensagem avisando, de propósito,
    pra não cortar orçamento sem ter onde registrar a quarentena). Nova regra, no
    mesmo gatilho de sempre (conjunto ativo com CPA dos últimos 3 dias + hoje no
    dobro da Meta CPA + R$1): (a) se o CPA dos últimos 7 dias do conjunto está
    ABAIXO do ideal — a "linha verde" de Análise — ele NÃO é pausado: o orçamento
    diário cai R$10 (no conjunto, ABO, ou na campanha, CBO; piso de R$6, nunca
    abaixo) e ele entra em quarentena de 24h; (b) em quarentena é ignorado (não
    pausa, não corta de novo; numa campanha CBO, outro conjunto da mesma campanha
    também não corta o orçamento dela de novo dentro das 24h); (c) passadas as 24h,
    se nos 3 dias o CPA continua acima do ideal e nos 7 dias ainda abaixo → corta
    mais R$10 e volta pra quarentena; (d) passadas as 24h, acima do ideal nos 3 e nos
    7 dias → pausa; (e) passadas as 24h e o CPA de 3 dias voltou pra dentro do
    ideal → sai da quarentena sem fazer nada. Conjunto sem CPA de 7 dias (sem
    conversa) ou com CPA de 7 dias igual/acima do ideal é pausado como antes.
    Conjunto ativo sem nenhum anúncio ativo continua sendo pausado direto, mesmo em
    quarentena. Orçamento vitalício ou sem orçamento diário: não corta, mas entra em
    quarentena de 24h (pra não repetir o aviso). A lógica de Criativos não mudou. O
    aviso do WhatsApp ganhou a seção "📉 Orçamento reduzido em R$10" (e ⚠️ quando não
    deu pra cortar), e a tela Mensagens > Avisos lista os cortes junto das pausas.
    Arquivos novos: `lib/alerts/adset-decision.ts` (regras puras),
    `lib/alerts/adset-quarantine.ts`; `lib/meta/budget.ts` ganhou o corte.

96. **Atualizar status em massa: janela dos 3 dias corrigida (Etapa 100)** — a conta que o
    servidor fazia dos "últimos 3 dias" (lib/meta/daily-cpa.ts) usava horário local e,
    no servidor (UTC), recuava 1 dia: ontem ficava FORA da soma e entrava um dia
    a mais lá de trás (ex.: em 12/10 somava 08, 09 e 10 em vez de 09, 10 e 11). Por
    isso o status em massa divergia do CPA da tela (que é calculado pela Meta). Agora
    as datas são calculadas só no calendário (YYYY-MM-DD), igual em qualquer
    servidor. Vale também pra atualização automática e pra aba Evolução.

97. **Ritmo = o que falta pro ideal (2× no máximo, 50% no mínimo) + cores com tolerância de 2% (Etapas 101/102)** —
    Ritmo = Ideal até hoje − Investido atual, limitado a no mínimo 50% e no máximo 2× o
    investimento diário normal (Investimento mensal ÷ dias do mês). Ex.: normal 100, ideal
    1.200, investido 1.050 → 150; ideal 1.200/1.300/1.400 e investido 950/1.150/1.300 →
    200/150/100; já 100 acima do ideal (normal 96,77) → 48,39 até regularizar. Embaixo do
    Ritmo, em Acompanhamento de metas, aparece "acelerar · N dias" (quantos dias seguidos o
    Ritmo fica acima do normal até igualar). Cor do Investimento atual / barra: tolerância de
    2 pontos da META MENSAL pros dois lados — mais de 2 pontos atrás = laranja; mais de 2
    pontos acima do ideal = vermelho; senão verde. Ex.: ideal 38%, investido 33% → laranja;
    41% → vermelho. Vale também pra coluna Ritmo de Acompanhamento e pro aviso de
    investimento baixo. Código: `ritmoParts()`, `ritmoAcceleratedDays()` e
    `INVEST_TOLERANCE` em `lib/meta/ritmo.ts`.
    Etapa 103: depois das 16h (Brasília) o Ritmo ANTECIPA o dia seguinte — mira o ideal de
    amanhã (normal × (dia + 1)) em vez do de hoje, já que a otimização é feita à noite. Ex.:
    meta 3.000, dia 12, 20h, investido 1.000 → falta 258 pro ideal de amanhã → Ritmo 193,55
    (2×). Depois da meia-noite volta ao cálculo normal do novo dia. A coluna "Ideal até hoje"
    e as cores do Investimento seguem sempre o ideal de hoje. Código: `hourSP()` e
    `RITMO_ANTICIPATE_HOUR` em `lib/meta/ritmo.ts`.

98. **Pausa automática mais agressiva + verificação de 3 em 3 horas (Etapa 104)** —
    (a) Criativos: o período passou a ser ONTEM + HOJE (antes, últimos 3 dias + hoje). Criativo
    ativo com custo por conversa (ou gasto, sem conversa) R$4+ acima da Meta CPA nesse período é
    pausado. Se tem histórico bom nos 7 dias (CPA de 7 dias abaixo do ideal, a linha verde de
    Análise), só pausa se TAMBÉM estiver R$4+ acima nos últimos dois dias + hoje (anteontem,
    ontem e hoje juntos); se a busca dos 7 dias ou dos 2 dias + hoje falhar, pula (não decide no
    escuro). O aviso do WhatsApp marca esses casos com "7 dias bom, mas acima nos 2 dias + hoje".
    Regras puras em `lib/alerts/creative-decision.ts`. (b) Conjuntos: continua pausando conjunto
    ativo SEM anúncio ativo, mas agora NÃO pausa se ele tem anúncio em análise, processando,
    pré-aprovado, com problemas ou aguardando cobrança (campo `has_pending_ad` em
    `adset-cost-analysis.ts`; se a busca desses anúncios falhar, na dúvida não pausa). (c)
    Agenda no n8n (horário de Brasília, todos com `POST` + header `x-webhook-secret`): Criativos
    (`/api/public/hooks/creatives-pause-tick`) às 02h, 05h, 08h, 11h, 14h, 17h, 20h e 23h (`0
    2,5,8,11,14,17,20,23 * * *`); Conjuntos (`adsets-pause-tick`) 5 minutos depois (`5
    2,5,8,11,14,17,20,23 * * *`). Etapa 105: URL NOVA `/api/public/hooks/creatives-no-result-tick`,
    de hora em hora (`30 * * * *`), que pausa só os criativos SEM RESULTADO (zero conversas,
    gasto R$4+ acima da meta ontem + hoje) — o criativo ruim, com conversa mas caro, ainda pode
    reverter e continua só na verificação de 3 em 3 horas (que também pega os sem resultado).

99. **Aviso de Invest. diário em 80% ou menos do Ritmo (Etapa 106)** — novo aviso no WhatsApp
    (só notifica, não muda nada): conta com Investimento mensal cadastrado cujo Invest. diário
    atual (orçamento diário dos anúncios ativos) é igual ou menor que METADE do Ritmo. Mesmo
    Ritmo da tela (depois das 16h já antecipa o dia seguinte). Universo: Contas exibidas. Conta
    cuja busca na Meta falhou não entra. Mensagem: "🔴 Invest. diário em 80% ou menos do Ritmo"
    com cliente, Invest. diário, Ritmo e % do Ritmo (mais grave primeiro). Sem cooldown: reenvia
    a cada rodada enquanto durar. Agenda no n8n: `POST /api/public/hooks/low-budget-tick`
    (header `x-webhook-secret`), de 3 em 3 horas (`0 2,5,8,11,14,17,20,23 * * *`). Código:
    `lib/alerts/low-budget.ts`. O aviso de Investimento baixo (banda de R$10) continua como estava.
    Workflow único com as 10 agendas (as 6 abaixo + Auditoria a cada 30 min, Saldo e pagamento seg-sáb 07h15/10h15/14h15/18h15, Saldo por fundos de 2 em 2h e CPA ontem às 07h; Criativos acima da meta 3h, Conjuntos 3h, Criativos sem resultado
    de hora em hora, Invest. diário em 80% do Ritmo 3h, Investimento baixo seg-sex 07h/09h15/13h e
    Status em massa seg/qui 01h): `n8n-workflows/pausas-e-avisos-automaticos.json` (Import from File;
    troque `SEU_DOMINIO` e `COLOQUE_AQUI_O_WHATSAPP_DISPATCH_SECRET` nos 10 nós HTTP Request; o segredo
    real não deve ser commitado). Cada gatilho já está ligado ao seu nó HTTP, com timeout de 120s e 2
    tentativas. Desative workflows antigos para não disparar em duplicidade.
100. **Aba Alertas + só o urgente no grupo (Etapa 112)** — toda notificação das verificações
    automáticas agora é gravada na tabela `alert_notifications` e aparece na nova aba **Alertas**
    do Painel (bolinha vermelha com a quantidade ao lado do nome; filtros Todos / Urgentes / Só aqui;
    botão OK por alerta e "OK em todos"). No grupo do WhatsApp vão só 5 tipos: CPA acima da meta
    ontem, Invest. diário em 80% ou menos do Ritmo, Saldo baixo, Saldo de sexta e Erro no pagamento.
    Todo o resto (criativos/conjuntos pausados, orçamento reduzido, Investimento baixo, Status em
    massa, Verificação manual) fica só na aba. Cada alerta é apagado sozinho 72h depois
    (`expires_at`) ou ao clicar em OK. Os avisos que repetem a cada rodada (Invest. diário em 50% do
    Ritmo e Investimento baixo) não empilham: a linha aberta do tipo é atualizada. Pra mudar o que vai
    pro grupo, edite só `GROUP_KINDS` em `lib/alerts/notifications.ts` (todas as verificações passam
    por `publishAlert`). Os avisos de Pix/boleto enviados (`notifyAlertsGroup`) NÃO mudaram: seguem
    pro grupo como confirmação da ação. ⚠️ rodar `supabase/migrations/0028_alert_notifications.sql`
    no Supabase antes do deploy (sem a tabela, os avisos que vão só pra aba retornam erro no hook).
    Código: `lib/alerts/notifications.ts`, `app/api/alerts/notifications/route.ts`,
    `components/painel/alertas-tab.tsx`.
101. **Pix/boleto sem aviso no grupo + Status em massa direto no Asana (Etapa 113)** — o envio de
    Pix e de boleto não manda mais mensagem pro grupo de avisos (a função `notifyAlertsGroup` foi
    removida). O status em massa (automático, seg/qui 01h, e o botão "Atualizar status em massa"
    da tela) agora também grava a Prioridade direto no Asana: projeto ESTRATEGISTA SPEED DIGITAL,
    seção "Anderson - (Denner)", uma tarefa por cliente (`lib/asana/priority-sync.ts`). Mapeamento:
    Baixa → Baixa, Média → Médio, Alta → Alta, Crítica → Alta - Crítica; Inauguração não é enviada.
    O nome do cliente é comparado sem maiúsculas, acentos nem espaços sobrando; sem tarefa
    correspondente ou com mais de uma parecida, não mexe e avisa (alerta "Status em massa" na aba
    Alertas e mensagem no diálogo). Só troca o campo Prioridade e só quando o valor é diferente.
    ⚠️ Precisa da variável `ASANA_ACCESS_TOKEN` (Personal Access Token do Asana) na Vercel; sem ela
    a sincronização fica desligada e o alerta só avisa "Asana: não configurado". Nunca commitar o token.
102. **Aviso de Invest. diário sobe de 50% para 80% do Ritmo (Etapa 114)** — `LOW_BUDGET_RATIO`
    em `lib/alerts/low-budget.ts` passou de 0,5 para 0,8: agora entra no aviso (aba Alertas + grupo)
    toda conta com Invest. diário igual ou abaixo de 80% do Ritmo. Mensagem: "🔴 Invest. diário em
    80% ou menos do Ritmo". Agenda do n8n inalterada (a regra mora no app, não precisa reimportar).
103. **Aba Descrição — descrição dos clientes espelhada do Asana (Etapa 115)** — nova aba do Painel com
    um quadro: Cliente | Descrição (Asana) | Ofertas ativas (em breve, virá da Meta). **Asana → Traffic:**
    automático a cada 30 min em horário comercial (seg-sex, 08h-18h, minutos 17 e 47, hook
    `POST /api/public/hooks/asana-descriptions-tick`) ou pelo botão "Atualizar do Asana": descrição igual =
    não faz nada; divergente = o Traffic passa a ter a do Asana. **Traffic → Asana:** só pelo botão
    "Enviar ao Asana" de cada cliente, que SUBSTITUI a descrição (não acrescenta). O texto editado fica
    como rascunho (`draft`, salvo ao sair da caixa) e a sincronização nunca sobrescreve um rascunho não
    enviado. Antes de enviar, confere o Asana agora: se a descrição mudou lá desde a última sincronização,
    ou se tem formatação (negrito/lista/link, que o texto simples perde), pede confirmação. A ligação
    cliente ↔ tarefa usa a mesma regra tolerante de nomes da prioridade (sem acento/pontuação); cliente
    sem tarefa ou com mais de uma parecida aparece avisado na linha. ⚠️ rodar
    `supabase/migrations/0029_client_descriptions.sql` no Supabase e ter `ASANA_ACCESS_TOKEN` na Vercel;
    adicionar o fluxo "Descrições do Asana" ao workflow do n8n (já no
    `n8n-workflows/pausas-e-avisos-automaticos.json`, agora com 11 agendas). Código:
    `lib/asana/descriptions.ts`, `app/api/asana/descriptions/route.ts`, `components/painel/descricao-tab.tsx`.
104. **Otimizado reseta na virada do dia mesmo com o Painel aberto (Etapa 116)** — o servidor já devolvia
    "não otimizado" pra marcação de ontem, mas o Painel só lia as marcações UMA vez ao abrir; quem deixava a
    tela aberta de um dia pro outro continuava vendo o dia anterior até apertar F5. Agora a tela confere o dia
    de Brasília a cada minuto e ao voltar pra aba (focus/visibilitychange) e, se virou, relê as marcações
    (vale pro Otimizado de Acompanhamento e de Acompanhamento de metas).

105. **Ritmo = investimento normal + o que falta (Etapa 117)** — o Ritmo agora soma o investimento diário
    normal ao que está faltando pra chegar no ideal, sem o teto de 2× e sem a regra das 16h. Ex.: Itatiba,
    meta 3.000 (normal 96,77), dia 13, investido 1.084,04 (ideal 1.258,06 → faltam 174,02) → Ritmo 270,79.
    Na prática é o que falta pro ideal de AMANHÃ, em qualquer hora; no último dia mira a meta mensal. O piso de 50%
    do normal continua pra quem está adiantado. "Acelerar" passa a mostrar 1 dia. Mais contas vão cair no aviso
    de Invest. diário em 80% do Ritmo e no Investimento baixo.

106. **Menos requisições juntas na Meta (Etapa 118)** — ao abrir o Acompanhamento o Painel disparava 4 buscas
    pesadas ao mesmo tempo (insights do período, gasto do mês, saldo e pagamento ≈ 15 chamadas simultâneas) e
    estourava o limite da Meta (tela travando/erro). Agora elas rodam em fila, uma de cada vez. Além disso, o
    limite de requisições da Meta (HTTP 400, códigos 4/17/32/613/80004) agora espera e tenta de novo em
    metaGet e metaGetAll (antes falhava na hora). Se a busca de saldo/pagamento falhar, as cores já na tela
    são mantidas.

107. **Menu lateral fixo + indicador de carregando/erro (Etapa 119)** — antes, enquanto as contas da Meta
    carregavam (ou davam erro), o Painel inteiro virava "Carregando…" e o menu sumia — não dava nem pra abrir
    Clientes. Agora o menu fica sempre na tela e acompanha a rolagem; só a área de conteúdo mostra
    "Carregando contas…" ou o erro (com "Tentar de novo"). Embaixo do menu há um quadro de estado:
    amarelo = carregando (com quantas buscas na fila), vermelho = erro (diz onde: contas, insights, gasto do
    mês, saldo e pagamento), verde = tudo carregado. As buscas à Meta ganharam limite de 90s pra não prender a
    fila, e a aba Alertas abre mesmo sem as contas carregadas.

108. **Botão "Enviar boleto" da linha abre o PDF e avisa o que falta (Etapa 120)** — o botão da linha só
    selecionava o cliente no formulário de cima e parecia não fazer nada (o "Enviar e-mail" fica apagado até
    ter cliente + PDF + vencimento). Agora ele seleciona o cliente, rola até o formulário, já abre a escolha do
    PDF e mostra um aviso; ao lado do "Enviar e-mail" aparece o que ainda falta.

109. **Nome do cliente só leitura em Acompanhamento + balão (Etapa 121)** — o nome deixou de ser um campo
    editável na aba Acompanhamento (a edição fica só em Clientes). Ao passar o mouse sobre o nome abre um balão
    discreto com o WhatsApp e o Investimento mensal cadastrados ("não cadastrado" quando vazio).

110. **Pausa de conjuntos mais segura + corte só com CPA R$4+ acima (Etapa 122)** — (a) "Conjunto sem anúncio
    ativo" agora confere DIRETO os anúncios do conjunto na Meta (lib/meta/adset-ads-check.ts) e só pausa se não
    tem NENHUM anúncio vivo: qualquer status que não seja pausado/arquivado/excluído (em análise, processando,
    pré-aprovado, com problemas, reprovado, cobrança…) protege; anúncio ativo achado corrige o falso "sem ativo";
    falha na Meta = não pausa; conjunto criado há menos de 3h e sem anúncio também não pausa. (b) A Auditoria
    (30 min) deixou de pausar conjunto por anúncio em análise/erro — isso vira só aviso; só pausa "sem anúncio
    ativo" já conferido. (c) Desempenho: só corta R$10/pausa com RESULTADO e CPA dos últimos 3 dias + hoje R$4 ou
    mais acima do ideal (ADSET_CUT_EXTRA); sem resultado ou abaixo disso não mexe em nada. 7 dias abaixo do ideal
    → corta + quarentena; senão pausa (1ª vez só se passou de 2x + R$1).

111. **Limite de requisições do app na Meta (Etapa 123)** — erro "Application request limit reached" (código 4 /
    subcódigo 1504022): é o limite por hora do app inteiro (Painel + todas as automações do n8n usam o mesmo
    token) e libera sozinho. Agora, nesse erro, o app NÃO insiste (as tentativas em segundos só gastavam mais
    chamadas): falha na hora com mensagem clara e um "disjuntor" de 5 min faz as próximas buscas nem chegarem na
    Meta (lib/meta/client.ts, MetaRateLimitError). O Painel guarda no navegador a última lista de contas e, se a
    Meta bloquear, abre com ela (aviso amarelo + "Tentar de novo") em vez de ficar sem contas.

112. **Menos requisições à Meta + horários de pico livres (Etapa 124)** — pedido: o sistema é mais usado das 08h às
    11h e das 14h às 16h e não pode falhar aí. (a) n8n: Criativos e Conjuntos viraram UM fluxo encadeado (pausa os
    criativos e logo depois os conjuntos) às 01h10/04h10/07h10/11h10/13h40/16h10/19h10/22h10; saíram "Investimento
    baixo" e "Criativos sem resultado" de hora em hora (as rotas continuam existindo, só sem agendamento); Invest.
    diário em 80% do Ritmo só às 07h e 16h; CPA de ontem às 06h; a auditoria não roda às 08h/10h/14h (nos picos só
    09h50 e 15h50). (b) Servidor: lib/meta/memo.ts guarda por poucos minutos a lista de contas, o status dos
    anúncios e as campanhas (junta chamadas iguais simultâneas e, se a Meta falhar, devolve a última resposta boa);
    qualquer escrita na Meta limpa essa memória. (c) Painel: cada aba tem backup no navegador (lib/client-cache.ts,
    localStorage): ao entrar mostra o salvo + "atualizado às HH:MM" e só busca na Meta se não há nada recente (1h; na
    Análise, 15 min e apagado depois de qualquer ação); o "↻ Atualizar" de cada aba busca só dela. Acompanhamento
    não busca mais sozinho a cada 5 min. Falhou a busca? O salvo continua na tela.

113. **Backup diário das métricas no Supabase — 37 dias (Etapa 125)** — rode `supabase/migrations/0030_meta_daily_metrics.sql`
    (tabela meta_daily_metrics: uma linha por conta e dia com gasto, gasto das campanhas de CPA, resultados e tipos).
    O hook `metrics-sync-tick` (n8n, 03h00 e 03h25) refaz os últimos 37 dias de cada conta — refazer tudo pega as
    conversas atribuídas depois — e apaga o que passou de 37 dias (janela móvel: é o "reset" da virada do mês, e no
    dia 1º ainda existe o mês anterior inteiro pra olhar os últimos 7 dias). Quem lê (lib/meta/daily-store.ts):
    getAccountInsight (Ritmo, Acompanhamento, Metas, Monitor de CPA, avisos de CPA e Invest. diário) e o CPA diário
    + mensal da Evolução usam os dias fechados do backup e perguntam à Meta só o dia de hoje (ou o que faltar:
    conta nova, buraco no backup, período mais velho que a janela, "maximum" → busca de sempre na Meta, sem erro).
    Regras de período em lib/meta/daily-range.ts (testadas). Não cobre as análises por conjunto/anúncio
    (Análise, pausas automáticas): essas continuam ao vivo.

114. **Balão do nome do cliente não cortado + espaço no fim da página (Etapa 126)** — nas últimas linhas do
    Acompanhamento o balão (WhatsApp / Investimento mensal) ficava escondido atrás da borda de baixo da tela. Agora
    ele abre PARA CIMA do nome quando falta espaço embaixo (e é puxado pra dentro da tela se estiver na borda direita),
    e o Painel ganhou um respiro no final da página (components/painel/client-name-hover.tsx).

115. **Análise > Criativos: filtro e data do conjunto (Etapa 127)** — botões de filtro "Todos (padrão, fixo) / Sem resultado /
    Acima de R$10 / Acima de R$15" com contador em cada um; trabalham só em cima da lista que já está na tela (nenhuma
    busca nova na Meta). "Acima de R$X" = a coluna DIFERENÇA (CPA do criativo menos a Meta CPA da conta) maior que X;
    "Sem resultado" = nenhuma conversa iniciada. Colunas agora: caixinha | Data | Conjunto | Criativo | Gasto | CPA | Conversas | Diferença. "Data" =
    quando o CONJUNTO foi criado (vem na mesma consulta da lista de anúncios, sem chamada extra). Saiu o botão
    "Pausar criativo" individual de cada linha (continuam "Pausar todos os listados" e "Pausar selecionados" — que
    respeitam o filtro escolhido). Criativos ganhou também o filtro "Até R$ 10,00" (Diferença de até R$10).
116. **Análise > Conjuntos: filtro, data e colunas novas (Etapa 128)** — só na aba "acima da meta". Colunas agora:
    caixinha | Data | Conjunto | Gasto | CPA | Conversas | Diferença (a coluna "Pausar conjunto" de cada linha saiu;
    duplo clique continua abrindo os criativos, que mantêm o botão de pausar). "Data" = quando o conjunto foi criado
    (já vinha na consulta de status dos conjuntos, sem chamada extra). Botões de filtro, com contador, que
    trabalham só no que já está na tela: "Todos (padrão, fixo) / Sem anúncio ativo / Até R$ 10,00 / Até R$ 15,00 /
    Até R$ 20,00 / Acima de R$ 20,00". "Até R$ X" = a coluna DIFERENÇA (CPA do conjunto menos a Meta CPA) de até X
    (inclui os mais baixos); "Acima de R$ 20,00" = Diferença maior que 20. "Sem anúncio ativo" substituiu o
    checkbox "Só sem anúncio ativo" e continua salvo junto com as outras escolhas da tela. "Pausar todos os listados" e
    "Pausar selecionados" respeitam o filtro. A aba "abaixo da meta" não mudou. Cache da tela renomeado
    (`analise-adsets-v2:`) pra não misturar com dados antigos sem a data.
117. **Ritmo = o que falta ÷ dias que faltam (Etapa 129)** — `lib/meta/ritmo.ts`. Ritmo = (Investimento mensal − gasto do
    dia 01 até agora, com hoje) ÷ (dias do mês − dia de hoje). Ex.: Chapecó, meta 5.000, gasto 2.525,36 no dia 15 de 31 →
    faltam 2.474,64 em 16 dias → R$ 154,67 por dia (antes mostrava R$ 80,65: a regra da Etapa 117 — normal + o que falta pra
    alcançar o ideal de amanhã, com piso de 50% do normal — considerava a conta "adiantada" e parava no piso). Sem piso e sem
    teto; nunca negativo (meta já batida = R$ 0); no último dia do mês = o que falta pra meta. "Ideal até hoje" (normal × dia) e
    as cores do Investimento seguem iguais. A mesma conta alimenta a coluna Ritmo de Acompanhamento e de Metas, o filtro
    Investimento Baixo/Alto, o aviso de Investimento baixo e o alerta "Invest. diário ≤ 80% do Ritmo" — que passam a disparar
    com base no novo valor (contas adiantadas, mas ainda longe da meta, passam a ter Ritmo maior que antes).

118. **Balão do cliente: Invest. diário médio + conferência do Invest. diário (Etapa 130)** — o balão do nome do cliente em
    Acompanhamento ganhou "Invest. diário médio" = Investimento mensal ÷ dias reais do mês (ex.: R$ 4.000 em outubro =
    R$ 129,03). Também: o cálculo do Invest. diário (`lib/meta/insights.ts` e `breakdown.ts`) passou a tratar orçamento
    "0" como SEM orçamento (`Number(x) > 0`) — a Meta pode devolver "0" em campanha sem CBO e, como texto "0" é
    verdadeiro no JS, a campanha era lida como CBO de R$ 0 e os conjuntos dela sumiam da soma (caso IVS Muriaé: o painel
    mostrava R$ 70 e na Meta são R$ 100, 30 da campanha GERAL criada em 14/10).

119. **Cliente ativo/desativado (Etapa 131)** — em Clientes > ⚙ (configurações do cliente) tem a chavinha "Cliente ativo"
    (padrão: ativo, todo cliente existente continua ativo). Desativado = fica só o histórico das configurações (a linha
    continua na aba Clientes, apagada e com a etiqueta "Desativado", pra poder reativar) e a conta SOME de: Acompanhamento,
    Metas, Evolução, Monitor de CPA, Controle de Saldo, Visão Geral, Análise, Demandas, Descrição, Copy, Relatórios
    (agendados e manuais) e de todas as automações/alertas (CPA, status em massa, pausas de criativos e conjuntos, investimento
    baixo, invest. diário ≤ 80% do Ritmo, saldo e saldo por fundos, erro de pagamento, verificação manual, auditoria,
    descrições do Asana, Monitor de CPA em cache e backup das métricas) — nenhuma consulta à Meta é feita pra ela.
    Como funciona: coluna `account_bindings.active boolean not null default true` (SQL `supabase/migrations/0031_client_active.sql`);
    `lib/accounts/inactive.ts` (`inactiveAccountIds`) devolve as contas desativadas e é aplicado em cada automação/rota (se a
    coluna ainda não existir, devolve vazio e tudo segue como antes). Na tela, o Painel só usa as contas ativas
    (`selectedAccounts`); só a aba Clientes enxerga todas (`selectedAccountsAll`). Os dados e configurações da conta ficam
    guardados (nada é apagado); reativar volta tudo na hora. Dá pra usar pra uma pausa curta (ex.: 1 dia): desativa e reativa.

120. **Atalho pro Gerenciador com filtro e período (Etapa 132)** — todo link do nome da conta (`adsManagerUrl` em
    `lib/meta/ads-manager-link.ts`) agora abre o Gerenciador de Anúncios já com (1) o filtro "nome da campanha NÃO contém
    'vaga'" e (2) o MESMO período do Painel (Acompanhamento, Análise e Visão Geral seguem o filtro de período da tela;
    Metas = mês atual; Monitor de CPA = o período escolhido nele). Períodos que existem igual no Gerenciador (Hoje, Ontem,
    Últimos 3 dias, Últimos 7 dias, Mês atual) vão com o nome; os outros ("Últimos 3 dias + hoje", "Ontem e hoje", "Este
    mês, até ontem") vão só com as datas (fuso de Brasília). Onde não há período na tela (Clientes, Evolução) abre em "Ontem".
    Ajuste (132b): o link agora também leva o `business_id` (Business Manager dono da conta, vindo da lista de contas do
    Meta que o Painel já carrega — `registerAccountBusinesses`), igual ao link que o próprio Gerenciador gera. Sem ele o
    Gerenciador redireciona pra descobrir o negócio, e nesse redirecionamento o filtro "vaga" podia se perder.
    Ajuste (132c): no `date=` do Gerenciador o dia final é EXCLUSIVO (Ontem = 16 → `16_17`), então os períodos que
    acabam hoje ("Ontem e hoje", "3 dias + hoje") abriam sem o dia de hoje; agora soma 1 dia no fim, e "Ontem e hoje" vai
    com o nome `last_2_days` (o nome que o Gerenciador usa pra ele).

121. **Pausa de criativo NOVO espera quando "hoje" já está bom, com teto de 3x (Etapas 133/134)** — caso real
    (Guaratinguetá, Meta CPA R$4): criativo novo, ontem sem lead e hoje com CPL R$2,98, mas no acumulado "ontem + hoje"
    ficou acima de Meta CPA + R$4 e foi pausado de manhã (e o conjunto, sem anúncio ativo, 20 min depois). Agora, antes de
    pausar (`creatives-pause-tick`, `creatives-no-result-tick` e disparo manual), a automação segura a pausa nessa rodada
    quando TODAS as condições valem (`holdBecauseTodayIsGood` em `lib/alerts/creative-decision.ts`): (1) o anúncio foi
    criado há MENOS DE 48h (data de criação do próprio anúncio, `created_time`; sem data = não segura); (2) o custo por
    conversa do acumulado ontem + hoje NÃO passou de 3x a Meta CPA (acima disso pausa mesmo assim, ex.: Meta R$4 → teto
    R$12); (3) hoje (só hoje) já tem pelo menos 1 conversa e o custo por conversa de hoje está igual ou abaixo da Meta CPA.
    A rodada seguinte reavalia tudo. Criativo com 48h ou mais não tem essa espera. Se a busca de hoje na Meta falhar, a
    conta é pulada (não decide no escuro). Não muda a tela de Análise nem a regra de Conjuntos.

122. **Alertas com filtros, sem selo vermelho; CRM escondido (Etapa 135)** — a aba Alertas ganhou filtro por conta e por janela de
    tempo (De/até + atalhos Última hora/24h/Hoje/Ontem) e o contador vermelho do menu saiu. O item CRM saiu do menu lateral
    (as telas e rotas continuam no código, só não aparecem). Novos tipos de aviso: `morning-summary`, `no-delivery`,
    `budget-increase`, `naming-fix` (os dois primeiros vão também pro grupo do WhatsApp).

123. **Freio de segurança da pausa automática (Etapa 136)** — `lib/alerts/pause-brake.ts`. Por conta (e por conjunto, no caso de
    criativos), a automação só pausa até 70% dos itens ativos (ex.: 6 conjuntos, 3 pra pausar → pausa; 6 de 6 → pausa 4 e mantém
    os 2 menos piores). Sempre pausam direto, sem contar no freio: conjunto sem anúncio ativo e criativo que gastou 3x a meta.
    O que foi mantido aparece no aviso ("Freio de segurança").

124. **Resumo das 7h — "Contas que precisam de atenção" (Etapa 137)** — `lib/alerts/priority-score.ts` + `morning-summary.ts`, hook
    `morning-summary-tick`, prévia/envio manual em `/api/alerts/morning-summary` (GET = só mostra, POST = envia). Pontos: status
    Crítico 3 / Alta 2 / Média 1; CPA crítico ontem 2; crítico ontem e anteontem 3; Invest. diário ÷ Ritmo 70–80% = 1, 60–70% = 2,
    50–60% = 3, abaixo de 50% = 4; saldo acabando 1; saldo acabou ou erro de pagamento 5; +1 se o CPL de ontem caiu num nível pior
    que o status da conta (igual ou melhor = 0). Entram só contas com 2 pontos ou mais (`MIN_POINTS`), até 10, em ordem; a mensagem
    mostra o nome e "Motivo: …" (sem pontos, sem reprovados/nomes fora do padrão).

125. **Alerta "conta sem anúncio ativo / sem entrega" (Etapa 138)** — `lib/alerts/no-delivery*.ts`, hook `no-delivery-tick` (de hora em hora,
    8h–21h; fora disso ignora), manual em `/api/alerts/no-delivery`. "Sem anúncio ativo" = nenhum anúncio ACTIVE na conta (vale a
    qualquer hora); "sem entrega" = tem anúncio ativo mas zero gasto e zero impressões hoje a partir das 10h. Cada conta/problema
    avisa 1x por dia. Só avisa — não muda nada.

126. **Aumento programado de investimento (Etapa 139)** — migration `0032_budget_increase_plan.sql`. `budget-plan-tick` (madrugada) monta
    o plano; `budget-apply-tick` aplica a partir das 6h em fila (2s entre conjuntos, ~50s por chamada; o n8n chama a cada 2 min até
    esvaziar), conferindo na Meta na hora se o conjunto continua ativo e o orçamento atual. Regra (`budget-increase-rule.ts`): CPA dos
    últimos 3 dias SEM hoje até R$1 acima da meta (ou abaixo) → +R$10; até R$2 acima → +R$5; mais que isso, nada. Teto R$30; R$35 se o
    CPA de 7 dias estiver abaixo da meta (ex.: em R$25 sobe só R$5; com 7 dias bons sobe R$10). Exige 3 conversas ou mais nos 3 dias,
    conjunto com anúncio ativo, orçamento diário próprio (ABO) e fora da quarentena de 24h. Sem limite por conta. Tela: Análise →
    "Aumento programado" (plano do dia, refazer, aplicar agora, tirar do plano, histórico).

127. **Aba "Padrão de nomes" (Etapa 140)** — `lib/naming/rules.ts` (regras puras) e `scan.ts`. Campanha: `TIPO | OBJETIVO | UNIDADE`
    (TIPO só GERAL/EXAME/OFERTA; PROMO, OFERTAS e CREDIARIO são sugeridos como OFERTA; data no fim da unidade é removida). Conjunto:
    `TIPO | OFERTA | LOCALIZAÇÃO/KM | IDADE | GÊNERO | PLATAFORMA | DIRECIONAMENTO | AND | DATA`, tudo derivado do público e da data
    de criação na Meta (raio em KM ou cidade; várias cidades = `CIDADE+`; idade `18-65+`; gênero e plataforma só quando é um só —
    MULHER/HOMEM, INSTA/FACE; `INTERESSES` só quando há interesses; data dd/mm de Brasília). "Cópia" não pode em nenhum nome (campanha,
    conjunto, anúncio). Escopo: contas exibidas e ativas com "IVS" no nome, só itens ativos, campanhas [VAGA] ignoradas. A aba lista só o
    que diverge, com sugestão editável; Aceitar renomeia na hora na Meta (sugestão incompleta, ex.: EXAME sem oferta, só libera depois de
    editar). Quando SÓ idade e/ou data divergem, o `naming-fix-tick` (diário) corrige sozinho e avisa em Alertas; há botão pra rodar na hora.
    Etapa 140b (ajustes depois de ver a tela): no CONJUNTO o tipo é GERAL, EXAME ou PROMO (OFERTA/OFERTAS/CREDIARIO viram PROMO; a
    campanha continua GERAL/EXAME/OFERTA); GERAL NÃO leva oferta (some "ARMAÇÃO R$ 49,99", "R$ 49,99", "COBRIMOS OFERTAS" e
    qualquer oferta antiga), PROMO e EXAME levam; localização: se há raio → só o km (km + cidade vira só `8KM`), uma cidade → só a
    cidade, várias cidades → `PRIMEIRA+` (ex.: AMPARO & CIDADES VIZINHAS → AMPARO+). Cada item tem o link "Abrir no Gerenciador"
    (`adsManagerEntityUrl`), há "Aceitar todos" (geral e por conta; sugestão incompleta só entra depois de editada) e a varredura
    agora pega o que está LIGADO (ativo + programado/em análise, a mesma lista `ACTIVE_ISH_STATUSES` do Invest. diário).
    Etapa 140c: CREDIARIO e BOLETO não são tipo — ficam logo depois do tipo/oferta (`GERAL | CREDIARIO`, `PROMO | OFERTA | BOLETO`;
    em campanha, "CREDIARIO | …" vira `GERAL | CREDIARIO | …`); `VDO PROPRIO` (vídeo gravado pelo cliente) fica DEPOIS da oferta/pagamento
    (`PROMO | ARMAÇÃO 1 REAL | VDO PROPRIO`, `GERAL | VDO PROPRIO`, `GERAL | CREDIARIO | VDO PROPRIO`). Nomes personalizados de propósito:
    botão "Manter personalizado" (tabela `naming_exceptions`, migration `0033_naming_exceptions.sql`) — o item sai da lista e nem a aba
    nem o ajuste automático de idade/data mexem mais nele; aceitar um nome EDITADO que continua fora da regra também guarda o item como
    personalizado. Seção "Personalizados" no fim da aba, com "Voltar ao padrão".

128. **Menu reorganizado (Etapa 141)** — Painel agora tem só: Desempenho (era Acompanhamento), Análise, Controle de Saldo, Metas (era
    Acompanhamento de metas), Monitor de CPA, Evolução e Copy (nessa ordem; os ids internos não mudaram, então filtros salvos
    continuam valendo; aba salva que não existe mais cai em Desempenho). **Visão Geral** foi excluída de vez (tela `visao-geral.tsx`,
    rota `/api/meta/breakdown` e `lib/meta/breakdown.ts`). **Demandas** saiu do Painel (tela `demandas-tab.tsx` excluída) — o
    backend (`/api/demands`, hooks `demand-*`, grupo de demandas em Configurações → WhatsApp) continua no projeto, parado.
    **Clientes** foi pra Configurações (nova sub-aba "Clientes"). **Alertas, Padrão de nomes e Descrição** foram pra Auditoria,
    que agora tem as sub-abas Alertas | Padrão de nomes | Descrição | Verificações (as verificações de localização/erros de
    sempre, que continuam rodando sozinhas de hora em hora pelo n8n). As telas fora do Painel carregam contas/vínculos pelo hook
    `lib/hooks/use-accounts-data.ts`.

129. **Monitor de CPA com 3 períodos (Etapa 142)** — só Hoje (abre sempre nele), Ontem e Hoje e ontem; Últimos 3 dias e Este mês
    saíram da tela (o cálculo diário em cache no servidor não mudou).

130. **Filtro de Status em Evolução (Etapa 143)** — caixa "Status" (Todos / Inauguração / Baixa / Média / Alta / Crítica, com os rótulos
    de Configurações → Status) no topo da tela Evolução; só esconde linhas, não busca de novo na Meta.

131. **Painel enxuto (Etapa 144)** — removidos da aba Desempenho o botão "Atualizar status em massa" (o status já é atualizado
    sozinho pelo n8n, segunda e quinta 01h) e o "Grupo de foco" (barra, estado e salvamento no filtro). Apagados
    `bulk-status-dialog.tsx` e `focus-groups-bar.tsx`; a rotina automática e a rota `/api/focus-groups` ficaram no lugar.

132. **Aba Metas simplificada (Etapa 145)** — saíram as colunas Invest. diário e Ritmo (continuam em Desempenho). O cabeçalho
    ficou "% de investimento (55%)": o número entre parênteses é quanto do mês já passou (dia de hoje ÷ dias do mês, ex.: dia 17
    de 31 = 55%), onde fica o tracinho da barra. Ordenação nova, sempre na base mensal: **Padrão** (mais fora da meta → mais
    tranquilas: CPA alto + investimento fora, depois só um dos dois, depois ok), **Investimento** (diferença entre o investido e o
    ideal até hoje, em % da meta do mês, pra cima ou pra baixo, da maior pra menor) e **CPA** (quanto está acima do CPA ideal,
    da maior diferença pra menor).

133. **Tabela de Desempenho mais limpa (Etapa 146)** — saíram as colunas Editar (edição fica em Configurações → Clientes; a janela
    `edit-client-dialog.tsx` foi apagada), Ritmo e Conta. O nome do cliente ficou mais largo (não corta mais) e virou o link pro
    Gerenciador de Anúncios, com a cor do saldo (vermelho = erro de pagamento, laranja = saldo baixo). O balão com WhatsApp /
    Investimento mensal / Invest. diário médio continua igual.

134. **Desempenho: colunas, cores e sem arrastar (Etapa 147)** — nova ordem: Status | Leads | Valor usado | CPA ideal | CPA | Ritmo
    (o antigo "Invest. diário" só mudou de nome). **Valor usado** é colorido pela meta de Investimento mensal (gasto do mês até agora ×
    ideal até hoje, mesma regra da aba Metas): verde dentro, laranja abaixo, vermelho acima. **CPA ideal** fica verde quando o CPA do
    período está abaixo/igual à meta e vermelho quando está acima. Removido o arrastar-e-soltar (coluna ⠿, aviso e gravação da ordem);
    a opção de ordenação virou "Ordem salva". Tirada a linha "Mostrando N conta(s) selecionada(s)… cliente(s) desativado(s)" do topo do Painel.

135. **Monitor de CPA — "Ontem" sempre do dia certo e direto da Meta (Etapa 148)** — caso Itapetininga: o Monitor mostrava CPA R$ 31,40
    e o Gerenciador, R$ 3,61 (R$ 57,79 ÷ 16 conversas; as campanhas são todas de engajamento/mensagens, o tipo não tinha
    nada a ver). O número vinha do cache guardado, que a tela mostrava mesmo sendo de outro dia, e do backup diário. Agora: o
    cache guarda o dia em que foi calculado e, se for de outro dia, é recalculado sozinho ao abrir "Ontem"; o cálculo vai
    sempre direto na Meta (sem usar o backup diário); se a Meta falhar, a tela avisa que o número é antigo; e passar o mouse no
    CPA da direita mostra a conta (gasto ÷ conversas) pra conferir.

136. **Ofertas ativas na aba Descrição (Etapa 149)** — a coluna que dizia "Em breve" agora mostra, por conta IVS, o que existiu no MÊS
    corrente (conjunto com gasto no mês ou ligado agora; campanhas [VAGA] fora), lido pelo nome padronizado do conjunto:
    **GERAL** ATIVO/INATIVO/INEXISTENTE · **EXAME** ATIVO - oferta / INATIVO - oferta / INEXISTENTE (uma oferta só: a ligada de maior
    gasto, senão a de maior gasto) · **PROMO** todas as ofertas, inclusive inativas (ou INEXISTENTE) · **BOLETO** ATIVO/INATIVO/INEXISTENTE.
    BOLETO e CREDIARIO são a mesma coisa (os dois caem na linha BOLETO). Contas não-IVS mostram "Só contas IVS". Busca em lotes de 6 contas
    (`/api/analysis/offers`); botão ↻ no cabeçalho da coluna atualiza na hora (ver item 137 — o retrato agora é fixo). Regra em `lib/offers/rule.ts`,
    busca em `lib/offers/scan.ts`. Nomes ainda fora do padrão (ex.: "[POPULAR EXAME ] 18 - 65+") não são reconhecidos até serem
    corrigidos em Auditoria → Padrão de nomes.

137. **Ofertas ativas: retrato fixo por automação (Etapa 150)** — a coluna não busca mais na Meta a cada abertura: lê um retrato
    guardado no Supabase (`meta_insights_cache`, chave `offers_snapshot`, sem SQL novo), refeito pelo hook `offers-tick`
    (n8n: 05h20 e 12h00, repetindo +6 e +12 min; cada chamada só refaz as contas com retrato de mais de 3 h, em lotes, e continua
    na chamada seguinte se o prazo da função acabar; `?force=1` refaz tudo). O ↻ da coluna recalcula na hora e atualiza o retrato.
    A coluna mostra "atualizado dd/mm hh:mm". Novo gatilho no fluxo `n8n-workflows/pausas-e-avisos-automaticos.json` (item 13).

138. **Resumo das 7h só com as críticas + 🚨 e filtro "Atenção" no Painel (Etapa 151)** — antes o resumo usava mínimo de 2 pontos e
    mostrava no máximo 10 contas. Agora o mínimo é `MIN_POINTS = 5` (em `lib/alerts/priority-score.ts`) e **não há mais teto**: aparecem
    todas as contas com 5+ pontos, sejam 3 ou 15. Entram, por exemplo: erro no pagamento ou saldo zerado; status Crítica + CPA crítico
    ontem; status Alta + CPA crítico ontem e anteontem; status Alta + investimento abaixo de 50% do ritmo. Não entram: só status
    Crítica, ou Alta + saldo acabando. Pra ficar mais/menos rígido, basta mudar o número de `MIN_POINTS`. Cada vez que o resumo roda
    (hook das 7h, prévia ou envio manual) a lista é guardada em `meta_insights_cache` (chave `attention_accounts`, sem SQL novo) e o
    Painel → Desempenho lê dela (`/api/alerts/attention`): 🚨 na frente do nome (o balão mostra os motivos) e novo filtro **Atenção**
    ("Precisam de atenção"), salvo junto com os outros filtros. Se algum sinal da Meta falhar na montagem, a lista anterior é mantida.

139. **Pontos de todas as contas, em lotes de 12 (Etapa 152)** — o Resumo das 7h guarda a pontuação de TODAS as contas com 1+ ponto
    (`meta_insights_cache`, chave `attention_accounts`); o corte `MIN_POINTS` é aplicado só na leitura (Painel `/api/alerts/attention` e
    resumo), então mudar o mínimo vale na hora. Pra analisar: `/api/alerts/morning-summary?todas=1` mostra a última lista guardada
    (instantâneo; nome, pontos e motivos). `...?todas=1&recalcular=1&lote=1` (depois `lote=2`, `lote=3`…) refaz na Meta 12 contas por vez
    (cabe nos 60 s) e mescla no que já estava guardado. O balão do nome no Painel mostra os pontos da conta.

140. **Corte definido em 7 pontos (Etapa 153)** — olhando a lista real das 24 contas (11, 8, 8, 7×4, 6×4, 5×5, 4, 3×3, 1×2, 0×2), o
    mínimo subiu de 5 pra `MIN_POINTS = 7` → 7 contas (JI PARANÁ 2, Amparo, Foz do Iguaçu, Chapecó 2 Efapi, Itapetininga, Blumenau - P,
    Rondonópolis Marechal). Erro no pagamento e saldo zerado passaram de 5 pra 7 pontos (`BLOCKING_POINTS`) pra continuar entrando
    sozinhos. Vale na hora no Painel (🚨/filtro) e no próximo resumo; o corte é aplicado na leitura (item 139).

141. **Legenda das cores no Desempenho (Etapa 154)** — um "i" discreto ao lado de Valor usado, CPA ideal, CPA e Ritmo; ao passar o mouse
    (ou focar com Tab) abre um balão pequeno com o que cada cor significa (verde/laranja/vermelho e os limites: 2% da meta mensal,
    R$ 2,50 de CPA, ±R$ 10 de Ritmo). Componente `components/painel/color-legend.tsx`; substituiu os `title` antigos dessas colunas.

142. **Correção do link "Últimos 3 dias" pro Gerenciador (Etapa 155)** — com o período "Últimos 3 dias" do Painel o link abria o Gerenciador
    com "Erro: falha ao carregar componente": o nome `last_3d` no `date=` não existe lá. Testado no Chrome: `yesterday`, `last_7d`,
    `last_2_days` e `this_month` abrem normal; só `last_3d` quebra. Agora esse período vai só com as datas (`lib/meta/ads-manager-link.ts`).

143. **Controle de Saldo: sem verificação manual, subseção "Saldo por fundos" e aviso das 19h (Etapa 156)** — três ajustes:
    (1) a verificação manual foi removida por completo (botão, rotas `/api/alerts/manual-check` e `/verify`, campos no
    "Personalizar alertas" e o aviso `manual-check`); as colunas `manual_check_*` continuam no banco, sem uso e sem problema;
    (2) na sub-aba Pix, abaixo da tabela normal, nova subseção "Saldo por fundos" com qualquer conta (Pix ou Híbrida) que tenha
    o saldo por fundos ligado — essas contas saem da tabela de cima e da aba Híbrida, então nenhuma aparece duas vezes;
    (3) nova automação de segunda a sexta às 19h (`balance-evening-tick`): para cada conta Pix/Híbrida calcula Saldo − Ritmo
    (gasto previsto de amanhã; sem Ritmo usa o orçamento diário) e, se ficar abaixo do limite de alerta da conta, manda uma
    mensagem "Saldo para amanhã" (grupo do WhatsApp + aba Alertas) listando as contas, pra você antecipar o Pix e programar o
    disparo. Contas com Pix enviado há pouco ou já programado pra frente não entram. Prévia sem enviar: abrir
    `/api/alerts/balance-evening` logado. No n8n é o item 14 do fluxo "Pausas e avisos automáticos" (cron `0 19 * * 1-5`).
    Arquivos: `lib/alerts/balance-evening.ts`, `app/api/public/hooks/balance-evening-tick/route.ts`, `app/api/alerts/balance-evening/route.ts`.

144. **Filtro por conta em Alertas voltou a listar os clientes (Etapa 157)** — a lista do filtro dependia das contas carregadas da Meta (lenta)
    e ficava só com "Todas as contas". Agora os nomes vêm direto do cadastro de clientes (`/api/account-bindings`, só clientes ativos),
    aparecendo na hora (`components/painel/alertas-tab.tsx`).

145. **Pausas automáticas: travas novas, backup e fim de semana com standby (Etapa 158)** — precisa rodar a migration `0034_pause_backup_and_standby.sql`.
    Conjuntos (`lib/alerts/adset-decision.ts` + `adsets-pause.ts`): (1) nunca pausa conjunto com menos de 24h; (2) nunca pausa por desempenho
    conjunto com TODOS os criativos ativos (primeiro pausa criativo, depois o conjunto); (3) conjunto sem anúncio ativo e sem gasto não é
    pausado, só avisa na aba Alertas (1x por dia, tipo "Conjunto sem gasto"); (4) orçamento diário (ABO) acima de R$25 e CPA de ontem + hoje
    R$4+ acima da meta → orçamento vai pra R$10 e quarentena de 24h (CBO não mexe).
    Backup (`lib/alerts/pause-backup.ts`, hook `pause-backup-tick`, 1º nó de cada rodada de pausas no n8n): revisa o que o sistema pausou nas
    últimas 6h (registro em `auto_pause_log`) e reativa conjunto/criativo que ganhou conversa, teve o custo por conversa reduzido e já está
    dentro do limite (R$4 da meta). Só reativa quem ainda está pausado; aviso "Reativado (backup)" na aba Alertas.
    Fim de semana (sábado/domingo, `lib/alerts/weekend.ts`): a escada é 1º reduzir o orçamento do conjunto pra R$10 (standby, criativos intocados),
    2º pausar o criativo caro (6h depois, se não melhorou), 3º pausar o conjunto. Sábado e domingo 00h30 o hook `weekend-standby-tick` põe em
    standby os conjuntos de bom desempenho (CPA dos 7 dias abaixo da meta) ou com mais de 3 dias ativos (orçamento R$10). Segunda 05h o hook
    `weekend-release-tick` devolve todos pra R$15. Tela nova: Auditoria → Standby (`/api/standby`).
    No n8n: itens 1 (agora com Backup), 15 (standby sáb/dom) e 16 (volta segunda 05h).

146. **Botão "Duplicar" em Análise → CPA abaixo da meta (Etapa 159)** — em cada conjunto, ao lado de "Aumentar +R$2,50". Abre uma janelinha com o nome
    sugerido (a data "dd/mm" do nome é trocada pela de hoje), o orçamento diário (editável, só quando o orçamento é do conjunto/ABO) e os
    criativos ATIVOS com o CPA de cada um (os R$4+ acima da meta já vêm desmarcados). A cópia nasce PAUSADA, na mesma campanha, só com os
    criativos marcados (que herdam o status do original, então ativar o conjunto já ativa tudo). Feita passo a passo pela Graph API
    (`/copies` do conjunto sem cópia profunda, depois `/copies` de cada criativo) e, se algo falhar, mostra a mensagem exata da Meta — serve
    também pra descobrir por que a duplicação dava erro. Arquivos: `lib/meta/duplicate.ts`, `app/api/analysis/duplicate/route.ts`,
    `components/painel/duplicar-conjunto-dialog.tsx`.

    Etapa 159b: no 1º teste a Meta recusou a cópia nativa ("The click attribution window is optional… use one of these supported windows: 1 days") —
    ela reaplica a janela de atribuição padrão, que não vale pra conjuntos de conversas. Nesse caso o conjunto é CRIADO a partir dos dados do
    original (segmentação, otimização, objeto promovido…) já com atribuição de 1 dia de clique, e a janelinha avisa que usou esse método.

    Etapa 159c: no 2º teste o conjunto foi criado, mas a cópia nativa de cada anúncio falhou ("O recurso de inclusão do campo de aprimoramentos
    padrão no criativo foi descontinuado"): a Meta aposentou esse campo e a cópia o reenvia. Agora, se a cópia nativa do anúncio falhar, o anúncio
    é criado apontando pro MESMO criativo do original (`creative_id`, mais os `tracking_specs`), sem reenviar o criativo — o que o Gerenciador faz.

147. **Análise → "Vídeos (Geral)" (Etapa 160)** — terceiro botão da Análise (ao lado de Análise e Aumento). Mapa dos 31 vídeos do banco de
    GERAL, cruzando todas as contas com meta cadastrada. Só LÊ da Meta (não altera nada). O vídeo é identificado pelo NOME do anúncio
    ("GERAL | NOME DO VÍDEO", sem acento/maiúscula, ignora sufixos como "- Cópia"); nomes antigos tipo "[ADS Geral Branding] AD 14" são ignorados e
    "GERAL | algo fora da lista" aparece como "Fora do banco". Etiquetas (filtros no topo): **Alta performance parado** (CPA do mês ou dos 7 dias abaixo
    da meta, com 3+ conversas, em alguma conta, e nenhum anúncio ativo dele em lugar nenhum), **Não usado recentemente** (último anúncio criado há
    mais de 14 dias ou nunca), **Pouco testado** (usado, mas menos de R$ 30 ou 5 conversas nos últimos 30 dias), **Ativo em 2+ conjuntos** (repetido
    na mesma conta) e **Fora do banco**. Cada vídeo expande numa tabela por conta (ativo/pausado/nunca usado, CPA 7 dias e do mês, gasto/conversas
    30 dias). Carrega em lotes de 5 contas. Limites ajustáveis em `lib/meta/video-summary.ts` (RECENT_DAYS, LOW_SPEND_30D, LOW_CONV_30D,
    GOOD_MIN_CONV); a lista de nomes fica em `lib/meta/video-bank.ts`. Arquivos: `lib/meta/video-bank.ts`, `lib/meta/video-map.ts`,
    `lib/meta/video-summary.ts`, `app/api/analysis/video-map/route.ts`, `components/painel/videos-geral.tsx`, `components/painel/analise-tab.tsx`.

    Etapa 161: a tela deixou de consultar a Meta ao abrir. Ela lê um RETRATO guardado (`meta_insights_cache`, chave `videos_geral:v1`, sem
    migration nova) com os números até ONTEM (mês, 7 dias e 30 dias terminam no dia anterior; no dia 1º o "mês" fica vazio por não haver dia
    fechado). O retrato é refeito de madrugada pelo hook `app/api/public/hooks/videos-tick/route.ts` (n8n, item 17: 05h40, 05h45, 05h50 e 05h55;
    cada chamada continua as contas que faltam; `?force=1` refaz tudo). O botão "Atualizar agora" da tela refaz na Meta em lotes e guarda o novo
    retrato. "Ativo agora"/último uso são do momento do cálculo. Arquivos novos: `lib/meta/video-snapshot.ts`, `videos-tick`.

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
ordenação por CPA mensal em Evolução, conserto do selo "Sem anúncio
ativo" em Análise → Conjuntos, link direto pro Gerenciador de Anúncios
no nome do cliente em Evolução, limite de Conjuntos passando do
triplo pra 2x a Meta CPA + R$1 fixo, as 4 automações novas de pausa de
Criativos/Conjuntos, aumento de orçamento e aviso de investimento baixo
via n8n, o aviso de investimento baixo sem banda de tolerância, a
automação de atualização de status em massa com reordenação do quadro, os
três ajustes de produção da Etapa 56 — pausas automáticas sequenciais com
3s de intervalo, banda de R$10 de volta no aviso de investimento baixo, e
teto de R$25 no orçamento diário do aumento automático —, a busca por
nome em Visão Geral sempre em todas as contas exibidas (Etapa 57), a
remoção do próprio aumento automático de orçamento (Etapa 58, mantendo só
o botão manual de Análise) e o teto de R$25 voltando pra esse botão
manual (Etapa 59), a coluna Leads/conversas iniciadas em Acompanhamento
(Etapa 60), a nova aba Monitor de CPA com cache diário de Ontem/Últimos 3
dias (Etapa 61), o seletor de conjuntos em Análise "abaixo da meta"
(Etapa 62), o Controle de Saldo virando quadro de monitoramento orientado
a alerta com os avisos novos de sexta-feira e verificação manual mais o
campo de busca em Personalizar alertas (Etapa 63), o filtro "Este mês,
até ontem" (Etapa 64), a exclusão por nomenclatura "[TRÁFEGO]" (Etapa 65),
a coluna Observação na lista de pendentes de Controle de Saldo
(Etapa 66), a verificação manual em mais de um dia da semana
(Etapa 67) e a nova aba Demandas, que transforma solicitações de um grupo
dedicado do WhatsApp em tarefas — com IA travada por prompt só pra
transcrever áudio literalmente e separar pedidos misturados no mesmo texto,
nunca pra reescrever/resumir/inventar (Etapa 68), a reordenação de colunas
de Acompanhamento com o "R$" na coluna CPA ideal e a diferença do Ritmo
movida pra embaixo de Invest. diário (Etapa 69), a aba Copy, o gerador de
copy de anúncio do Instituto Visão Solidária com IA generativa de verdade
(diferente das outras, que só organizam texto literal) (Etapa 70) e o
envio de boleto por e-mail direto de Controle de Saldo via webhook do n8n
(Etapa 71), o reordenar automático (Inauguração → Crítica → Alta → Média →
Baixa, pior CPA primeiro em cada grupo) junto do botão manual "Atualizar
status em massa" de Acompanhamento (Etapa 72) e o envio de Pix por
WhatsApp direto de Controle de Saldo — imediato ou agendado, 4 mensagens em
sequência, destino configurável por grupo ou número (Etapa 73) e a correção
da lista de grupos do WhatsApp incompleta pra quem tem muitos grupos
(Etapa 74), o suporte a colar (Ctrl+V) o print do Pix direto no modal
"Enviar Pix", a correção do erro de banco no Pix agendado (coluna message
não aceitava null), a coluna "Invest. diário" em Controle de Saldo
(Etapa 75), a correção da pausa automática de Criativos/Conjuntos mexendo
em conta fora do Painel (Etapa 76), o Monitor de CPA sempre abrindo em
"Hoje" (Etapa 77), a separação dos conjuntos "Sem anúncio ativo" dos
demais em Análise → Conjuntos, com filtro pra ver só esses (Etapa 78) e o
Controle de Saldo reorganizado em sub-abas Pendências/Pix/Híbrida/Boleto/
Cartão/Configurações, com Tipo de conta agora preenchido manualmente
(Etapa 79), a coluna Saldo dessa mesma tela deixando claro se o valor é
disponível (Pix/Híbrida) ou a pagar (Boleto/Cartão) (Etapa 80) e o "Saldo
por fundos" opcional por conta, independente do Tipo de conta, rastreando
pagamento manual menos cobrança a partir de um saldo inicial informado
(Etapa 81) e a aba Acompanhamento de metas, com o Ritmo passando a usar os
dias reais do mês (Etapa 82) e a coluna Otimizado própria de Acompanhamento de
metas, separada da de Acompanhamento (Etapa 83) e reconhecimento/tráfego
contando só no investimento, nunca no CPA (Etapa 84) e o Ritmo passando a
alcançar o Ideal até hoje (Etapa 85) e a coluna Investimento atual em Acompanhamento de metas (Etapa 92))
estão
100%
concluídos. Não há mais nenhum item pendente do escopo combinado —
próximos pedidos são novos incrementos, a critério seu.
