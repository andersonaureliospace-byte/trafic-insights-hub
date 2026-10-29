import { NextResponse } from "next/server";
import { requireUser, getUserMetaToken } from "@/lib/current-user";
import { metaGet } from "@/lib/meta/client";

// Etapa 229: Análise → "Conjuntos da conta" — todas as configurações de UM conjunto (busca só ao abrir o conjunto):
// campanha, otimização, orçamento, agenda, público (idade, gênero, locais, interesses), posicionamentos e o número
// do WhatsApp. O número vem do conjunto (promoted_object); se não vier, procura no criativo e, por último, na página.
export const maxDuration = 30;

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const str = (v: unknown) => (v == null ? "" : String(v));

const GOAL: Record<string, string> = {
  CONVERSATIONS: "Conversas",
  REPLIES: "Respostas",
  LEAD_GENERATION: "Leads",
  QUALITY_LEAD: "Leads qualificados",
  OFFSITE_CONVERSIONS: "Conversões",
  LINK_CLICKS: "Cliques no link",
  LANDING_PAGE_VIEWS: "Visualizações da página",
  REACH: "Alcance",
  IMPRESSIONS: "Impressões",
  THRUPLAY: "ThruPlay",
  POST_ENGAGEMENT: "Engajamento",
  PROFILE_VISIT: "Visitas ao perfil",
  VALUE: "Valor",
};
const BID: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: "Volume mais alto (menor custo)",
  LOWEST_COST_WITH_BID_CAP: "Limite de lance",
  COST_CAP: "Meta de custo por resultado",
  LOWEST_COST_WITH_MIN_ROAS: "ROAS mínimo",
};
const DEST: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  MESSENGER: "Messenger",
  INSTAGRAM_DIRECT: "Direct do Instagram",
  MESSAGING_MESSENGER_WHATSAPP: "Messenger + WhatsApp",
  MESSAGING_INSTAGRAM_DIRECT_WHATSAPP: "Instagram + WhatsApp",
  MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP: "Messenger + Instagram + WhatsApp",
  MESSAGING_INSTAGRAM_DIRECT_MESSENGER: "Messenger + Instagram",
  WEBSITE: "Site",
  ON_AD: "Formulário (no anúncio)",
  UNDEFINED: "—",
};
const OBJECTIVE: Record<string, string> = {
  OUTCOME_ENGAGEMENT: "Engajamento",
  OUTCOME_LEADS: "Cadastros",
  OUTCOME_SALES: "Vendas",
  OUTCOME_TRAFFIC: "Tráfego",
  OUTCOME_AWARENESS: "Reconhecimento",
  OUTCOME_APP_PROMOTION: "Promoção do app",
  MESSAGES: "Mensagens",
};
const POS: Record<string, string> = {
  feed: "Feed",
  story: "Stories",
  reels: "Reels",
  facebook_reels: "Reels",
  stream: "Feed",
  explore: "Explorar",
  explore_home: "Explorar (início)",
  marketplace: "Marketplace",
  video_feeds: "Vídeos",
  search: "Pesquisa",
  right_hand_column: "Coluna da direita",
  instream_video: "Vídeos in-stream",
  profile_feed: "Feed do perfil",
  ig_search: "Pesquisa",
  notification: "Notificações",
  messenger_home: "Início do Messenger",
  sponsored_messages: "Mensagens patrocinadas",
};

function km(radius: unknown, unit: unknown): string {
  if (radius == null) return "";
  return ` (+${radius} ${str(unit) === "mile" ? "mi" : "km"})`;
}

function locations(g: Obj | undefined): string[] {
  if (!g) return [];
  const out: string[] = [];
  for (const c of arr(g.countries as unknown)) out.push(str(c));
  for (const r of arr(g.regions)) out.push(str(r.name));
  for (const c of arr(g.cities)) out.push(`${str(c.name)}${c.region ? ` - ${str(c.region)}` : ""}${km(c.radius, c.distance_unit)}`);
  for (const c of arr(g.custom_locations)) {
    const label = str(c.name || c.address_string) || `${Number(c.latitude).toFixed(4)}, ${Number(c.longitude).toFixed(4)}`;
    out.push(`📍 ${label}${km(c.radius, c.distance_unit)}`);
  }
  for (const z of arr(g.zips)) out.push(`CEP ${str(z.name || z.key)}`);
  for (const p of arr(g.places)) out.push(`📍 ${str(p.name)}${km(p.radius, p.distance_unit)}`);
  return out.filter(Boolean);
}

function positions(t: Obj): string[] {
  const plat = (t.publisher_platforms as string[] | undefined) ?? [];
  if (!plat.length) return ["Automático (Advantage+)"];
  const name: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", messenger: "Messenger", audience_network: "Audience Network", threads: "Threads" };
  return plat.map((p) => {
    const list = (t[`${p}_positions`] as string[] | undefined) ?? [];
    const parts = [...new Set(list.map((x) => POS[x] ?? x))];
    return `${name[p] ?? p}${parts.length ? `: ${parts.join(", ")}` : " (todos)"}`;
  });
}

