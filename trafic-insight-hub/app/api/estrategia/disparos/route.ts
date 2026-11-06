import { NextResponse, after } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createServiceClient } from "@/lib/supabase/server";
import { requireWhatsappInstance } from "@/lib/whatsapp/instance";
import { listGroups } from "@/lib/whatsapp/client";
import { FEEDBACK_BUCKET } from "@/lib/feedbacks/core";
import { chainDisparos, cleanParts, createDisparo, hasStalledDisparo, runDisparos, type DisparoAlvo } from "@/lib/estrategia/disparos";
import { inactiveAccountIds } from "@/lib/accounts/inactive";
import { normName } from "@/lib/asana/priority-sync";

// Etapa 266: Disparos em massa (Hub estratégico).
//   GET  (?force=1)                      → grupos do WhatsApp + de quais clientes/gestores cada um é
//   POST { action: "upload", ... }       → URL assinada pra subir a imagem/vídeo DIRETO pro Storage (sem o limite de 4,5 MB da Vercel)
//   POST { action: "send", groupId, parts } → manda as partes, em ordem, num grupo. O navegador chama um grupo por vez,
//                                             com intervalo entre eles (sem estourar os 60s da função e sem cara de spam).
export const maxDuration = 60;

const normId = (id: string) => String(id ?? "").replace(/^act_/, "");
const UPLOAD_LIMIT = 50 * 1024 * 1024;
const FOLDER = "disparos";
const KEEP_DAYS = 7;

interface ClienteRef {
  id: string;
  rawId: string;
  name: string;
  responsible: string | null;
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    // Etapa 270: ?disparos=1 → últimos disparos (e os grupos de um deles com ?id=, ou do mais recente)
    const qs = new URL(request.url).searchParams;
    if (qs.get("disparos") === "1") {
      const { data: list, error } = await supabase
        .from("estr_disparos")
        .select("id, status, resumo, total, ok, erro, interval_min, interval_max, next_at, last_error, created_at, finished_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) {
        if (/estr_disparo/.test(error.message)) return NextResponse.json({ disparos: [], itens: [], semTabela: true });
        throw error;
      }
      const alvo = qs.get("id") || list?.[0]?.id || null;
      let itens: unknown[] = [];
      if (alvo && qs.get("itens") !== "0") {
        const { data } = await supabase
          .from("estr_disparo_itens")
          .select("group_id, group_name, status, parte, error, sent_at")
          .eq("disparo_id", alvo)
          .order("ordem", { ascending: true })
          .limit(2000);
        itens = data ?? [];
      }
      // contagem ao vivo do disparo rodando (a linha do disparo só é recontada no fim de cada rodada)
      const disparos = await Promise.all(
        (list ?? []).map(async (d) => {
          if (d.status !== "rodando" && d.status !== "pausado") return d;
          const [{ count: ok }, { count: erro }] = await Promise.all([
            supabase.from("estr_disparo_itens").select("id", { count: "exact", head: true }).eq("disparo_id", d.id).eq("status", "ok"),
            supabase.from("estr_disparo_itens").select("id", { count: "exact", head: true }).eq("disparo_id", d.id).eq("status", "erro"),
          ]);
          return { ...d, ok: ok ?? d.ok, erro: erro ?? d.erro };
        }),
      );
      return NextResponse.json({ disparos, itens, itensDe: alvo });
    }
    const inst = await requireWhatsappInstance(supabase, user.id);
    const force = qs.get("force") === "1";
    const [groups, { data: binds }, { data: chats }, { data: gRow }, { data: sel }, off] = await Promise.all([
      listGroups(inst, force),
      supabase.from("account_bindings").select("ad_account_id, client_name, responsible, wa_group_id, archived").eq("user_id", user.id),
      supabase.from("wa_mirror_chats").select("chat_jid, ad_account_ids").eq("user_id", user.id),
      supabase.from("user_ui_prefs").select("pref_value").eq("user_id", user.id).eq("pref_key", "gestores").maybeSingle(),
      supabase.from("user_selected_accounts").select("ad_account_id").eq("user_id", user.id),
      inactiveAccountIds(supabase as never, user.id),
    ]);

    const byAcc = new Map<string, ClienteRef>();
    for (const b of binds ?? []) {
      if (b.archived) continue;
      const id = normId(b.ad_account_id as string);
      byAcc.set(id, { id, rawId: b.ad_account_id as string, name: ((b.client_name as string | null) ?? "").trim() || id, responsible: ((b.responsible as string | null) ?? "").trim() || null });
    }
    // Mesmo vínculo do resto do Hub: grupo atribuído no WhatsApp do Hub estratégico; se não, o grupo antigo da ficha.
    const clientsOf = new Map<string, Map<string, ClienteRef>>();
    const link = (jid: string, accId: string) => {
      const c = byAcc.get(normId(accId));
      if (!jid || !c) return;
      if (!clientsOf.has(jid)) clientsOf.set(jid, new Map());
      clientsOf.get(jid)!.set(c.id, c);
    };
    for (const c of chats ?? []) for (const a of (c.ad_account_ids as string[] | null) ?? []) link(c.chat_jid as string, a);
    for (const b of binds ?? []) if (b.wa_group_id) link(b.wa_group_id as string, b.ad_account_id as string);

