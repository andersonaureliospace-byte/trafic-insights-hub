-- Lista de vídeos de GERAL (Etapa 177): antes ficava fixa no código (lib/meta/video-bank.ts); agora cada usuário edita em
-- Configurações → Vídeos gerais (adicionar, renomear, excluir) sem precisar mexer no código nem no banco.
-- Os nomes são o nome do anúncio ("GERAL | PREÇO ÚNICO"). A lista atual é copiada pra cada usuário na primeira vez.
create table if not exists video_bank (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists video_bank_user_pos_idx on video_bank (user_id, position);

alter table video_bank enable row level security;
create policy "owner_all_video_bank" on video_bank
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Copia a lista atual (31 vídeos) pra quem já existe. Só roda se a tabela ainda estiver vazia.
insert into video_bank (user_id, name, position)
select u.id, v.name, v.ord
from auth.users u
cross join (values
    ('GERAL | PREÇO ÚNICO', 1),
    ('GERAL | É ISSO MESMO', 2),
    ('GERAL | ARMAÇÕES A 49,99', 3),
    ('GERAL | DÁ UMA OLHADA', 4),
    ('GERAL | PROCURANDO ÓCULOS', 5),
    ('GERAL | JÁ PENSOU', 6),
    ('GERAL | VEM COMIGO', 7),
    ('GERAL | QUALIDADE E PREÇO JUSTO', 8),
    ('GERAL | QUALIDADE X PREÇO BAIXO', 9),
    ('GERAL | QUER COMPRAR SEU ÓCULOS', 10),
    ('GERAL | MAIS DE 10 MIL CLIENTES', 11),
    ('GERAL | OLHA QUE LINDA', 12),
    ('GERAL | EI PSIU', 13),
    ('GERAL | NÓS CONTAMOS COM MAIS', 14),
    ('GERAL | OLHA ESSE LUGAR QUE INCRÍVEL', 15),
    ('GERAL | FACHADA DA LOJA', 16),
    ('GERAL | PRECISANDO DE ÓCULOS DE GRAU', 17),
    ('GERAL | PROCURANDO ÓCULOS DE GRAU', 18),
    ('GERAL | CHEGOU A HORA', 19),
    ('GERAL | ESSE É O MELHOR LUGAR', 20),
    ('GERAL | JÁ ACONTECEU ISSO COM VOCÊ', 21),
    ('GERAL | JÁ TE DISSERAM', 22),
    ('GERAL | MAIS BARATO QUE ÓTICA', 23),
    ('GERAL | NÃO ACREDITO', 24),
    ('GERAL | VOCÊ SABIA', 25),
    ('GERAL | É SÓ AQUI', 26),
    ('GERAL | QUANTO VC ACHA QUE CUSTA', 27),
    ('GERAL | JÁ PENSOU EM COMPRAR', 28),
    ('GERAL | TÁ EMBAÇADO POR AI ?', 29),
    ('GERAL | OLHA ESSA ARMAÇÃO', 30),
    ('GERAL | OLHEM ESSA ARMAÇÃO', 31)
) as v(name, ord)
where not exists (select 1 from video_bank);
