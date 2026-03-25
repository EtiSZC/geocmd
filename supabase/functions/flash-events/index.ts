import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function importPrivateKey(base64url: string) {
  const raw = urlBase64ToUint8Array(base64url);
  return await crypto.subtle.importKey(
    "pkcs8",
    await buildPkcs8(raw),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

async function buildPkcs8(rawPrivateKey: Uint8Array): Promise<ArrayBuffer> {
  // Build PKCS8 wrapper around raw 32-byte EC private key
  const pkcs8Header = new Uint8Array([
    0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86,
    0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02, 0x01, 0x01, 0x04, 0x20,
  ]);
  const pkcs8Footer = new Uint8Array([
    0xa1, 0x44, 0x03, 0x42, 0x00,
  ]);
  const result = new Uint8Array(pkcs8Header.length + rawPrivateKey.length + pkcs8Footer.length + 65);
  result.set(pkcs8Header);
  result.set(rawPrivateKey, pkcs8Header.length);
  // We won't include the public key in PKCS8 for signing — use JWK import instead
  return result.buffer;
}

function base64urlEncode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createVapidJwt(endpoint: string, privateKeyBase64url: string, publicKeyBase64url: string): Promise<{ authorization: string; cryptoKey: string }> {
  const audience = new URL(endpoint).origin;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: expiry, sub: "mailto:admin@geocmd.app" };

  const headerB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import private key as JWK
  const rawKey = urlBase64ToUint8Array(privateKeyBase64url);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: privateKeyBase64url,
    // We need x and y from public key
    x: publicKeyBase64url ? "" : "",
    y: "",
  };

  // Use raw import approach with PKCS8
  // Actually, let's decode the public key to get x,y
  const pubBytes = urlBase64ToUint8Array(publicKeyBase64url);
  // Uncompressed public key: 0x04 + 32 bytes X + 32 bytes Y
  const x = base64urlEncode(pubBytes.slice(1, 33));
  const y = base64urlEncode(pubBytes.slice(33, 65));

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: privateKeyBase64url, x, y },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsignedToken)
  );

  // Convert DER signature to raw r||s format for JWT
  const sigBytes = new Uint8Array(signature);
  let r: Uint8Array, s: Uint8Array;
  if (sigBytes[0] === 0x30) {
    // DER encoded
    const rLen = sigBytes[3];
    const rStart = 4;
    const rBytes = sigBytes.slice(rStart, rStart + rLen);
    const sLen = sigBytes[rStart + rLen + 1];
    const sStart = rStart + rLen + 2;
    const sBytes = sigBytes.slice(sStart, sStart + sLen);
    r = rBytes.length > 32 ? rBytes.slice(rBytes.length - 32) : rBytes;
    s = sBytes.length > 32 ? sBytes.slice(sBytes.length - 32) : sBytes;
    if (r.length < 32) { const padded = new Uint8Array(32); padded.set(r, 32 - r.length); r = padded; }
    if (s.length < 32) { const padded = new Uint8Array(32); padded.set(s, 32 - s.length); s = padded; }
  } else {
    // Already raw r||s (64 bytes)
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32, 64);
  }

  const rawSig = new Uint8Array(64);
  rawSig.set(r, 0);
  rawSig.set(s, 32);

  const token = `${unsignedToken}.${base64urlEncode(rawSig)}`;

  return {
    authorization: `vapid t=${token}, k=${publicKeyBase64url}`,
    cryptoKey: `p256ecdsa=${publicKeyBase64url}`,
  };
}

