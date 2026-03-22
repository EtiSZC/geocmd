import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callAI(system: string, user: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.error("AI gateway error:", resp.status, t);
    if (resp.status === 429) throw new Error("RATE_LIMITED");
    if (resp.status === 402) throw new Error("PAYMENT_REQUIRED");
    throw new Error(`AI error ${resp.status}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

function parseJSON(raw: string) {
  try {
    const m = raw.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || raw.match(/(\[[\s\S]*?\]|\{[\s\S]*?\})/s);
    return JSON.parse(m ? m[1] : raw);
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, ...params } = await req.json();

    let result: unknown = null;

    if (type === "scenarios") {
      const raw = await callAI(
        `Tu es un système d'intelligence géopolitique. Réponds UNIQUEMENT en JSON valide, aucun texte autour. Tu dois te baser sur l'actualité géopolitique réelle et récente de mars 2026.`,
        `Génère exactement 6 scénarios de crises géopolitiques ACTUELLES et RÉELLES dans le monde en ce moment (mars 2026).
Chaque scénario doit refléter des événements réels et vérifiables.
JSON (tableau uniquement):
[{"id":"slug-unique","title":"Titre","region":"Zone géographique","type":"conflit armé|tension diplomatique|rivalité économique|crise interne","playerRole":"Rôle du joueur","playerCountry":"Pays","description":"2 phrases factuelles basées sur l'actualité réelle de mars 2026.","urgency":4}]
Urgency 1-5. Varie obligatoirement régions et types. Sois factuel et précis.`
      );
      result = parseJSON(raw);

    } else if (type === "briefing") {
      const { scenario, history } = params;
      const hctx = history?.length
        ? `Décisions précédentes du joueur: ${history.slice(-3).map((h: any) => h.actionLabel).join("; ")}.`
        : "Première session de commandement.";

      const raw = await callAI(
        `Tu es un système de briefing d'intelligence classifié de niveau TRÈS SECRET. Réponds UNIQUEMENT en JSON valide. Base-toi sur l'actualité réelle de mars 2026.`,
        `Génère un briefing d'intelligence basé sur l'actualité RÉELLE et RÉCENTE concernant: "${scenario.title}" (${scenario.playerCountry}).
${hctx}
Le briefing doit contenir des faits réels, des noms de personnes réelles, des lieux précis et des événements vérifiables.
JSON: {"classification":"TRÈS SECRET","situation":"2-3 phrases factuelles basées sur l'actualité réelle.","keyDevelopments":["Développement factuel 1","Développement factuel 2","Développement factuel 3"],"assessment":"Analyse stratégique en 2 phrases.","threatLevel":"CRITIQUE|ÉLEVÉ|MODÉRÉ","coords":"Coordonnées GPS pertinentes"}`
      );
      result = parseJSON(raw);

    } else if (type === "actions") {
      const { scenario, briefing } = params;
      const raw = await callAI(
        `Tu es conseiller stratégique senior auprès d'un chef d'État. Réponds UNIQUEMENT en JSON valide.`,
        `Scénario: ${scenario.title}. Rôle: ${scenario.playerRole} / ${scenario.playerCountry}.
Situation actuelle: ${briefing.situation}
Propose exactement 4 options stratégiques distinctes et réalistes. JSON:
[{"id":"a1","label":"Nom court de l'action","cat":"militaire|diplomatique|économique|renseignement","catColor":"#ff3344|#00e87a|#c8a84b|#4d8eff","desc":"Description en 1-2 phrases.","risk":"faible|modéré|élevé","outcome":"Résultat projeté en 1 phrase."}]
Catégories et couleurs: militaire=#ff3344, diplomatique=#00e87a, économique=#c8a84b, renseignement=#4d8eff.`
      );
      result = parseJSON(raw);

    } else if (type === "consequence") {
      const { scenario, action } = params;
      const raw = await callAI(
        `Tu es un système de simulation géopolitique réaliste. Réponds UNIQUEMENT en JSON valide.`,
        `Scénario: ${scenario.title}. Rôle: ${scenario.playerRole}.
Action décidée: ${action.label} — ${action.desc || ""}
Résultat projeté: ${action.outcome}
Génère une conséquence réaliste et nuancée. JSON:
{"headline":"Titre accrocheur de type dépêche","narrative":"2-3 phrases réalistes décrivant les conséquences.","metrics":[{"label":"Indicateur","change":"+12%","positive":true}]}`
      );
      result = parseJSON(raw);

    } else {
      return new Response(JSON.stringify({ error: "Unknown type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("geocmd-ai error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg === "RATE_LIMITED" ? 429 : msg === "PAYMENT_REQUIRED" ? 402 : 500;
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
