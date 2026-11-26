// Etapa 355: Rotina da manhã pros grupos dos clientes — cenários e mensagens aprovados pelo Anderson na planilha
// "Cenários de mensagens — rotinas pros grupos dos clientes" (nov/2026). A IA só cria variações destes textos.
// Removidos na planilha (não entram): 27 anúncios parados, 36 inauguração ter–sex, 37 investimento atrasado, 40 cliente sem mensagem.

export const FRASE_GESTOR = "O gestor já está otimizando a conta e vamos acompanhar durante o dia.";
export const FRASE_DETALHES = "Daqui a pouco envio mais detalhes.";

export interface Cenario {
  n: number;
  nome: string;
  abertura: string; // a parte que muda; a frase do gestor (e a de detalhes) entram depois
  detalhes: boolean; // termina com "Daqui a pouco envio mais detalhes." (evidência manual)
}

const c = (n: number, nome: string, abertura: string, detalhes = false): Cenario => ({ n, nome, abertura, detalhes });

export const CENARIOS: Record<number, Cenario> = Object.fromEntries(
  [
    // Seg e Qui — todas (prioridade nova × anterior)
    c(1, "Prioridade: Baixa → Média", "Bom dia, pessoal! O movimento deu uma leve caída nos últimos dias.", true),
    c(2, "Prioridade: Baixa → Alta", "Bom dia, pessoal! As conversas caíram nos últimos dias e já estamos agindo.", true),
    c(3, "Prioridade: Baixa → Crítica", "Bom dia, pessoal! Os últimos dias ficaram bem abaixo do normal e a conta virou prioridade total aqui.", true),
    c(4, "Prioridade: Média → Alta", "Bom dia, pessoal! Percebemos uma queda no movimento e já colocamos a mão na massa.", true),
    c(5, "Prioridade: Média → Crítica", "Bom dia, pessoal! O movimento caiu bastante nos últimos dias e a conta virou prioridade aqui.", true),
    c(6, "Prioridade: Alta → Crítica", "Bom dia, pessoal! Ainda não chegamos no resultado que queremos e reforçamos a atenção na conta.", true),
    c(7, "Prioridade: Crítica → Alta", "Bom dia, pessoal! Boa notícia: o movimento começou a reagir, os ajustes estão funcionando."),
    c(8, "Prioridade: Crítica → Média", "Bom dia, pessoal! O movimento melhorou bem nos últimos dias, os ajustes deram resultado."),
    c(9, "Prioridade: Crítica → Baixa", "Bom dia, pessoal! Que alegria: a conta se recuperou e o movimento voltou forte."),
    c(10, "Prioridade: Alta → Média", "Bom dia, pessoal! O movimento deu uma melhorada nos últimos dias."),
    c(11, "Prioridade: Alta → Baixa", "Bom dia, pessoal! Excelente notícia: o movimento voltou a um ótimo nível."),
    c(12, "Prioridade: Média → Baixa", "Bom dia, pessoal! Os últimos dias foram muito bons, com bastante gente chamando."),
    c(13, "Manteve Baixa", "Bom dia, pessoal! Seguimos com ótimo movimento por aqui."),
    c(14, "Manteve Média", "Bom dia, pessoal! O movimento segue estável e estamos testando anúncios novos."),
    c(15, "Manteve Alta", "Bom dia, pessoal! Seguimos trabalhando pra melhorar o movimento, com testes novos entrando essa semana."),
    c(16, "Manteve Crítica", "Bom dia, pessoal! Seguimos com atenção total na conta pra recuperar o movimento o quanto antes.", true),
    c(17, "Inauguração", "Bom dia, pessoal! Seguimos acompanhando de perto esse começo, os anúncios estão rodando."),
    c(18, "Sem prioridade definida", "Bom dia, pessoal! Passando pra dizer que estamos acompanhando a conta de perto."),
    c(19, "Piorou, mas ontem já foi melhor", "Bom dia, pessoal! Os últimos dias foram mais fracos, mas ontem já deu sinal de melhora.", true),
    c(20, "Melhorou, mas ontem foi ruim", "Bom dia, pessoal! A semana vinha boa e ontem foi um dia mais fraco."),
    // Ter a Sex — CPA ruim ontem
    c(21, "CPA ontem acima do ideal", "Bom dia, pessoal! Ontem foi um dia mais fraco de conversas."),
    c(22, "CPA ontem muito acima", "Bom dia, pessoal! Ontem o movimento ficou bem abaixo do normal.", true),
    c(23, "Gastou ontem sem conversas", "Bom dia, pessoal! Ontem os anúncios não trouxeram conversas como esperado.", true),
    c(24, "2 dias seguidos ruins", "Bom dia, pessoal! Os últimos dois dias ficaram abaixo do que queremos.", true),
    c(25, "3 dias ou mais ruins", "Bom dia, pessoal! Estamos numa sequência mais fraca e isso tem toda a nossa atenção.", true),
    c(26, "Conta boa com um dia ruim", "Bom dia, pessoal! Ontem foi um dia mais devagar, algo normal de acontecer de vez em quando."),
    // Ter a Sex — críticas / sensíveis / cliente reclamando
    c(28, "Crítica + ontem bom", "Bom dia, pessoal! Ontem foi um dia melhor, sinal de que os ajustes estão funcionando.", true),
    c(29, "Sensível + ontem bom", "Bom dia, pessoal! Passando pra contar que ontem o movimento deu uma melhorada, os testes já tiveram efeito.", true),
    c(30, "Reclamando + ontem bom", "Bom dia, pessoal! Ontem tivemos um dia melhor de conversas, os testes já começaram a dar efeito.", true),
    c(31, "Crítica + CPA ruim ontem", "Bom dia, pessoal! Ontem ainda ficou abaixo do que queremos e a conta segue como prioridade.", true),
    c(32, "Sensível + CPA ruim ontem", "Bom dia, pessoal! Ontem o movimento ficou mais fraco e já estamos cuidando disso desde cedo.", true),
    c(33, "Reclamando + CPA ruim ontem", "Bom dia, pessoal! Sabemos que o momento não está como vocês esperam, e estamos totalmente em cima.", true),
    c(34, "Crítica + sensível", "Bom dia, pessoal! Estamos com atenção máxima na conta, com ajustes rápidos sempre que precisar.", true),
    c(35, "Crítica + cliente reclamando", "Bom dia, pessoal! Entendemos a preocupação e estamos priorizando a conta.", true),
    // Sugestões aprovadas
    c(38, "Recuperação", "Bom dia, pessoal! Boa notícia: ontem o movimento voltou ao normal.", true),
    c(39, "Recorde do mês", "Bom dia, pessoal! Ontem foi o melhor dia do mês em conversas!", true),
  ].map((x) => [x.n, x]),
);

