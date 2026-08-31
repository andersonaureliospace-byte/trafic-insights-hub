import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Cliente Supabase para uso em Server Components, Server Actions e Route Handlers.
// Lê/escreve a sessão via cookies do Next.js.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Chamado a partir de um Server Component — o middleware já
            // cuida de renovar a sessão, então pode ignorar aqui.
          }
        },
      },
    },
  );
}

// Cliente com a service role key — só para uso em Route Handlers que
// precisam ignorar RLS (ex.: os links públicos /d/:token e /c/:token,
// e os endpoints que o n8n chama). Nunca importar isso em código de cliente.
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