async function sendPushNotification(
  subscription: any,
  payload: any,
  privateKey: string,
  publicKey: string
): Promise<boolean> {
  try {
    const { authorization, cryptoKey } = await createVapidJwt(
      subscription.endpoint,
      privateKey,
      publicKey
    );

    const body = JSON.stringify(payload);

    const resp = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Crypto-Key": cryptoKey,
        "Content-Type": "application/json",
        TTL: "86400",
      },
      body,
    });

    if (!resp.ok) {
      console.error("Push failed:", resp.status, await resp.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("Push error:", e);
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_PUBLIC_KEY = "BH4pO72nfLseaBl-9cvw1mNqpg6HcRPNDwrrS1-qiZiFZrJB9ikMCxwot-AKrPt_Lz089a99rdhwq3c2H7kpnng";

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { action } = await req.json().catch(() => ({ action: "generate" }));

    if (action === "generate") {
      // Generate a flash event via AI
      if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

      const aiResp = await fetch(AI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Tu es un système de simulation de crises géopolitiques. Réponds UNIQUEMENT en JSON valide, aucun texte autour. Génère une crise flash imprévue et réaliste basée sur l'actualité de mars 2026.`,
            },
            {
              role: "user",
              content: `Génère un événement flash géopolitique urgent. La crise doit être surprenante mais plausible.
JSON: {"title":"Titre court","description":"Description en 2-3 phrases.","region":"Zone géographique","event_type":"militaire|diplomatique|économique|humanitaire","urgency":4,"options":[{"id":"opt1","label":"Action rapide 1","desc":"Description","cat":"militaire|diplomatique|économique|renseignement","risk":"faible|modéré|élevé","scoreDeltas":{"stability":3,"diplomacy":-2,"military":5,"intelligence":0}},{"id":"opt2","label":"Action rapide 2","desc":"Description","cat":"...","risk":"...","scoreDeltas":{...}},{"id":"opt3","label":"Action rapide 3","desc":"Description","cat":"...","risk":"...","scoreDeltas":{...}}]}
Urgency 3-5. Exactement 3 options avec des scoreDeltas entre -10 et +10.`,
            },
          ],
        }),
      });

      if (!aiResp.ok) {
        const errText = await aiResp.text();
        console.error("AI error:", aiResp.status, errText);
        throw new Error(`AI error ${aiResp.status}`);
      }

      const aiData = await aiResp.json();
      const raw = aiData.choices?.[0]?.message?.content || "";
      let parsed;
      try {
        const m = raw.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || raw.match(/(\{[\s\S]*?\})/s);
        parsed = JSON.parse(m ? m[1] : raw);
      } catch {
        parsed = {
          title: "Incident diplomatique majeur",
          description: "Un incident diplomatique inattendu secoue les relations internationales.",
          region: "Global",
          event_type: "diplomatique",
          urgency: 4,
          options: [
            { id: "opt1", label: "Médiation immédiate", desc: "Lancer une médiation d'urgence.", cat: "diplomatique", risk: "faible", scoreDeltas: { stability: 3, diplomacy: 5, military: 0, intelligence: -1 } },
            { id: "opt2", label: "Posture défensive", desc: "Renforcer la posture de défense.", cat: "militaire", risk: "modéré", scoreDeltas: { stability: -2, diplomacy: -3, military: 6, intelligence: 2 } },
            { id: "opt3", label: "Opération de renseignement", desc: "Infiltration pour évaluer la menace.", cat: "renseignement", risk: "élevé", scoreDeltas: { stability: 0, diplomacy: -1, military: 2, intelligence: 8 } },
          ],
        };
      }

      // Expires in 2 hours
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

      const { data: flashEvent, error: insertErr } = await sb.from("flash_events").insert({
        title: parsed.title,
        description: parsed.description,
        region: parsed.region,
        event_type: parsed.event_type,
        urgency: parsed.urgency || 4,
        options: parsed.options || [],
        expires_at: expiresAt,
      }).select().single();

      if (insertErr) {
        console.error("Insert error:", insertErr);
        throw insertErr;
      }

      // Send push notifications to all subscribers
      if (VAPID_PRIVATE_KEY) {
        const { data: subs } = await sb.from("push_subscriptions").select("subscription");
        if (subs && subs.length > 0) {
          const payload = {
            title: `⚡ ${parsed.title}`,
            body: parsed.description?.slice(0, 120) || "Événement flash en cours !",
            url: "/",
          };
          await Promise.allSettled(
            subs.map((s: any) =>
              sendPushNotification(s.subscription, payload, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY)
            )
          );
        }
      }

      return new Response(JSON.stringify({ success: true, data: flashEvent }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("flash-events error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
