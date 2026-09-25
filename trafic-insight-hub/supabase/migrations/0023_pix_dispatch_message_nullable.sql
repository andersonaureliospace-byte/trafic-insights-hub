-- Etapa 73 (correção): disparo de Pix agendado (app/api/pix/send/route.ts)
-- insere `parts` (sequência de mensagens) e deixa `message` como null — uma
-- mensagem única não se aplica a um disparo em sequência. Só que a coluna
-- `message` é NOT NULL desde a criação da tabela (0001_init.sql), e ninguém
-- tinha mexido nisso até agora — o insert vinha falhando com "null value in
-- column "message"... violates not-null constraint". Disparo de texto único
-- (Mensagens > Envio) continua exigindo message na validação da própria rota
-- (app/api/whatsapp/scheduled-dispatches/route.ts), então isso não abre
-- brecha pra criar um disparo sem `message` nem `parts`.
alter table whatsapp_scheduled_dispatches alter column message drop not null;