// Acha o número do WhatsApp em qualquer lugar de um objeto (criativo).
function findWhatsapp(v: unknown, depth = 0): string | null {
  if (!v || typeof v !== "object" || depth > 8) return null;
  for (const [k, x] of Object.entries(v as Obj)) {
    if (/whatsapp_(phone_)?number/i.test(k) && x && typeof x !== "object") return String(x);
    const deep = findWhatsapp(x, depth + 1);
    if (deep) return deep;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const token = await getUserMetaToken(supabase, user.id);
    const body = (await request.json()) as { adsetId?: string };
    const adsetId = String(body.adsetId ?? "").trim();
    if (!adsetId) throw new Error("Conjunto obrigatório.");

    const a = await metaGet<Obj>(token, `/${adsetId}`, {
      fields:
        "name,effective_status,created_time,start_time,end_time,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,bid_amount,destination_type,promoted_object,targeting,attribution_spec,campaign{name,objective,daily_budget,bid_strategy,effective_status}",
    });
    const t = (a.targeting as Obj | undefined) ?? {};
    const promoted = (a.promoted_object as Obj | undefined) ?? {};
    const campaign = (a.campaign as Obj | undefined) ?? {};

    // WhatsApp: conjunto → criativo → página.
    let whatsapp: string | null = str(promoted.whatsapp_phone_number) || null;
    let whatsappSource: "conjunto" | "criativo" | "pagina" | null = whatsapp ? "conjunto" : null;
    const pageId = str(promoted.page_id) || null;
    let pageName: string | null = null;
    if (!whatsapp) {
      try {
        const ads = await metaGet<{ data?: Obj[] }>(token, `/${adsetId}/ads`, {
          fields: "creative{object_story_spec,asset_feed_spec}",
          limit: "5",
        });
        for (const ad of ads.data ?? []) {
          const n = findWhatsapp(ad.creative);
          if (n) {
            whatsapp = n;
            whatsappSource = "criativo";
            break;
          }
        }
      } catch {
        /* sem acesso aos criativos: segue */
      }
    }
    if (pageId) {
      try {
        const p = await metaGet<Obj>(token, `/${pageId}`, { fields: whatsapp ? "name" : "name,whatsapp_number" });
        pageName = str(p.name) || null;
        if (!whatsapp && p.whatsapp_number) {
          whatsapp = str(p.whatsapp_number);
          whatsappSource = "pagina";
        }
      } catch {
        try {
          const p = await metaGet<Obj>(token, `/${pageId}`, { fields: "name" });
          pageName = str(p.name) || null;
        } catch {
          /* sem acesso à página */
        }
      }
    }

    const interests: string[] = [];
    for (const spec of arr(t.flexible_spec)) {
      for (const [k, v] of Object.entries(spec)) {
        if (Array.isArray(v)) for (const x of v as Obj[]) if (x?.name) interests.push(`${str(x.name)}${k === "interests" ? "" : ` (${k})`}`);
      }
    }
    const genders = (t.genders as number[] | undefined) ?? [];
    const daily = Number(a.daily_budget ?? 0);
    const lifetime = Number(a.lifetime_budget ?? 0);
    const campDaily = Number(campaign.daily_budget ?? 0);

    return NextResponse.json({
      name: str(a.name),
      status: str(a.effective_status),
      campaign: {
        name: str(campaign.name),
        objective: OBJECTIVE[str(campaign.objective)] ?? str(campaign.objective),
        status: str(campaign.effective_status),
      },
      budget:
        daily > 0
          ? `R$ ${(daily / 100).toFixed(2).replace(".", ",")} por dia (no conjunto)`
          : lifetime > 0
            ? `R$ ${(lifetime / 100).toFixed(2).replace(".", ",")} total (vitalício)`
            : campDaily > 0
              ? `R$ ${(campDaily / 100).toFixed(2).replace(".", ",")} por dia (na campanha — CBO)`
              : "—",
      bidStrategy: BID[str(a.bid_strategy || campaign.bid_strategy)] ?? (str(a.bid_strategy || campaign.bid_strategy) || "—"),
      bidAmount: a.bid_amount ? Number(a.bid_amount) / 100 : null,
      optimization: GOAL[str(a.optimization_goal)] ?? str(a.optimization_goal),
      destination: DEST[str(a.destination_type)] ?? (str(a.destination_type) || "—"),
      whatsapp,
      whatsappSource,
      page: pageName,
      createdTime: str(a.created_time) || null,
      startTime: str(a.start_time) || null,
      endTime: str(a.end_time) || null,
      age: `${str(t.age_min || 18)}–${str(t.age_max || 65)}`,
      advantage: Number((t.targeting_automation as Obj | undefined)?.advantage_audience ?? 0) === 1,
      genders: genders.length === 1 ? (genders[0] === 1 ? "Homens" : "Mulheres") : "Todos",
      locations: locations(t.geo_locations as Obj | undefined),
      locationTypes: ((t.geo_locations as Obj | undefined)?.location_types as string[] | undefined) ?? [],
      excludedLocations: locations(t.excluded_geo_locations as Obj | undefined),
      interests,
      audiences: arr(t.custom_audiences).map((x) => str(x.name || x.id)),
      excludedAudiences: arr(t.excluded_custom_audiences).map((x) => str(x.name || x.id)),
      placements: positions(t),
      devices: ((t.device_platforms as string[] | undefined) ?? []).map((d) => (d === "mobile" ? "Celular" : d === "desktop" ? "Computador" : d)),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
