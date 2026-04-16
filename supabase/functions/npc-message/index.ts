import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const VAPID_PUBLIC_KEY = "BH4pO72nfLseaBl-9cvw1mNqpg6HcRPNDwrrS1-qiZiFZrJB9ikMCxwot-AKrPt_Lz089a99rdhwq3c2H7kpnng";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ---- Web Push Encryption (RFC 8291 + VAPID) ----
function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
function base64urlEncode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((a, b) => a + b.length, 0);
  const result = new Uint8Array(len);
  let offset = 0;
  for (const arr of arrays) { result.set(arr, offset); offset += arr.length; }
  return result;
}
async function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const saltKey = await crypto.subtle.importKey("raw", salt.length ? salt : new Uint8Array(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", saltKey, ikm));
  const prkKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const okm = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, concat(info, new Uint8Array([1]))));
  return okm.slice(0, length);
}
async function encryptPayload(plaintext: Uint8Array, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<Uint8Array> {
  const clientPubBytes = urlBase64ToUint8Array(subscription.keys.p256dh);
  const authSecret = urlBase64ToUint8Array(subscription.keys.auth);
  const localKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", localKeyPair.publicKey));
  const clientPubKey = await crypto.subtle.importKey("raw", clientPubBytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientPubKey }, localKeyPair.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikmInfo = concat(new TextEncoder().encode("WebPush: info\0"), clientPubBytes, localPubRaw);
  const ikm = await hkdfSha256(sharedSecret, authSecret, ikmInfo, 32);
  const cek = await hkdfSha256(ikm, salt, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfSha256(ikm, salt, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
  const padded = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([65]), localPubRaw, ciphertext);
}
async function createVapidJwt(endpoint: string, privKeyB64: string, pubKeyB64: string): Promise<string> {
  const audience = new URL(endpoint).origin;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const headerB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify({ aud: audience, exp: expiry, sub: "mailto:admin@geocmd.app" })));
  const unsigned = `${headerB64}.${payloadB64}`;
  const pubBytes = urlBase64ToUint8Array(pubKeyB64);
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", d: privKeyB64, x: base64urlEncode(pubBytes.slice(1, 33)), y: base64urlEncode(pubBytes.slice(33, 65)) }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned)));
  let r: Uint8Array, s: Uint8Array;
  if (sig[0] === 0x30) {
    const rLen = sig[3]; const rBytes = sig.slice(4, 4 + rLen);
    const sLen = sig[4 + rLen + 1]; const sBytes = sig.slice(4 + rLen + 2, 4 + rLen + 2 + sLen);
    r = rBytes.length > 32 ? rBytes.slice(rBytes.length - 32) : rBytes;
    s = sBytes.length > 32 ? sBytes.slice(sBytes.length - 32) : sBytes;
    if (r.length < 32) { const p = new Uint8Array(32); p.set(r, 32 - r.length); r = p; }
    if (s.length < 32) { const p = new Uint8Array(32); p.set(s, 32 - s.length); s = p; }
  } else { r = sig.slice(0, 32); s = sig.slice(32, 64); }
  const rawSig = new Uint8Array(64); rawSig.set(r, 0); rawSig.set(s, 32);
  return `vapid t=${unsigned}.${base64urlEncode(rawSig)}, k=${pubKeyB64}`;
}
async function sendPush(sub: any, payload: any, privKey: string, pubKey: string): Promise<boolean> {
  try {
    const encrypted = await encryptPayload(new TextEncoder().encode(JSON.stringify(payload)), sub);
    const auth = await createVapidJwt(sub.endpoint, privKey, pubKey);
    const resp = await fetch(sub.endpoint, {
      method: "POST",
      headers: { Authorization: auth, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "Content-Length": String(encrypted.length), TTL: "86400" },
      body: encrypted,
    });
    if (!resp.ok) { console.error("Push failed:", resp.status, await resp.text()); return false; }
    return true;
  } catch (e) { console.error("Push error:", e); return false; }
}

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

async function generateForPlayer(player_id: string, opts: { skipRandom?: boolean } = {}): Promise<{ success: boolean; data?: any; reason?: string; error?: string }> {
  // 50% random skip unless forced (cron path skips this gate)
  if (!opts.skipRandom && Math.random() < 0.5) {
    return { success: true, reason: "skipped" };
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
    return { success: true, reason: "cooldown" };
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
    return { success: true, reason: "no_npcs" };
  }

  const npc = npcs[Math.floor(Math.random() * npcs.length)];
  const trustLevel = getTrustLevel(npc.trust_score);

  // Recent context
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

  // Send push notification (best-effort)
  try {
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    if (VAPID_PRIVATE_KEY) {
      const { data: subs } = await supabaseAdmin
        .from("push_subscriptions")
        .select("subscription, notify_npc")
        .eq("player_id", player_id);
      const targets = (subs || []).filter((r: any) => r.notify_npc !== false);
      if (targets.length) {
        const payload = {
          title: `📡 MESSAGE — ${npc.name}`,
          body: message.trim().slice(0, 140),
          tag: `npc-${inserted.id}`,
          url: "/",
        };
        await Promise.all(targets.map((t: any) => sendPush(t.subscription, payload, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY)));
      }
    }
  } catch (e) {
    console.error("npc-message push error:", e);
  }

  return { success: true, data: inserted };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { player_id, cron } = body || {};

    // Cron mode: iterate all players with an active push subscription
    if (cron === true) {
      const { data: subs } = await supabaseAdmin
        .from("push_subscriptions")
        .select("player_id")
        .eq("notify_npc", true);
      const uniquePlayers = Array.from(new Set((subs || []).map((s: any) => s.player_id)));
      const results: any[] = [];
      for (const pid of uniquePlayers) {
        try {
          const r = await generateForPlayer(pid, { skipRandom: true });
          results.push({ player_id: pid, ...r });
        } catch (e: any) {
          results.push({ player_id: pid, success: false, error: e.message });
        }
      }
      return new Response(JSON.stringify({ success: true, processed: uniquePlayers.length, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!player_id) {
      return new Response(JSON.stringify({ success: false, error: "player_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await generateForPlayer(player_id);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("npc-message error:", e);
    const status = e.message === "RATE_LIMITED" ? 429 : e.message === "CREDITS_EXHAUSTED" ? 402 : 500;
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
