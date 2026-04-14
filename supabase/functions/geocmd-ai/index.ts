import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

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

async function loadPlayerNPCs(playerId: string) {
  const { data } = await supabaseAdmin
    .from("npc_relationships")
    .select("*")
    .eq("player_id", playerId)
    .eq("status", "active")
    .order("trust_score", { ascending: false })
    .limit(5);
  return data || [];
}

function npcContextString(npcs: any[], region?: string): string {
  if (!npcs || npcs.length === 0) return "";
  // Filter NPCs relevant to the region if provided
  const relevant = region
    ? npcs.filter(n => n.origin_region?.toLowerCase().includes(region.toLowerCase()) || n.faction?.toLowerCase().includes(region.toLowerCase()))
    : [];
  const others = npcs.filter(n => !relevant.includes(n));
  const all = [...relevant, ...others].slice(0, 4);
  if (all.length === 0) return "";

  const lines = all.map(n => {
    const trust = n.trust_score > 20 ? "allié" : n.trust_score < -20 ? "hostile" : "neutre";
    const lastInteraction = Array.isArray(n.interactions) && n.interactions.length > 0
      ? n.interactions[n.interactions.length - 1]
      : null;
    const historyNote = lastInteraction?.action
      ? ` Dernière interaction : "${lastInteraction.action}" (${lastInteraction.outcome || "neutre"}).`
      : "";
    return `- ${n.name} (${n.role}, ${n.faction}) — relation: ${trust} (${n.trust_score}/100).${historyNote}`;
  });

  return `\nPERSONNAGES RÉCURRENTS connus du joueur (PNJ) — tu DOIS mentionner au moins 1-2 d'entre eux naturellement dans ta réponse, en cohérence avec leur relation :\n${lines.join("\n")}\n`;
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
        `Tu es un système d'intelligence géopolitique. Réponds UNIQUEMENT en JSON valide, aucun texte autour. Nous sommes en avril 2026. Tu dois te baser sur l'actualité géopolitique ACTUELLE ou TRÈS RÉCENTE (2025-2026). Ne propose JAMAIS de scénarios situés dans le passé (avant 2025).`,
        `Génère exactement 6 scénarios de crises géopolitiques ACTUELLES et RÉELLES dans le monde en ce moment (avril 2026).
RÈGLE ABSOLUE : tous les scénarios doivent se dérouler EN CE MOMENT (avril 2026) ou dans un futur très proche. AUCUN scénario ne doit référencer des dates passées (2024, 2023, etc.). Les descriptions doivent utiliser le présent, pas le passé.
Chaque scénario doit refléter des événements réels et vérifiables de 2025-2026.
JSON (tableau uniquement):
[{"id":"slug-unique","title":"Titre","region":"Zone géographique","type":"conflit armé|tension diplomatique|rivalité économique|crise interne","playerRole":"Rôle du joueur","playerCountry":"Pays","description":"2 phrases factuelles au PRÉSENT basées sur l'actualité réelle d'avril 2026.","urgency":4}]
Urgency 1-5. Varie obligatoirement régions et types. Sois factuel et précis. Utilise le PRÉSENT dans toutes les descriptions.`
      );
      result = parseJSON(raw);

    } else if (type === "briefing") {
      const { scenario, history, playerId } = params;
      const hctx = history?.length
        ? `Décisions précédentes du joueur: ${history.slice(-3).map((h: any) => h.actionLabel).join("; ")}.`
        : "Première session de commandement.";

      // Load NPCs for this player
      let npcCtx = "";
      if (playerId) {
        const npcs = await loadPlayerNPCs(playerId);
        npcCtx = npcContextString(npcs, scenario?.region);
      }

      const raw = await callAI(
        `Tu es un système de briefing d'intelligence classifié de niveau TRÈS SECRET. Réponds UNIQUEMENT en JSON valide. Base-toi sur l'actualité réelle de mars 2026.${npcCtx ? "\n" + npcCtx : ""}`,
        `Génère un briefing d'intelligence basé sur l'actualité RÉELLE et RÉCENTE concernant: "${scenario.title}" (${scenario.playerCountry}).
${hctx}
Le briefing doit contenir des faits réels, des noms de personnes réelles, des lieux précis et des événements vérifiables.${npcCtx ? "\nIMPORTANT : Intègre naturellement les PNJ listés ci-dessus dans la situation ou les développements. Mentionne leur nom et leur attitude envers le joueur." : ""}
JSON: {"classification":"TRÈS SECRET","situation":"2-3 phrases factuelles basées sur l'actualité réelle.","keyDevelopments":["Développement factuel 1","Développement factuel 2","Développement factuel 3"],"assessment":"Analyse stratégique en 2 phrases.","threatLevel":"CRITIQUE|ÉLEVÉ|MODÉRÉ","coords":"Coordonnées GPS pertinentes"}`
      );
      result = parseJSON(raw);

    } else if (type === "actions") {
      const { scenario, briefing, playerId } = params;

      const rolePrompts: Record<string, string> = {
        "Diplomate": "Tu conseilles un diplomate. Privilégie les options diplomatiques et de négociation (au moins 2 sur 4). Les options militaires doivent être défensives ou dissuasives uniquement.",
        "Stratège Militaire": "Tu conseilles un stratège militaire. Privilégie les options militaires et de renseignement (au moins 2 sur 4). Inclus toujours une option de projection de force.",
        "Humanitaire": "Tu conseilles un coordinateur humanitaire. Privilégie les options civiles, humanitaires et économiques (au moins 2 sur 4). Les options militaires doivent concerner la protection des civils ou des corridors humanitaires uniquement.",
        "Analyste Renseignement": "Tu conseilles un analyste renseignement. Privilégie les options de renseignement et d'analyse (au moins 2 sur 4). Inclus toujours une option de collecte d'information ou de cyber-renseignement.",
      };

      const roleCtx = rolePrompts[scenario.playerRole] || "";

      // Load NPCs
      let npcCtx = "";
      if (playerId) {
        const npcs = await loadPlayerNPCs(playerId);
        npcCtx = npcContextString(npcs, scenario?.region);
      }

      const raw = await callAI(
        `Tu es conseiller stratégique senior. Réponds UNIQUEMENT en JSON valide. ${roleCtx}${npcCtx ? "\n" + npcCtx : ""}`,
        `Scénario: ${scenario.title}. Rôle: ${scenario.playerRole} / ${scenario.playerCountry}.
Situation actuelle: ${briefing.situation}${npcCtx ? "\nCertaines options peuvent impliquer les PNJ listés. Mentionne-les naturellement dans les descriptions si pertinent." : ""}
Propose exactement 4 options stratégiques distinctes et réalistes, adaptées à la spécialité "${scenario.playerRole}". JSON:
[{"id":"a1","label":"Nom court de l'action","cat":"militaire|diplomatique|économique|renseignement","catColor":"#ff3344|#00e87a|#c8a84b|#4d8eff","desc":"Description en 1-2 phrases.","risk":"faible|modéré|élevé","outcome":"Résultat projeté en 1 phrase."}]
Catégories et couleurs: militaire=#ff3344, diplomatique=#00e87a, économique=#c8a84b, renseignement=#4d8eff.`
      );
      result = parseJSON(raw);

    } else if (type === "consequence") {
      const { scenario, action, playerId } = params;

      // Load NPCs
      let npcCtx = "";
      if (playerId) {
        const npcs = await loadPlayerNPCs(playerId);
        npcCtx = npcContextString(npcs, scenario?.region);
      }

      const raw = await callAI(
        `Tu es un système de simulation géopolitique réaliste. Réponds UNIQUEMENT en JSON valide.${npcCtx ? "\n" + npcCtx : ""}`,
        `Scénario: ${scenario.title}. Rôle: ${scenario.playerRole}.
Action décidée: ${action.label} — ${action.desc || ""}
Catégorie de l'action: ${action.cat || "inconnue"}
Résultat projeté: ${action.outcome}${npcCtx ? "\nIntègre les PNJ dans la narrative. Indique dans 'npcUpdates' comment chaque PNJ pertinent réagit (changement de confiance)." : ""}
Génère une conséquence réaliste et nuancée avec l'impact sur 4 indicateurs d'influence géopolitique (chaque delta entre -15 et +15, la somme ne doit PAS toujours être positive). JSON:
{"headline":"Titre accrocheur de type dépêche","narrative":"2-3 phrases réalistes décrivant les conséquences.","metrics":[{"label":"Indicateur","change":"+12%","positive":true}],"scoreDeltas":{"stability":5,"diplomacy":-3,"military":8,"intelligence":-2}${npcCtx ? ',"npcUpdates":[{"name":"Nom du PNJ","trustDelta":5,"reaction":"Phrase de réaction du PNJ"}],"newNPC":{"name":"Nouveau personnage si pertinent","role":"Son rôle","faction":"Son pays/org","trust_score":10}' : ''}}`
      );
      result = parseJSON(raw);

      // Process NPC updates from consequence
      if (playerId && result) {
        try {
          const r = result as any;
          // Update existing NPC trust scores
          if (Array.isArray(r.npcUpdates)) {
            for (const upd of r.npcUpdates) {
              if (!upd.name || upd.trustDelta === undefined) continue;
              const { data: existing } = await supabaseAdmin
                .from("npc_relationships")
                .select("id, trust_score, interactions")
                .eq("player_id", playerId)
                .ilike("name", `%${upd.name}%`)
                .eq("status", "active")
                .limit(1);
              if (existing && existing.length > 0) {
                const npc = existing[0];
                const newTrust = Math.max(-100, Math.min(100, (npc.trust_score || 0) + (upd.trustDelta || 0)));
                const interactions = Array.isArray(npc.interactions) ? npc.interactions : [];
                interactions.push({
                  action: action.label,
                  outcome: upd.reaction || "",
                  date: new Date().toISOString(),
                  theater: scenario.title,
                });
                await supabaseAdmin
                  .from("npc_relationships")
                  .update({ trust_score: newTrust, interactions, updated_at: new Date().toISOString() })
                  .eq("id", npc.id);
              }
            }
          }
          // Create new NPC if suggested
          if (r.newNPC?.name && r.newNPC?.role) {
            // Check we don't already have this NPC
            const { data: dup } = await supabaseAdmin
              .from("npc_relationships")
              .select("id")
              .eq("player_id", playerId)
              .ilike("name", `%${r.newNPC.name}%`)
              .limit(1);
            if (!dup || dup.length === 0) {
              // Check total count (max 5 active)
              const { count } = await supabaseAdmin
                .from("npc_relationships")
                .select("id", { count: "exact", head: true })
                .eq("player_id", playerId)
                .eq("status", "active");
              if ((count || 0) < 5) {
                await supabaseAdmin.from("npc_relationships").insert({
                  player_id: playerId,
                  name: r.newNPC.name,
                  role: r.newNPC.role,
                  faction: r.newNPC.faction || scenario.playerCountry,
                  trust_score: r.newNPC.trust_score || 0,
                  origin_region: scenario.region || "Inconnu",
                  interactions: [{ action: action.label, outcome: "Premier contact", date: new Date().toISOString(), theater: scenario.title }],
                });
              }
            }
          }
        } catch (npcErr) {
          console.error("NPC update error (non-fatal):", npcErr);
        }
      }

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