// Prioridade anterior → nova (Seg e Qui)
export const MUDANCA: Record<string, number> = {
  "baixa>media": 1, "baixa>alta": 2, "baixa>critica": 3, "media>alta": 4, "media>critica": 5, "alta>critica": 6,
  "critica>alta": 7, "critica>media": 8, "critica>baixa": 9, "alta>media": 10, "alta>baixa": 11, "media>baixa": 12,
};
export const MANTEVE: Record<string, number> = { baixa: 13, media: 14, alta: 15, critica: 16 };

// Complementos do dia (aba "Complementos do dia")
export function complementoDoDia(opts: { diaSemana: number; diaMes: number; diasNoMes: number; vesperaFeriado: boolean }): string | null {
  if (opts.vesperaFeriado) return "Com o feriado chegando, já estamos preparando os anúncios pra aproveitar o movimento.";
  if (opts.diaSemana === 1) return "O fim de semana costuma ser mais fraco, e já estamos ajustando pra semana render.";
  if (opts.diaSemana === 3) return "Já estamos colocando testes novos pra chegar forte no fim de semana.";
  if (opts.diaSemana === 5) return "Deixamos tudo pronto pro fim de semana.";
  if (opts.diaMes <= 5) return "Mês novo, verba renovada e novidades nos anúncios.";
  if (opts.diaMes > opts.diasNoMes - 5) return "Reta final do mês: vamos aproveitar bem esses últimos dias.";
  return null;
}

export function montarMensagem(cen: Cenario, complemento: string | null): string {
  return [cen.abertura, complemento, FRASE_GESTOR, cen.detalhes ? FRASE_DETALHES : null].filter(Boolean).join(" ");
}
