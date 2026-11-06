-- Deixa o nome do cliente no Hub igual ao nome da tarefa no Asana (projeto ESTRATEGISTA SPEED DIGITAL, seções Luan, Ana e Kauê).
-- Usa a tarefa já ligada na Descrição de cada cliente (sem chute por nome). Rode uma vez no Supabase (SQL Editor → Run).
-- No final mostra o antes → depois e, embaixo, as contas do Hub que não têm tarefa do Asana ligada.

drop table if exists asana_nomes;
create temp table asana_nomes (gid text, nome text);
insert into asana_nomes values
  ('1217345192564222', 'IVS ITATIBA'),
  ('1210146737680749', 'IVS FOZ DO IGUAÇU'),
  ('1216295153718876', 'IVS GUARATINGUETÁ'),
  ('1208798705753323', 'IVS RONDONOPOLIS - P'),
  ('1216155487395469', 'IVS GUARAPARI'),
  ('1211199123641565', 'IVS PORTO VELHO 2'),
  ('1208798770226870', 'IVS CURITIBA 1'),
  ('1213877432980306', 'IVS IJUÍ'),
  ('1208798760025837', 'IVS ARIQUEMES'),
  ('1208798755480332', 'IVS BLUMENAU - P'),
  ('1217036943432420', 'IVS CAMPO GRANDE 03 - P'),
  ('1214203270482535', 'IVS JI PARANÁ 2'),
  ('1215999136383974', 'IVS NOVO HAMBURGO'),
  ('1208798655972976', 'IVS ARAPIRACA'),
  ('1213530521773026', 'IVS LUIS EDUARDO MAGALHÃES'),
  ('1213569990280406', 'IVS ITAPETININGA'),
  ('1216295153718873', 'IVS TERESINA 02'),
  ('1215216034687835', 'IVS PRESIDENTE PRUDENTE 02'),
  ('1208798759946001', 'IVS RONDONOPOLIS MARECHAL'),
  ('1212379236736570', 'IVS RIO VERDE 02'),
  ('1218018798484352', 'IVS MURIAÉ'),
  ('1208798800892016', 'IVS CHAPECÓ CENTRO'),
  ('1217345192564219', 'IVS ITAPERUNA'),
  ('1216563449194506', 'IVS AMPARO'),
  ('1217591096032873', 'IVS BENTO GONÇALVES'),
  ('1209596312881986', 'IVS APUCARANA'),
  ('1208798705753300', 'IVS BARRA DO GARÇAS - P'),
  ('1216823408922574', 'IVS TIJUCAS'),
  ('1216295153718878', 'IVS CHAPECÓ 2 EFAPI'),
  ('1211966257484273', 'IVS CUIABÁ 07 CELESTINO');

drop table if exists nomes_antes;
create temp table nomes_antes as
select b.user_id, b.ad_account_id, b.client_name as antes, a.nome as depois
from account_bindings b
join client_descriptions d on d.user_id = b.user_id and d.ad_account_id = b.ad_account_id
join asana_nomes a on a.gid = d.asana_task_gid;

update account_bindings b
set client_name = n.depois, updated_at = now()
from nomes_antes n
where b.user_id = n.user_id and b.ad_account_id = n.ad_account_id
  and b.client_name is distinct from n.depois;

-- a Descrição guarda o nome também (pra ficar igual em tudo)
update client_descriptions d
set client_name = n.depois
from nomes_antes n
where d.user_id = n.user_id and d.ad_account_id = n.ad_account_id
  and d.client_name is distinct from n.depois;

select 'renomeado' as situacao, n.antes as nome_antes, n.depois as nome_agora, n.ad_account_id as conta
from nomes_antes n
union all
select 'sem tarefa do Asana ligada', b.client_name, null, b.ad_account_id
from account_bindings b
join user_selected_accounts s on s.user_id = b.user_id and s.ad_account_id = b.ad_account_id
where b.archived is not true
  and not exists (select 1 from nomes_antes n where n.user_id = b.user_id and n.ad_account_id = b.ad_account_id)
order by 1, 2;
