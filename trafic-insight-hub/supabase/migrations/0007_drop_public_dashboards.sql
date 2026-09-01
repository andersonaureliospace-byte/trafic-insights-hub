-- Etapa 11: o link público de dashboard por conta (/d/:token) foi removido
-- do app (confuso com o link de relatório pro cliente). Essa migração é
-- OPCIONAL — rode só se quiser apagar de vez a tabela e os tokens gerados
-- antes; sem rodar, ela só fica parada no banco, sem nenhum efeito, porque
-- nenhuma rota do app referencia mais "public_dashboards".
drop table if exists public_dashboards cascade;
