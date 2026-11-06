-- Prioridades puxadas do Asana (projeto ESTRATEGISTA SPEED DIGITAL, seções Luan, Ana e Kauê), lidos em 06/11/2026.
-- Rode uma vez no Supabase (SQL Editor → cole tudo → Run). No final aparece a lista do que mudou e do que não achou conta.
--
-- Como acha a conta: 1º pela tarefa do Asana já ligada na Descrição do cliente; 2º pelo nome igual (sem acento, maiúscula
-- ou pontuação); 3º por um nome contendo o outro, só quando bate uma conta e uma tarefa (senão não chuta).

drop table if exists asana_clientes, asana_norm, contas_norm, casamento, antes, relatorio;

create temp table asana_clientes (gid text, nome text, prioridade text, gestor text);
insert into asana_clientes values
  -- Luan (Anderson)
  ('1217345192564222', 'IVS ITATIBA', 'critica', 'Luan'),
  ('1210146737680749', 'IVS FOZ DO IGUAÇU', 'critica', 'Luan'),
  ('1216295153718876', 'IVS GUARATINGUETÁ', 'critica', 'Luan'),
  ('1208798705753323', 'IVS RONDONOPOLIS - P', 'alta', 'Luan'),
  ('1216155487395469', 'IVS GUARAPARI', 'media', 'Luan'),
  ('1211199123641565', 'IVS PORTO VELHO 2', 'media', 'Luan'),
  ('1208798770226870', 'IVS CURITIBA 1', 'baixa', 'Luan'),
  -- Ana - (Anderson)
  ('1213877432980306', 'IVS IJUÍ', 'critica', 'Ana Clara'),
  ('1208798760025837', 'IVS ARIQUEMES', 'critica', 'Ana Clara'),
  ('1208798755480332', 'IVS BLUMENAU - P', 'critica', 'Ana Clara'),
  ('1217036943432420', 'IVS CAMPO GRANDE 03 - P', 'critica', 'Ana Clara'),
  ('1214203270482535', 'IVS JI PARANÁ 2', 'baixa', 'Ana Clara'),
  ('1215999136383974', 'IVS NOVO HAMBURGO', 'baixa', 'Ana Clara'),
  ('1208798655972976', 'IVS ARAPIRACA', 'baixa', 'Ana Clara'),
  ('1213530521773026', 'IVS LUIS EDUARDO MAGALHÃES', 'baixa', 'Ana Clara'),
  ('1213569990280406', 'IVS ITAPETININGA', 'baixa', 'Ana Clara'),
  ('1216295153718873', 'IVS TERESINA 02', 'baixa', 'Ana Clara'),
  ('1215216034687835', 'IVS PRESIDENTE PRUDENTE 02', 'baixa', 'Ana Clara'),
  ('1208798759946001', 'IVS RONDONOPOLIS MARECHAL', 'baixa', 'Ana Clara'),
  ('1212379236736570', 'IVS RIO VERDE 02', 'baixa', 'Ana Clara'),
  -- Kauê (Anderson)
  ('1218018798484352', 'IVS MURIAÉ', 'critica', 'kaue'),
  ('1208798800892016', 'IVS CHAPECÓ CENTRO', 'critica', 'kaue'),
  ('1217345192564219', 'IVS ITAPERUNA', 'critica', 'kaue'),
  ('1216563449194506', 'IVS AMPARO', 'alta', 'kaue'),
  ('1217591096032873', 'IVS BENTO GONÇALVES', 'alta', 'kaue'),
  ('1209596312881986', 'IVS APUCARANA', 'alta', 'kaue'),
  ('1208798705753300', 'IVS BARRA DO GARÇAS - P', 'alta', 'kaue'),
  ('1216823408922574', 'IVS TIJUCAS', 'media', 'kaue'),
  ('1216295153718878', 'IVS CHAPECÓ 2 EFAPI', 'baixa', 'kaue'),
  ('1211966257484273', 'IVS CUIABÁ 07 CELESTINO', 'baixa', 'kaue');

-- nome "limpo" pra comparar: minúsculo, sem acento, só letras/números separados por um espaço
create temp table asana_norm as
select a.*, trim(regexp_replace(translate(lower(a.nome), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', ' ', 'g')) as n
from asana_clientes a;

create temp table contas_norm as
select b.user_id, b.ad_account_id, b.client_name, b.priority, b.responsible,
       trim(regexp_replace(translate(lower(coalesce(b.client_name, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', ' ', 'g')) as n
from account_bindings b
where b.archived is not true;

create temp table casamento as
with c1 as (  -- tarefa já ligada na Descrição do cliente
  select c.user_id, c.ad_account_id, a.gid, 1 as ordem
  from contas_norm c
  join client_descriptions d on d.user_id = c.user_id and d.ad_account_id = c.ad_account_id
  join asana_norm a on a.gid = d.asana_task_gid
), c2 as (    -- nome igual
  select c.user_id, c.ad_account_id, a.gid, 2 as ordem
  from contas_norm c join asana_norm a on a.n = c.n
  where c.n <> ''
), c3 as (    -- um nome contém o outro, só se for 1 pra 1
  select * from (
    select c.user_id, c.ad_account_id, a.gid, 3 as ordem,
           count(*) over (partition by c.user_id, c.ad_account_id) as por_conta,
           count(*) over (partition by c.user_id, a.gid) as por_tarefa
    from contas_norm c join asana_norm a on (a.n like '%' || c.n || '%' or c.n like '%' || a.n || '%')
    where c.n <> '' and length(c.n) >= 6
  ) x where por_conta = 1 and por_tarefa = 1
)
select distinct on (user_id, ad_account_id) user_id, ad_account_id, gid, ordem
from (select user_id, ad_account_id, gid, ordem from c1
      union all select user_id, ad_account_id, gid, ordem from c2
      union all select user_id, ad_account_id, gid, ordem from c3) t
order by user_id, ad_account_id, ordem;

-- guarda o antes pra mostrar no relatório
create temp table antes as
select c.user_id, c.ad_account_id, c.client_name, c.priority as prioridade_antes, c.responsible as gestor_antes, m.gid, m.ordem
from contas_norm c join casamento m using (user_id, ad_account_id);

-- prioridade = a do Asana (só isso; não mexe em mais nada)
update account_bindings b
set priority = a.prioridade, updated_at = now()
from casamento m join asana_norm a on a.gid = m.gid
where b.user_id = m.user_id and b.ad_account_id = m.ad_account_id
  and b.priority is distinct from a.prioridade;

-- relatório: o que achou (e o que mudou) + tarefas do Asana que não acharam conta no Hub
select a.nome as cliente_asana, an.client_name as conta_no_hub,
       coalesce(an.prioridade_antes, '—') || ' → ' || a.prioridade as prioridade,
       case an.ordem when 1 then 'pela Descrição' when 2 then 'nome igual' when 3 then 'nome parecido' else 'NÃO ACHOU — confira o nome no Hub' end as como_achou
from asana_norm a
left join antes an on an.gid = a.gid
order by (an.gid is null) desc, a.gestor, a.nome;
