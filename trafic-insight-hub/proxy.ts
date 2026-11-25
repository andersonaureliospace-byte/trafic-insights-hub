import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { OPERATIONAL_STANDBY } from "@/lib/estrategia/auditorias/config";

// Etapa 257: telas do Hub operacional em standby — abrem o Hub estratégico. Configurações (Meta/WhatsApp) continua aberta.
const STANDBY_PREFIXES = ["/painel", "/mensagens", "/auditoria", "/foco", "/crm", "/corrida"];

// Rotas que não exigem login.
// Etapa 221: /sw.js e /manifest.webmanifest são do app no celular e precisam abrir sem login.
const PUBLIC_PATHS = ["/login", "/esqueci-senha", "/redefinir-senha", "/sw.js", "/manifest.webmanifest"];
const isPublicApi = (pathname: string) =>
  pathname.startsWith("/c/") ||
  pathname.startsWith("/api/public") ||
  pathname.startsWith("/auth/callback");

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.includes(pathname) || isPublicApi(pathname);

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Etapa 351: senha provisória → só a tela de criar a senha (e a rota que salva) até trocar.
  const TROCA_PATHS = ["/trocar-senha", "/api/acessos/trocar-senha"];
  if (user && user.app_metadata?.must_change_password === true && !isPublicPath && !TROCA_PATHS.includes(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Crie sua senha antes de continuar." }, { status: 403 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/trocar-senha";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Etapa 352: GESTOR — só a tela de Acompanhamento (abas Contas e Ontem × hoje) e as rotas que ela usa.
  // Tudo o mais (Feedback, Disparos, Configurações, Alertas, ficha do cliente, Hub operacional, app /m) fica fechado,
  // na tela E na API (não adianta digitar o endereço). As rotas liberadas ainda filtram só as contas dele.
  if (user && user.app_metadata?.hub_role === "gestor" && !isPublicPath) {
    const method = request.method.toUpperCase();
    const okApi =
      (method === "GET" && ["/api/selected-accounts", "/api/account-bindings", "/api/analysis/offers"].includes(pathname)) ||
      // Etapa 354: Cobranças (saldo) das contas dele — ver e configurar
      ((method === "GET" || method === "PATCH") && pathname === "/api/pix-accounts") ||
      (method === "POST" && pathname === "/api/estrategia/alertas") ||
      ((method === "GET" || method === "PUT") && pathname === "/api/estrategia/prefs") ||
      (method === "POST" &&
        ["/api/estrategia/hoje", "/api/estrategia/orcamento", "/api/estrategia/otimizacoes", "/api/acessos/trocar-senha"].includes(pathname));
    const okPage = pathname === "/estrategia/trafego" || pathname === "/estrategia/configuracoes/cobrancas" || pathname === "/trocar-senha";
    if (pathname.startsWith("/api/")) {
      if (!okApi) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    } else if (!okPage) {
      const url = request.nextUrl.clone();
      url.pathname = "/estrategia/trafego";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // Etapa 353: ESTRATEGISTA (criado pelo master) — tudo do Hub, menos as Automações (só o master configura).
  if (user && user.app_metadata?.hub_role === "estrategista") {
    const soMaster = ["/estrategia/configuracoes/automacoes", "/api/estrategia/auditorias", "/api/automation-runs", "/api/standby"];
    if (soMaster.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Só o master mexe nas Automações." }, { status: 403 });
      const url = request.nextUrl.clone();
      url.pathname = "/estrategia/configuracoes";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (user && OPERATIONAL_STANDBY && STANDBY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/estrategia/trafego";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/estrategia/trafego"; // Etapa 238: Hub estratégico é a tela inicial
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
