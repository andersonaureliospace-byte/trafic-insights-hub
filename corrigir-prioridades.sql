-- Corrige as prioridades que não apareciam no Hub (09/11/2026).
-- Causa: em algumas contas o número estava "act_123" num lugar e "123" no outro; a automação de prioridade gravava numa
-- ficha duplicada e vazia, e o Hub mostrava a ficha verdadeira (sem atualizar). O código já foi corrigido; este SQL arruma
-- o que ficou pra trás. Rode uma vez no Supabase (SQL Editor → cole tudo → Run). No final mostra o que mudou.

-- normaliza o número (sem "act_") pra comparar
drop table if exists fichas_dup;
create temp table fichas_dup as
select r.user_id, r.ad_account_id as real_id, g.ad_account_id as dup_id, r.client_name,
       r.priority as prioridade_antes, coalesce(g.priority, r.priority) as prioridade_agora
from account_bindings r
join account_bindings g
  on g.user_id = r.user_id
 and g.ad_account_id <> r.ad_account_id
 and regexp_replace(g.ad_account_id, '^act_', '') = regexp_replace(r.ad_account_id, '^act_', '')
where coalesce(trim(r.client_name), '') <> ''      -- a verdadeira tem o nome do cliente
  and coalesce(trim(g.client_name), '') = '';      -- a duplicada nasceu vazia (só prioridade/ordem)

-- 1) a prioridade (e a ordem) calculada vai pra ficha verdadeira
update account_bindings r
set priority = coalesce(g.priority, r.priority),
    sort_order = coalesce(g.sort_order, r.sort_order),
    updated_at = now()
from fichas_dup d
join account_bindings g on g.user_id = d.user_id and g.ad_account_id = d.dup_id
where r.user_id = d.user_id and r.ad_account_id = d.real_id;

-- 2) apaga as fichas duplicadas vazias
delete from account_bindings g
using fichas_dup d
where g.user_id = d.user_id and g.ad_account_id = d.dup_id;

-- 3) Curitiba e Cuiabá: nome igual ao Asana e ligadas à tarefa (se ainda não foi feito)
drop table if exists ligar;
create temp table ligar as
select b.user_id, b.ad_account_id, v.gid, v.nome
from account_bindings b
join (values
  ('ivs curitiba 01', '1208798770226870', 'IVS CURITIBA 1'),
  ('ivs curitiba 1', '1208798770226870', 'IVS CURITIBA 1'),
  ('ivs cuiaba celestino 07', '1211966257484273', 'IVS CUIABÁ 07 CELESTINO'),
  ('ivs cuiaba 07 celestino', '1211966257484273', 'IVS CUIABÁ 07 CELESTINO')
) as v(hub, gid, nome)
  on trim(regexp_replace(translate(lower(coalesce(b.client_name, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', ' ', 'g')) = v.hub
where b.archived is not true;

update account_bindings b set client_name = l.nome, updated_at = now()
from ligar l where b.user_id = l.user_id and b.ad_account_id = l.ad_account_id;

insert into client_descriptions (user_id, ad_account_id, client_name, asana_task_gid, asana_task_name, match_status, updated_at)
select user_id, ad_account_id, nome, gid, nome, 'ok', now() from ligar
on conflict (user_id, ad_account_id) do update
set client_name = excluded.client_name, asana_task_gid = excluded.asana_task_gid,
    asana_task_name = excluded.asana_task_name, match_status = 'ok', updated_at = now();

-- relatório
select 'ficha duplicada corrigida' as o_que, client_name as cliente, coalesce(prioridade_antes, '—') || ' → ' || coalesce(prioridade_agora, '—') as prioridade
from fichas_dup
union all
select 'ligada ao Asana', nome, null from ligar
order by 1, 2;
