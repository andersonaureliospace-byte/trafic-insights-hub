-- Liga "IVS Curitiba 01" e "IVS CUIABÁ CELESTINO 07" às tarefas do Asana e deixa o nome igual ao do Asana.
-- Rode uma vez no Supabase (SQL Editor → Run). No final mostra as duas contas já ligadas.

drop table if exists ligar;
create temp table ligar as
select b.user_id, b.ad_account_id, v.gid, v.nome
from account_bindings b
join (values
  ('ivs curitiba 01', '1208798770226870', 'IVS CURITIBA 1'),
  ('ivs cuiaba celestino 07', '1211966257484273', 'IVS CUIABÁ 07 CELESTINO')
) as v(hub, gid, nome)
  on trim(regexp_replace(translate(lower(coalesce(b.client_name, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', ' ', 'g')) = v.hub
where b.archived is not true;

update account_bindings b
set client_name = l.nome, updated_at = now()
from ligar l
where b.user_id = l.user_id and b.ad_account_id = l.ad_account_id;

insert into client_descriptions (user_id, ad_account_id, client_name, asana_task_gid, asana_task_name, match_status, updated_at)
select user_id, ad_account_id, nome, gid, nome, 'ok', now() from ligar
on conflict (user_id, ad_account_id) do update
set client_name = excluded.client_name,
    asana_task_gid = excluded.asana_task_gid,
    asana_task_name = excluded.asana_task_name,
    match_status = 'ok',
    updated_at = now();

select b.client_name as conta_no_hub, d.asana_task_name as tarefa_no_asana, d.match_status as ligada
from ligar l
join account_bindings b on b.user_id = l.user_id and b.ad_account_id = l.ad_account_id
join client_descriptions d on d.user_id = l.user_id and d.ad_account_id = l.ad_account_id;