    const list = groups
      .map((g) => ({ id: g.id, name: g.name, clientes: [...(clientsOf.get(g.id)?.values() ?? [])] }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    // Etapa 267: contas da carteira (Contas exibidas, ativas) que não têm grupo — com uma sugestão de grupo pelo nome
    // ("SPEED + IVS FOZ DO IGUAÇU" contém "IVS FOZ DO IGUAÇU"). Só sugere quando um grupo só bate.
    const offN = new Set([...off].map(normId));
    const carteira = new Set((sel ?? []).map((x) => normId(x.ad_account_id as string)).filter((id) => !offN.has(id)));
    const comGrupo = new Set(list.flatMap((g) => g.clientes.map((c) => c.id)));
    const semGrupo = [...byAcc.values()]
      .filter((c) => carteira.has(c.id) && !comGrupo.has(c.id))
      .map((c) => {
        const n = normName(c.name.replace(/\s-\s*p\s*$/i, ""));
        const hits = n ? list.filter((g) => normName(g.name).includes(n)) : [];
        return { ...c, sugestao: hits.length === 1 ? { id: hits[0].id, name: hits[0].name } : null };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    const gestores = Array.isArray(gRow?.pref_value)
      ? (gRow!.pref_value as Array<{ name?: string }>).map((g) => String(g?.name ?? "").trim()).filter(Boolean)
      : [];
    return NextResponse.json({ groups: list, gestores, semGrupo });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

// Apaga os anexos de disparos com mais de 7 dias (a Uazapi só precisa do link na hora do envio).
async function purgeOld(service: ReturnType<typeof createServiceClient>, userId: string) {
  const storage = service.storage.from(FEEDBACK_BUCKET);
  const { data } = await storage.list(`${userId}/${FOLDER}`, { limit: 1000 });
  const limit = Date.now() - KEEP_DAYS * 86_400_000;
  const old = (data ?? []).filter((f) => f.created_at && new Date(f.created_at).getTime() < limit).map((f) => `${userId}/${FOLDER}/${f.name}`);
  if (old.length) await storage.remove(old);
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json()) as Record<string, unknown>;

    if (body.action === "upload") {
      const bytes = Number(body.bytes ?? 0);
      const name = String(body.name ?? "arquivo");
      if (bytes > UPLOAD_LIMIT) throw new Error(`"${name}" tem ${(bytes / 1048576).toFixed(0)} MB e o limite é 50 MB.`);
      const service = createServiceClient();
      await purgeOld(service, user.id).catch(() => {});
      const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "";
      const path = `${user.id}/${FOLDER}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext ? `.${ext}` : ""}`;
      const storage = service.storage.from(FEEDBACK_BUCKET);
      const signed = await storage.createSignedUploadUrl(path);
      if (signed.error) throw new Error(`Storage: ${signed.error.message}`);
      return NextResponse.json({
        upload_url: signed.data.signedUrl,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
        url: storage.getPublicUrl(path).data.publicUrl,
        path,
      });
    }

    // Etapa 267: vincula o grupo à conta (mesmo campo da ficha do cliente).
    if (body.action === "link") {
      const id = normId(String(body.ad_account_id ?? ""));
      const groupId = String(body.groupId ?? "").trim();
      if (!id || !groupId.endsWith("@g.us")) throw new Error("Conta ou grupo inválido.");
      const { error } = await supabase
        .from("account_bindings")
        .update({ wa_group_id: groupId, wa_group_name: String(body.groupName ?? "").slice(0, 200), updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .in("ad_account_id", [id, `act_${id}`]);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // Etapa 270: o disparo roda no servidor (segundo plano). Aqui só cria/controla; quem manda é runDisparos.
    const origin = new URL(request.url).origin;
    const rodar = () =>
      after(async () => {
        const service = createServiceClient();
        const r = await runDisparos(service, user.id).catch(() => ({ sent: 0, pending: true }));
        if (r.pending) await chainDisparos(origin);
      });

    if (body.action === "create") {
      const parts = cleanParts(body.parts);
      const alvos = (Array.isArray(body.alvos) ? body.alvos : []) as DisparoAlvo[];
      const id = await createDisparo(supabase, user.id, {
        parts,
        alvos,
        intervalMin: Number(body.intervalMin ?? 10),
        intervalMax: Number(body.intervalMax ?? 20),
      });
      rodar();
      return NextResponse.json({ ok: true, id });
    }

    if (body.action === "control") {
      const id = String(body.id ?? "");
      const op = String(body.op ?? "");
      const now = new Date().toISOString();
      if (op === "pausar") await supabase.from("estr_disparos").update({ status: "pausado", updated_at: now }).eq("id", id).eq("status", "rodando");
      else if (op === "parar") await supabase.from("estr_disparos").update({ status: "parado", updated_at: now, finished_at: now }).eq("id", id).in("status", ["rodando", "pausado"]);
      else if (op === "continuar") {
        await supabase.from("estr_disparos").update({ status: "rodando", next_at: now, updated_at: now, finished_at: null }).eq("id", id).in("status", ["pausado", "parado"]);
        rodar();
      } else if (op === "reenviar") {
        await supabase.from("estr_disparo_itens").update({ status: "pendente", error: null }).eq("disparo_id", id).eq("status", "erro");
        await supabase.from("estr_disparos").update({ status: "rodando", next_at: now, updated_at: now, finished_at: null }).eq("id", id);
        rodar();
      } else throw new Error("Ação desconhecida.");
      return NextResponse.json({ ok: true });
    }

    // O Hub aberto (em qualquer tela) chama de tempos em tempos: se a corrente parou, reacende.
    if (body.action === "kick") {
      if (await hasStalledDisparo(supabase, user.id)) rodar();
      return NextResponse.json({ ok: true });
    }

    throw new Error("Ação desconhecida.");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
