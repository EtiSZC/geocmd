import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const VAPID_PUBLIC_KEY = "BH4pO72nfLseaBl-9cvw1mNqpg6HcRPNDwrrS1-qiZiFZrJB9ikMCxwot-AKrPt_Lz089a99rdhwq3c2H7kpnng";

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

// ---- Main handler ----

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const { parent_event_id, parent_option, player_id, risk_outcome } = await req.json();
    if (!parent_event_id || !parent_option || !player_id) {
      return new Response(JSON.stringify({ error: "Missing params" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: parentEvent } = await sb.from("flash_events").select("*").eq("id", parent_event_id).single();
    if (!parentEvent) throw new Error("Parent event not found");

    const outcomeLabel = risk_outcome === "success" ? "un succès total" : risk_outcome === "partial" ? "un succès partiel" : "un échec";

    let parsed;
    try {
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

      if (!aiResp.ok) {
        const errText = await aiResp.text();
        console.error("AI service error:", aiResp.status, errText);
        throw new Error(`AI error ${aiResp.status}`);
      }

      const aiData = await aiResp.json();
      const raw = aiData.choices?.[0]?.message?.content || "";
      const m = raw.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || raw.match(/(\{[\s\S]*?\})/s);
      parsed = JSON.parse(m ? m[1] : raw);
    } catch (aiErr) {
      console.error("AI fallback triggered:", aiErr);
      parsed = {
        title: "⚡ ONDE DE CHOC — Répercussions",
        description: `Suite à votre décision concernant "${parentEvent.title}", de nouvelles tensions émergent dans la région ${parentEvent.region}.`,
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

    // Send push notification to the target player
    if (VAPID_PRIVATE_KEY) {
      const { data: sub } = await sb.from("push_subscriptions").select("subscription, notify_flash").eq("player_id", player_id).eq("notify_flash", true).single();
      if (sub?.subscription) {
        const pushPayload = {
          title: `⚡ ONDE DE CHOC`,
          body: (parsed.title + " — " + (parsed.description || "")).slice(0, 140),
          url: "/",
          tag: `shockwave-${followUp.id}`,
        };
        const ok = await sendPush(sub.subscription, pushPayload, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY);
        console.log("Shockwave push sent:", ok);
      }
    }

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
