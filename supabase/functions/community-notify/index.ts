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

async function sendPush(sub: any, payload: any, privKey: string, pubKey: string): Promise<boolean> {
  try {
    const { authorization, cryptoKey } = await createVapidJwt(sub.endpoint, privKey, pubKey);
    const resp = await fetch(sub.endpoint, {
      method: "POST",
      headers: { Authorization: authorization, "Crypto-Key": cryptoKey, "Content-Type": "application/json", TTL: "86400" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) { console.error("Push failed:", resp.status, await resp.text()); return false; }
    return true;
  } catch (e) { console.error("Push error:", e); return false; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { player_id, region, scenario_title } = await req.json();
    if (!player_id || !region) throw new Error("player_id and region required");

    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!VAPID_PRIVATE_KEY) throw new Error("VAPID_PRIVATE_KEY missing");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find other players with theaters in the same region
    const { data: similarTheaters } = await sb
      .from("theaters")
      .select("player_id, scenario")
      .neq("player_id", player_id);

    const targetPlayerIds = new Set<string>();
    for (const t of similarTheaters || []) {
      const tRegion = (t.scenario as any)?.region;
      if (tRegion && tRegion.toLowerCase() === region.toLowerCase()) {
        targetPlayerIds.add(t.player_id);
      }
    }

    if (targetPlayerIds.size === 0) {
      return new Response(
        JSON.stringify({ success: true, notified: 0, message: "No similar theaters" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get push subs for those players with notify_community enabled
    const { data: subs } = await sb
      .from("push_subscriptions")
      .select("player_id, subscription, notify_community")
      .in("player_id", [...targetPlayerIds])
      .eq("notify_community", true);

    // Get the new player's callsign
    const { data: playerData } = await sb.from("players").select("callsign").eq("id", player_id).single();
    const callsign = playerData?.callsign || "Un opérateur";

    let notified = 0;
    for (const sub of subs || []) {
      const payload = {
        title: "👥 ALERTE COMMUNAUTAIRE",
        body: `${callsign} a rejoint un théâtre dans la région ${region}${scenario_title ? ` — ${scenario_title}` : ""}.`,
        url: "/",
        tag: `community-${player_id}-${Date.now()}`,
      };
      const ok = await sendPush(sub.subscription, payload, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY);
      if (ok) notified++;
    }

    return new Response(
      JSON.stringify({ success: true, notified, targets: targetPlayerIds.size }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("community-notify error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
