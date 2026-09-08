import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return { supabase, user };
}

export async function getUserMetaToken(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("user_meta_credentials")
    .select("access_token")
    .eq("user_id", userId)
    .maybeSingle();
  const token = data?.access_token as string | undefined;
  if (!token) {
    throw new Error("Cadastre seu token Meta em Configurações → Meta para ver as contas.");
  }
  return token;
}
