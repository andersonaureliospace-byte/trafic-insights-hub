// Etapa 73: sequência de mensagens do envio de PIX por WhatsApp — saudação
// (por horário) + texto fixo + texto do PIX (variável) + print do PIX
// (imagem), nessa ordem, cada uma como uma mensagem separada no chat (igual
// ao fluxo manual que o usuário já fazia). Usado tanto no envio imediato
// (app/api/pix/send/route.ts) quanto, com "greeting" resolvido na hora certa,
// pelo hook agendado (app/api/public/hooks/whatsapp-dispatch-tick/route.ts).

export const PIX_FIXED_TEXT = "Segue pix para adicionar saldo na conta de anúncios";

// Horário de Brasília, sempre — independente de onde o servidor rodar.
export function greetingNow(at: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(at),
  );
  if (hour < 12) return "Bom dia, tudo bem?";
  if (hour < 18) return "Boa tarde, tudo bem?";
  return "Boa noite, tudo bem?";
}

export type PixMessagePart =
  | { type: "greeting" }
  | { type: "text"; text: string }
  | { type: "image"; url: string; mime: string; fileName?: string };

// Monta a sequência fixa de 4 partes — "greeting" fica sem resolver aqui de
// propósito: só vira texto de verdade na hora do envio (imediato = agora
// mesmo; agendado = quando o hook efetivamente disparar), pra bater com o
// horário real, não o horário em que o usuário preencheu o formulário.
export function buildPixParts(pixText: string, image: { url: string; mime: string; fileName?: string }): PixMessagePart[] {
  return [
    { type: "greeting" },
    { type: "text", text: PIX_FIXED_TEXT },
    { type: "text", text: pixText },
    { type: "image", url: image.url, mime: image.mime, fileName: image.fileName },
  ];
}
