import { randomInt } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Etapa 351: quem está logado e o que pode fazer no Hub.
//   role     — master | estrategista | gestor
//   ownerId  — de quem é a carteira que essa pessoa enxerga (gestor → o estrategista dele; os outros → ele mesmo)
//   gestorName — só gestor: o nome usado em "Responsável" nas contas
// Login sem cadastro em hub_members = estrategista dono dos próprios dados (como era antes).

export type HubRole = "master" | "estrategista" | "gestor";

export interface HubAccess {
  user: User;
  role: HubRole;
  ownerId: string;
  gestorName: string | null;
  email: string;
  mustChangePassword: boolean;
}

export async function getAccess(): Promise<HubAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const { data: m } = await supabase
    .from("hub_members")
    .select("role, owner_id, display_name, must_change_password, disabled")
    .eq("user_id", user.id)
    .maybeSingle();
  if (m?.disabled) throw new Error("Acesso desativado. Fale com o estrategista responsável.");
  const role = ((m?.role as HubRole | undefined) ?? "estrategista") as HubRole;
  return {
    user,
    role,
    ownerId: (m?.owner_id as string | undefined) ?? user.id,
    gestorName: role === "gestor" ? ((m?.display_name as string | null) ?? null) : null,
    email: user.email ?? "",
    mustChangePassword: !!m?.must_change_password,
  };
}

// Pode criar/gerir acessos? master: estrategistas e gestores; estrategista: os próprios gestores; gestor: nada.
export const canManageAccess = (role: HubRole) => role === "master" || role === "estrategista";

// Senha provisória fácil de ditar no WhatsApp: sem letras/números parecidos (0/O, 1/l/I).
export function tempPassword(): string {
  const letras = "abcdefghjkmnpqrstuvwxyz";
  const nums = "23456789";
  const pick = (s: string) => s[randomInt(s.length)];
  let p = "";
  for (let i = 0; i < 4; i++) p += pick(letras);
  p = p[0].toUpperCase() + p.slice(1);
  for (let i = 0; i < 4; i++) p += pick(nums);
  return `${p}!`;
}

export { createServiceClient };
