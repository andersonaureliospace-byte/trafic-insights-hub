-- Copia pro Hub a prioridade que está no Asana AGORA (lida em 09/11/2026 às 07h30, depois da rodada das 04h15).
-- Só prioridade. Usa a tarefa do Asana ligada a cada cliente. Rode uma vez no Supabase (SQL Editor → Run).

drop table if exists asana_agora;
create temp table asana_agora (gid text, nome text, prioridade text);
insert into asana_agora values
  ('1217345192564222', 'IVS ITATIBA', 'critica'),
  ('1210146737680749', 'IVS FOZ DO IGUAÇU', 'alta'),
  ('1216295153718876', 'IVS GUARATINGUETÁ', 'critica'),
  ('1208798705753323', 'IVS RONDONOPOLIS - P', 'critica'),
  ('1216155487395469', 'IVS GUARAPARI', 'baixa'),
  ('1211199123641565', 'IVS PORTO VELHO 2', 'baixa'),
  ('1208798770226870', 'IVS CURITIBA 1', 'baixa'),
  ('1218018798484352', 'IVS MURIAÉ', 'media'),
  ('1208798800892016', 'IVS CHAPECÓ CENTRO', 'critica'),
  ('1217345192564219', 'IVS ITAPERUNA', 'critica'),
  ('1216563449194506', 'IVS AMPARO', 'critica'),
  ('1217591096032873', 'IVS BENTO GONÇALVES', 'critica'),
  ('1209596312881986', 'IVS APUCARANA', 'critica'),
  ('1208798705753300', 'IVS BARRA DO GARÇAS - P', 'critica'),
  ('1216823408922574', 'IVS TIJUCAS', 'critica'),
  ('1216295153718878', 'IVS CHAPECÓ 2 EFAPI', 'critica'),
  ('1211966257484273', 'IVS CUIABÁ 07 CELESTINO', 'critica'),
  ('1213877432980306', 'IVS IJUÍ', 'critica'),
  ('1208798760025837', 'IVS ARIQUEMES', 'critica'),
  ('1208798755480332', 'IVS BLUMENAU - P', 'baixa'),
  ('1217036943432420', 'IVS CAMPO GRANDE 03 - P', 'alta'),
  ('1214203270482535', 'IVS JI PARANÁ 2', 'critica'),
  ('1215999136383974', 'IVS NOVO HAMBURGO', 'critica'),
  ('1208798655972976', 'IVS ARAPIRACA', 'critica'),
  ('1213530521773026', 'IVS LUIS EDUARDO MAGALHÃES', 'media'),
  ('1216295153718873', 'IVS TERESINA 02', 'media'),
  ('1215216034687835', 'IVS PRESIDENTE PRUDENTE 02', 'baixa'),
  ('1208798759946001', 'IVS RONDONOPOLIS MARECHAL', 'baixa'),
  ('1213569990280406', 'IVS ITAPETININGA', 'media'),
  ('1212379236736570', 'IVS RIO VERDE 02', 'baixa');

drop table if exists prio_antes;
create temp table prio_antes as
select b.user_id, b.ad_account_id, b.client_name, b.priority as antes, a.prioridade as depois, a.gid
from account_bindings b
join client_descriptions d on d.user_id = b.user_id and regexp_replace(d.ad_account_id, '^act_', '') = regexp_replace(b.ad_account_id, '^act_', '')
join asana_agora a on a.gid = d.asana_task_gid
where coalesce(trim(b.client_name), '') <> '';

update account_bindings b
set priority = p.depois, updated_at = now()
from prio_antes p
where b.user_id = p.user_id and b.ad_account_id = p.ad_account_id and b.priority is distinct from p.depois;

select a.nome as cliente_asana, p.client_name as conta_no_hub,
       coalesce(p.antes, '—') || ' → ' || a.prioridade as prioridade,
       case when p.ad_account_id is null then 'NÃO ACHOU A CONTA (sem ligação com o Asana)'
            when p.antes is distinct from p.depois then 'atualizada' else 'já estava certa' end as situacao
from asana_agora a
left join prio_antes p on p.gid = a.gid
order by (p.ad_account_id is null) desc, situacao, a.nome;
