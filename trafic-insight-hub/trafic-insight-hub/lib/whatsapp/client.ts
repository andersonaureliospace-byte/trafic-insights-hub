// Cliente cru da API do uazapi. Portado do app anterior
// (src/lib/whatsapp.functions.ts / workspace-whatsapps.functions.ts), sem a
// camada de workspace — aqui é sempre a instância única do usuário.

export interface WhatsappCreds {
  api_url: string;
  token: string;
}

export async function waFetch<T>(
  creds: WhatsappCreds,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${creds.api_url.replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", token: creds.token, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const msg =
      (json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : typeof json === "string"
          ? json
          : text) || `HTTP ${res.status}`;
    throw new Error(`uazapi ${res.status}: ${msg}`);
  }
  return json as T;
}

export interface WhatsappConnectResult {
  qrcode: string | null;
  paircode: string | null;
  status: string;
  connected: boolean;
}

export function extractConnect(json: unknown): WhatsappConnectResult {
  const root = (json ?? {}) as Record<string, unknown>;
  const instance = ((root.instance ?? root) as Record<string, unknown>) || {};
  const status = (instance.status as string) || (root.status as string) || "unknown";
  const qrcode =
    (instance.qrcode as string) ||
    (root.qrcode as string) ||
    (instance.qr as string) ||
    (root.qr as string) ||
    null;
  const paircode =
    (instance.paircode as string) ||
    (root.paircode as string) ||
    (instance.code as string) ||
    (root.code as string) ||
    null;
  return {
    qrcode: qrcode || null,
    paircode: paircode || null,
    status,
    connected: status === "connected" || status === "open",
  };
}

export async function sendText(creds: WhatsappCreds, groupId: string, text: string): Promise<void> {
  await waFetch(creds, "/send/text", {
    method: "POST",
    body: JSON.stringify({ number: groupId, text }),
  });
}

export interface WhatsappGroup {
  id: string;
  name: string;
}

export async function listGroups(creds: WhatsappCreds, force = false): Promise<WhatsappGroup[]> {
  // uazapi: POST /group/list (com body) retorna a lista completa de grupos.
  const json = await waFetch<unknown>(creds, "/group/list", {
    method: "POST",
    body: JSON.stringify({ force }),
  });
  const arr: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { groups?: unknown[] })?.groups)
      ? (json as { groups: unknown[] }).groups
      : Array.isArray((json as { data?: unknown[] })?.data)
        ? (json as { data: unknown[] }).data
        : [];
  const groups: WhatsappGroup[] = arr
    .map((g) => {
      const o = g as Record<string, unknown>;
      const id = (o.JID as string) || (o.id as string) || (o.wa_chatid as string) || "";
      const name =
        (o.Name as string) ||
        (o.name as string) ||
        (o.Subject as string) ||
        (o.subject as string) ||
        (o.wa_name as string) ||
        id;
      return { id, name };
    })
    .filter((g) => g.id && g.id.includes("@g.us"));
  groups.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return groups;
}
