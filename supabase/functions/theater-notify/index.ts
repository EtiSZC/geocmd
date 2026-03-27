import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VAPID_PUBLIC_KEY =
  "BH4pO72nfLseaBl-9cvw1mNqpg6HcRPNDwrrS1-qiZiFZrJB9ikMCxwot-AKrPt_Lz089a99rdhwq3c2H7kpnng";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function base64urlEncode(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createVapidJwt(
  endpoint: string,
  privateKeyBase64url: string,
  publicKeyBase64url: string
): Promise<{ authorization: string; cryptoKey: string }> {
  const audience = new URL(endpoint).origin;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: expiry, sub: "mailto:admin@geocmd.app" };

  const headerB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const pubBytes = urlBase64ToUint8Array(publicKeyBase64url);
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

  const sigBytes = new Uint8Array(signature);
  let r: Uint8Array, s: Uint8Array;
  if (sigBytes[0] === 0x30) {
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

    const resp = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Crypto-Key": cryptoKey,
        "Content-Type": "application/json",
        TTL: "86400",
      },
      body: JSON.stringify(payload),
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
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!VAPID_PRIVATE_KEY) throw new Error("VAPID_PRIVATE_KEY missing");

    const DELAY_MS = 5 * 60 * 60 * 1000; // 5 hours
    const cutoff = new Date(Date.now() - DELAY_MS).toISOString();

    // Find theaters where:
    // - notified_ready = false
    // - has history with decided_at
    // - no consequence yet
    // - decided_at is older than 5 hours
    const { data: theaters, error: thErr } = await sb
      .from("theaters")
      .select("id, player_id, scenario, history, consequence, notified_ready")
      .eq("notified_ready", false)
      .is("consequence", null);

    if (thErr) throw thErr;

    const readyTheaters = (theaters || []).filter((t: any) => {
      const hist = Array.isArray(t.history) ? t.history : [];
      const last = hist[hist.length - 1];
      if (!last?.decided_at) return false;
      return new Date(last.decided_at).getTime() <= Date.now() - DELAY_MS;
    });

    if (readyTheaters.length === 0) {
      return new Response(
        JSON.stringify({ success: true, notified: 0, message: "No theaters ready" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get unique player IDs
    const playerIds = [...new Set(readyTheaters.map((t: any) => t.player_id))];

    // Get push subscriptions for those players
    const { data: subs } = await sb
      .from("push_subscriptions")
      .select("player_id, subscription, notify_theater")
      .in("player_id", playerIds)
      .eq("notify_theater", true);

    const subsByPlayer = new Map<string, any>();
    (subs || []).forEach((s: any) => subsByPlayer.set(s.player_id, s.subscription));

    let notifiedCount = 0;

    for (const theater of readyTheaters) {
      const sub = subsByPlayer.get(theater.player_id);
      const title = (theater.scenario as any)?.title || "Théâtre";

      if (sub) {
        const payload = {
          title: `🎯 ${title} — PRÊT`,
          body: "Les effets de votre décision sont disponibles. Consultez le rapport de situation.",
          url: "/",
          tag: `theater-ready-${theater.id}`,
        };

        await sendPushNotification(sub, payload, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY);
        notifiedCount++;
      }

      // Mark as notified regardless (avoid re-checking)
      await sb.from("theaters").update({ notified_ready: true }).eq("id", theater.id);
    }

    return new Response(
      JSON.stringify({ success: true, notified: notifiedCount, checked: readyTheaters.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("theater-notify error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
