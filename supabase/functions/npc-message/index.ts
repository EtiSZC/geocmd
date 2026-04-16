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

async function callAI(system: string, user: string, model = "google/gemini-2.5-flash"): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (resp.status === 429) throw new Error("RATE_LIMITED");
  if (resp.status === 402) throw new Error("CREDITS_EXHAUSTED");
  if (!resp.ok) throw new Error(`AI error: ${resp.status}`);

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

async function generatePortrait(name: string, role: string, faction: string): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;

  try {
    const resp = await fetch(AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [
          {
            role: "user",
            content: `Generate a pixel art portrait, 48x48 pixels style, of a ${role} from ${faction} faction. Dark background, retro game style, military/political character. Name: ${name}. Single face portrait, front-facing, simple pixel art aesthetic.`,
          },
        ],
        modalities: ["image", "text"],
      }),
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    return imageUrl || null;
  } catch {
    return null;
  }
}

function getTrustLevel(trustScore: number): string {
  if (trustScore > 30) return "allié";
  if (trustScore < -30) return "hostile";
  return "neutre";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { player_id } = await req.json();
    if (!player_id) {
      return new Response(JSON.stringify({ success: false, error: "player_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 50% random chance to skip (keeps messages rare/surprising)
    if (Math.random() < 0.5) {
      return new Response(JSON.stringify({ success: true, data: null, reason: "skipped" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cooldown: no message in the last 12 hours for this player
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { data: recentMessages } = await supabaseAdmin
      .from("npc_messages")
      .select("id")
      .eq("player_id", player_id)
      .gte("created_at", twelveHoursAgo)
      .limit(1);

    if (recentMessages && recentMessages.length > 0) {
      return new Response(JSON.stringify({ success: true, data: null, reason: "cooldown" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load active NPCs
    const { data: npcs } = await supabaseAdmin
      .from("npc_relationships")
      .select("*")
      .eq("player_id", player_id)
      .eq("status", "active")
      .order("trust_score", { ascending: false })
      .limit(10);

    if (!npcs || npcs.length === 0) {
      return new Response(JSON.stringify({ success: true, data: null, reason: "no_npcs" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pick a random NPC
    const npc = npcs[Math.floor(Math.random() * npcs.length)];
    const trustLevel = getTrustLevel(npc.trust_score);

    // Load recent player actions for context
    const { data: recentTheaters } = await supabaseAdmin
      .from("theaters")
      .select("scenario, history")
      .eq("player_id", player_id)
      .order("updated_at", { ascending: false })
      .limit(2);

    const { data: recentFlash } = await supabaseAdmin
      .from("flash_event_responses")
      .select("chosen_option, risk_outcome")
      .eq("player_id", player_id)
      .order("responded_at", { ascending: false })
      .limit(3);

    // Build context for AI
    let recentActionsContext = "";
    if (recentTheaters?.length) {
      const actions = recentTheaters.flatMap((t: any) => {
        const hist = Array.isArray(t.history) ? t.history : [];
        const region = t.scenario?.region || "inconnue";
        return hist.slice(-2).map((h: any) => `Action "${h.actionLabel}" dans la région ${region}`);
      });
      if (actions.length) recentActionsContext += "Actions récentes sur théâtres:\n" + actions.join("\n") + "\n";
    }
    if (recentFlash?.length) {
      const flashCtx = recentFlash.map((r: any) => {
        const optLabel = r.chosen_option?.label || r.chosen_option?.id || "?";
        return `Réponse flash "${optLabel}" → ${r.risk_outcome || "?"}`;
      });
      recentActionsContext += "Réponses flash récentes:\n" + flashCtx.join("\n");
    }

    // Generate message via AI
    const toneGuide = trustLevel === "allié"
      ? "Ton chaleureux, partage d'informations, encouragements, complicité. Tutoiement possible."
      : trustLevel === "hostile"
        ? "Ton menaçant, avertissements, provocations subtiles, méfiance. Vouvoiement distant."
        : "Ton professionnel, observations détachées, neutralité prudente. Vouvoiement poli.";

    const system = `Tu es un PNJ (personnage non-joueur) dans un jeu de simulation géopolitique se déroulant en avril 2026.
Tu incarnes ${npc.name}, ${npc.role} de la faction "${npc.faction}", originaire de la région ${npc.origin_region}.
Ton niveau de confiance envers le joueur est: ${trustLevel} (score: ${npc.trust_score}).
${toneGuide}
Écris un court message (2-4 phrases) que tu enverrais au joueur via un canal de communication sécurisé.
Le message doit être immersif, en français, et refléter ta relation avec le joueur.
Si des actions récentes du joueur sont mentionnées, tu peux y faire référence subtilement.
NE PAS inclure de salutation formelle type "Cher...", va droit au but comme un vrai message chiffré.
Réponds UNIQUEMENT avec le texte du message, rien d'autre.`;

    const userPrompt = `Génère un message de ${npc.name} (${npc.role}, ${npc.faction}, relation: ${trustLevel}).
${recentActionsContext ? "\nContexte des actions récentes du joueur:\n" + recentActionsContext : ""}`;

    const message = await callAI(system, userPrompt);

    // Generate portrait if NPC doesn't have one
    let portraitBase64 = npc.portrait_base64 || null;
    if (!portraitBase64) {
      portraitBase64 = await generatePortrait(npc.name, npc.role, npc.faction);
      if (portraitBase64) {
        await supabaseAdmin
          .from("npc_relationships")
          .update({ portrait_base64: portraitBase64 })
          .eq("id", npc.id);
      }
    }

    // Insert message
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("npc_messages")
      .insert({
        player_id,
        npc_id: npc.id,
        npc_name: npc.name,
        npc_faction: npc.faction,
        trust_level: trustLevel,
        message: message.trim(),
        portrait_url: portraitBase64,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ success: true, data: inserted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("npc-message error:", e);
    const status = e.message === "RATE_LIMITED" ? 429 : e.message === "CREDITS_EXHAUSTED" ? 402 : 500;
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
