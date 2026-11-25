import { NextResponse } from "next/server";
import { getAccess, canManageAccess, tempPassword, createServiceClient, type HubRole } from "@/lib/access";

// Etapa 351: Configurações → Acessos. Lista e cria logins (e-mail + senha provisória).
//   master: cria estrategistas e os próprios gestores; vê todos os acessos
//   estrategista: cria e gerencia só os gestores da carteira dele
//   gestor: sem acesso
// A senha provisória aparece UMA vez na resposta; no primeiro login a pessoa é obrigada a trocar.

type Member = {
  user_id: string;
  owner_id: string;
  role: HubRole;
  email: string;
  display_name: string | null;
  must_change_password: boolean;
  disabled: boolean;
  created_at: string;
};

const COLS = "user_id, owner_id, role, email, display_name, must_change_password, disabled, created_at";

export async function GET() {
  try {
    const acc = await getAccess();
    if (!canManageAccess(acc.role)) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    const db = createServiceClient();
    let q = db.from("hub_members").select(COLS).neq("user_id", acc.user.id).order("created_at");
    if (acc.role !== "master") q = q.eq("owner_id", acc.ownerId).eq("role", "gestor");
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return NextResponse.json({ me: { role: acc.role, email: acc.email, userId: acc.user.id }, members: (data ?? []) as Member[] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const acc = await getAccess();
    if (!canManageAccess(acc.role)) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    const db = createServiceClient();
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      role?: string;
      email?: string;
      name?: string;
      userId?: string;
    };

    if (body.action === "criar") {
      const role = body.role === "estrategista" ? "estrategista" : "gestor";
      if (role === "estrategista" && acc.role !== "master") return NextResponse.json({ error: "Só o master cria estrategistas." }, { status: 403 });
      const email = String(body.email ?? "").trim().toLowerCase();
      const name = String(body.name ?? "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
      if (!name) return NextResponse.json({ error: role === "gestor" ? "Escolha o gestor." : "Informe o nome." }, { status: 400 });
      if (role === "gestor") {
        const { data: dup } = await db
          .from("hub_members")
          .select("user_id")
          .eq("owner_id", acc.ownerId)
          .eq("role", "gestor")
          .ilike("display_name", name)
          .maybeSingle();
        if (dup) return NextResponse.json({ error: `${name} já tem acesso.` }, { status: 400 });
      }
      const password = tempPassword();
      const { data: created, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { must_change_password: true, hub_role: role },
      });
      if (error || !created.user) {
        const msg = /already|registered|exists/i.test(error?.message ?? "") ? "Esse e-mail já tem login no Hub." : (error?.message ?? "Falha ao criar.");
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      const uid = created.user.id;
      const { error: insErr } = await db.from("hub_members").insert({
        user_id: uid,
        owner_id: role === "estrategista" ? uid : acc.ownerId,
        role,
        email,
        display_name: name,
        must_change_password: true,
        created_by: acc.user.id,
      });
      if (insErr) {
        await db.auth.admin.deleteUser(uid).catch(() => {});
        throw new Error(insErr.message);
      }
      return NextResponse.json({ ok: true, email, password });
    }

    // Ações sobre um acesso existente: confere se está no alcance de quem pede.
    const userId = String(body.userId ?? "");
    const { data: target } = await db.from("hub_members").select(COLS).eq("user_id", userId).maybeSingle();
    const t = target as Member | null;
    if (!t || t.role === "master" || t.user_id === acc.user.id) return NextResponse.json({ error: "Acesso não encontrado." }, { status: 404 });
    if (acc.role !== "master" && !(t.role === "gestor" && t.owner_id === acc.ownerId))
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

    // Etapa 354: TROCAR O GESTOR — outra pessoa assume a carteira desse gestor.
    //   novo nome + novo e-mail → cria o login novo (senha provisória, troca no 1º acesso), passa TODAS as contas do
    //   nome antigo pro novo, troca o nome na lista de Gestores e apaga o login antigo (o e-mail antigo não entra mais).
    //   Mesmo e-mail → só troca o nome (contas, lista de Gestores e acesso acompanham).
    if (body.action === "substituir") {
      if (t.role !== "gestor") return NextResponse.json({ error: "Só dá pra trocar gestor." }, { status: 400 });
      const novoNome = String(body.name ?? "").trim();
      const novoEmail = String(body.email ?? "").trim().toLowerCase();
      const novoWa = String((body as { whatsapp?: string }).whatsapp ?? "").replace(/\D/g, "");
      const antigo = (t.display_name ?? "").trim();
      if (!novoNome) return NextResponse.json({ error: "Informe o nome do novo gestor." }, { status: 400 });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novoEmail)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
      const owner = t.owner_id;

      // lista de Gestores do dono da carteira
      const { data: pref } = await db.from("user_ui_prefs").select("pref_value").eq("user_id", owner).eq("pref_key", "gestores").maybeSingle();
      const lista = (Array.isArray(pref?.pref_value) ? pref?.pref_value : []) as Array<string | { name?: string; whatsapp?: string; tag?: string }>;
      const nomeDe = (g: (typeof lista)[number]) => String(typeof g === "string" ? g : (g?.name ?? "")).trim();
      if (novoNome.toLowerCase() !== antigo.toLowerCase() && lista.some((g) => nomeDe(g).toLowerCase() === novoNome.toLowerCase()))
        return NextResponse.json({ error: `Já existe um gestor chamado ${novoNome}.` }, { status: 400 });

      const mesmoEmail = novoEmail === t.email.toLowerCase();
      let password: string | null = null;
      let novoId = t.user_id;
      if (!mesmoEmail) {
        password = tempPassword();
        const { data: created, error } = await db.auth.admin.createUser({
          email: novoEmail,
          password,
          email_confirm: true,
          app_metadata: { must_change_password: true, hub_role: "gestor" },
        });
        if (error || !created.user) {
          const msg = /already|registered|exists/i.test(error?.message ?? "") ? "Esse e-mail já tem login no Hub." : (error?.message ?? "Falha ao criar.");
          return NextResponse.json({ error: msg }, { status: 400 });
        }
        novoId = created.user.id;
        const { error: insErr } = await db.from("hub_members").insert({
          user_id: novoId,
          owner_id: owner,
          role: "gestor",
          email: novoEmail,
          display_name: novoNome,
          must_change_password: true,
          created_by: acc.user.id,
        });
        if (insErr) {
          await db.auth.admin.deleteUser(novoId).catch(() => {});
          throw new Error(insErr.message);
        }
      } else {
        await db.from("hub_members").update({ display_name: novoNome }).eq("user_id", t.user_id);
      }

      // contas: tudo que era do nome antigo vai pro novo
      let contas = 0;
      if (antigo && antigo.toLowerCase() !== novoNome.toLowerCase()) {
        const { data: up } = await db
          .from("account_bindings")
          .update({ responsible: novoNome, updated_at: new Date().toISOString() })
          .eq("user_id", owner)
          .ilike("responsible", antigo)
          .select("ad_account_id");
        contas = (up ?? []).length;
      }
      // lista de Gestores: troca o nome (WhatsApp novo, se informado; a identificação da nomenclatura continua)
      const novaLista = lista.map((g) => {
        if (nomeDe(g).toLowerCase() !== antigo.toLowerCase()) return g;
        const base = typeof g === "string" ? { name: g, whatsapp: "", tag: "" } : g;
        return { ...base, name: novoNome, whatsapp: mesmoEmail ? (novoWa || base.whatsapp || "") : novoWa };
      });
      await db.from("user_ui_prefs").upsert({ user_id: owner, pref_key: "gestores", pref_value: novaLista }, { onConflict: "user_id,pref_key" });

      // login antigo apagado (o e-mail antigo não entra mais)
      if (!mesmoEmail) await db.auth.admin.deleteUser(t.user_id).catch((e: Error) => console.error("apagar login antigo", e.message));
      return NextResponse.json({ ok: true, email: novoEmail, ...(password ? { password } : {}), contas });
    }

    if (body.action === "nova-senha") {
      const password = tempPassword();
      const { error } = await db.auth.admin.updateUserById(userId, {
        password,
        app_metadata: { must_change_password: true, hub_role: t.role },
      });
      if (error) throw new Error(error.message);
      await db.from("hub_members").update({ must_change_password: true }).eq("user_id", userId);
      return NextResponse.json({ ok: true, email: t.email, password });
    }

    if (body.action === "desativar" || body.action === "ativar") {
      const disabled = body.action === "desativar";
      // ban_duration derruba o login na hora (não consegue mais entrar nem renovar a sessão)
      const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: disabled ? "876000h" : "none" });
      if (error) throw new Error(error.message);
      await db.from("hub_members").update({ disabled }).eq("user_id", userId);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "remover") {
      if (t.role === "estrategista") {
        // Remover o login de um estrategista apagaria a carteira inteira dele (contas, gestores, WhatsApp). Só desativar.
        return NextResponse.json({ error: "Estrategista não é removido, só desativado (pra não apagar a carteira dele)." }, { status: 400 });
      }
      const { error } = await db.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
