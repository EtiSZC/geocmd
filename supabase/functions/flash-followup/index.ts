import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const { parent_event_id, parent_option, player_id, risk_outcome } = await req.json();
    if (!parent_event_id || !parent_option || !player_id) {
      return new Response(JSON.stringify({ error: "Missing params" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch the parent event for context
    const { data: parentEvent } = await sb.from("flash_events").select("*").eq("id", parent_event_id).single();
    if (!parentEvent) throw new Error("Parent event not found");

    const outcomeLabel = risk_outcome === "success" ? "un succès total" : risk_outcome === "partial" ? "un succès partiel" : "un échec";

    const aiResp = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `Tu es un système de simulation de crises géopolitiques. Réponds UNIQUEMENT en JSON valide, aucun texte autour. Tu génères des événements de suivi (ondes de choc) qui sont les conséquences directes d'une décision précédente.`,
          },
          {
            role: "user",
            content: `Contexte : Le joueur a fait face à la crise "${parentEvent.title}" (${parentEvent.region}, ${parentEvent.event_type}).
Description : ${parentEvent.description}
Il a choisi l'action "${parent_option.label}" (${parent_option.cat}, risque ${parent_option.risk}).
Le résultat a été ${outcomeLabel}.

Génère un événement de suivi (onde de choc) qui est la conséquence DIRECTE de cette décision. L'événement doit être cohérent et surprenant.

JSON: {"title":"Titre court avec ⚡ ONDE DE CHOC","description":"Description en 2-3 phrases expliquant la conséquence.","region":"${parentEvent.region}","event_type":"militaire|diplomatique|économique|humanitaire","urgency":3,"options":[{"id":"opt1","label":"Action 1","desc":"Description","cat":"militaire|diplomatique|économique|renseignement","risk":"faible|modéré|élevé","scoreDeltas":{"stability":0,"diplomacy":0,"military":0,"intelligence":0}},{"id":"opt2","label":"Action 2","desc":"Description","cat":"...","risk":"...","scoreDeltas":{...}},{"id":"opt3","label":"Action 3","desc":"Description","cat":"...","risk":"...","scoreDeltas":{...}}]}

Urgency 3-5. Exactement 3 options. scoreDeltas entre -10 et +10.`,
          },
        ],
      }),
    });

    if (!aiResp.ok) throw new Error(`AI error ${aiResp.status}`);

    const aiData = await aiResp.json();
    const raw = aiData.choices?.[0]?.message?.content || "";
    let parsed;
    try {
      const m = raw.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || raw.match(/(\{[\s\S]*?\})/s);
      parsed = JSON.parse(m ? m[1] : raw);
    } catch {
      parsed = {
        title: "⚡ Onde de choc — Répercussions",
        description: `Suite à votre décision concernant "${parentEvent.title}", de nouvelles tensions émergent dans la région.`,
        region: parentEvent.region,
        event_type: parentEvent.event_type,
        urgency: 4,
        options: [
          { id: "opt1", label: "Diplomatie d'urgence", desc: "Tenter de désamorcer par la voie diplomatique.", cat: "diplomatique", risk: "faible", scoreDeltas: { stability: 3, diplomacy: 5, military: 0, intelligence: -1 } },
          { id: "opt2", label: "Renforcement défensif", desc: "Sécuriser la zone et montrer sa force.", cat: "militaire", risk: "modéré", scoreDeltas: { stability: -2, diplomacy: -3, military: 6, intelligence: 2 } },
          { id: "opt3", label: "Infiltration discrète", desc: "Envoyer des agents pour évaluer la situation.", cat: "renseignement", risk: "élevé", scoreDeltas: { stability: 0, diplomacy: -1, military: 2, intelligence: 8 } },
        ],
      };
    }

    // Follow-up expires in 2h, insert with parent reference and target player
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { data: followUp, error: insertErr } = await sb.from("flash_events").insert({
      title: parsed.title,
      description: parsed.description,
      region: parsed.region,
      event_type: parsed.event_type,
      urgency: parsed.urgency || 4,
      options: parsed.options || [],
      expires_at: expiresAt,
      parent_event_id: parent_event_id,
      parent_option_id: parent_option.id,
      target_player_id: player_id,
    }).select().single();

    if (insertErr) throw insertErr;

    return new Response(JSON.stringify({ success: true, data: followUp }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("flash-followup error:", e);
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
