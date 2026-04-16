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

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", key, salt.length ? salt : new Uint8Array(32)));
  const prkKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  // T(1) = HMAC(PRK, info || 0x01)
  const t1 = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, concat(info, new Uint8Array([1]))));
  return t1.slice(0, len);
}

// HKDF extract + expand proper implementation
async function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  // Extract
  const saltKey = await crypto.subtle.importKey("raw", salt.length ? salt : new Uint8Array(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", saltKey, ikm));
  // Expand
  const prkKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const infoWithCounter = concat(info, new Uint8Array([1]));
  const okm = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, infoWithCounter));
  return okm.slice(0, length);
}

function createInfo(type: string, clientPublicKey: Uint8Array, serverPublicKey: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const typeBytes = enc.encode(type);
  const nul = new Uint8Array([0]);
  // "Content-Encoding: <type>\0" + "P-256\0" + len(recipient) + recipient + len(sender) + sender
  const header = enc.encode("Content-Encoding: ");
  const p256 = enc.encode("P-256");
  const recipientLen = new Uint8Array(2);
  recipientLen[0] = 0; recipientLen[1] = clientPublicKey.length;
  const senderLen = new Uint8Array(2);
  senderLen[0] = 0; senderLen[1] = serverPublicKey.length;
  return concat(header, typeBytes, nul, p256, nul, recipientLen, clientPublicKey, senderLen, serverPublicKey);
}

async function encryptPayload(
  plaintext: Uint8Array,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<{ encrypted: Uint8Array; localPublicKey: Uint8Array; salt: Uint8Array }> {
  const clientPublicKeyBytes = urlBase64ToUint8Array(subscription.keys.p256dh);
  const authSecret = urlBase64ToUint8Array(subscription.keys.auth);

  // Generate local ephemeral ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPublicKeyJwk = await crypto.subtle.exportKey("jwk", localKeyPair.publicKey);
  const localPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", localKeyPair.publicKey));

  // Import client public key for ECDH
  const clientPublicKey = await crypto.subtle.importKey("raw", clientPublicKeyBytes, { name: "ECDH", namedCurve: "P-256" }, false, []);

  // Derive shared secret via ECDH
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientPublicKey }, localKeyPair.privateKey, 256));

  // Generate random salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291: IKM = HKDF-SHA256(auth_secret, ecdh_secret, "WebPush: info\0" || ua_public || as_public, 32)
  const ikmInfo = concat(new TextEncoder().encode("WebPush: info\0"), clientPublicKeyBytes, localPublicKeyRaw);
  const ikm = await hkdfSha256(sharedSecret, authSecret, ikmInfo, 32);

  // Derive content encryption key: HKDF(salt, ikm, "Content-Encoding: aes128gcm\0", 16)
  const cekInfo = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const cek = await hkdfSha256(ikm, salt, cekInfo, 16);

  // Derive nonce: HKDF(salt, ikm, "Content-Encoding: nonce\0", 12)
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");
  const nonce = await hkdfSha256(ikm, salt, nonceInfo, 12);

  // Pad plaintext: add delimiter byte 0x02 (final record)
  const paddedPlaintext = concat(plaintext, new Uint8Array([2]));

  // Encrypt with AES-128-GCM
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, paddedPlaintext));

  // Build aes128gcm body: salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
  const rs = new Uint8Array(4);
  const view = new DataView(rs.buffer);
  view.setUint32(0, 4096);
  const idLen = new Uint8Array([65]);
  const body = concat(salt, rs, idLen, localPublicKeyRaw, ciphertext);

  return { encrypted: body, localPublicKey: localPublicKeyRaw, salt };
}

async function createVapidJwt(endpoint: string, privKeyB64: string, pubKeyB64: string): Promise<{ authorization: string }> {
  const audience = new URL(endpoint).origin;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: expiry, sub: "mailto:admin@geocmd.app" };
  const headerB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const pubBytes = urlBase64ToUint8Array(pubKeyB64);
  const x = base64urlEncode(pubBytes.slice(1, 33));
  const y = base64urlEncode(pubBytes.slice(33, 65));
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", d: privKeyB64, x, y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsignedToken)));

  let r: Uint8Array, s: Uint8Array;
  if (sig[0] === 0x30) {
    const rLen = sig[3]; const rStart = 4;
    const rBytes = sig.slice(rStart, rStart + rLen);
    const sLen = sig[rStart + rLen + 1]; const sStart = rStart + rLen + 2;
    const sBytes = sig.slice(sStart, sStart + sLen);
    r = rBytes.length > 32 ? rBytes.slice(rBytes.length - 32) : rBytes;
    s = sBytes.length > 32 ? sBytes.slice(sBytes.length - 32) : sBytes;
    if (r.length < 32) { const p = new Uint8Array(32); p.set(r, 32 - r.length); r = p; }
    if (s.length < 32) { const p = new Uint8Array(32); p.set(s, 32 - s.length); s = p; }
  } else { r = sig.slice(0, 32); s = sig.slice(32, 64); }
  const rawSig = new Uint8Array(64); rawSig.set(r, 0); rawSig.set(s, 32);
  const token = `${unsignedToken}.${base64urlEncode(rawSig)}`;
  return { authorization: `vapid t=${token}, k=${pubKeyB64}` };
}

async function sendPush(sub: any, payload: any, privKey: string, pubKey: string): Promise<boolean> {
  try {
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const { encrypted } = await encryptPayload(payloadBytes, sub);
    const { authorization } = await createVapidJwt(sub.endpoint, privKey, pubKey);
    const resp = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(encrypted.length),
        TTL: "86400",
      },
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

    const { action, force } = await req.json().catch(() => ({ action: "generate", force: false }));

    if (action === "generate") {
      // Enforce 4-hour cooldown: skip if a non-followup event was created in the last 4 hours
      const { data: recent } = await sb
        .from("flash_events")
        .select("id")
        .is("parent_event_id", null)
        .gt("created_at", new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (!force && recent && recent.length > 0) {
        return new Response(JSON.stringify({ success: true, skipped: true, reason: "Cooldown 4h — un event existe déjà" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!force && Math.random() > 0.5) {
        return new Response(JSON.stringify({ success: true, skipped: true, reason: "Random roll — no event this time" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

      // Calendar of major international events for seasonal theming
      const now = new Date();
      const month = now.getMonth() + 1; // 1-12
      const day = now.getDate();
      const seasonalEvents: string[] = [];

      // January
      if (month === 1 && day >= 15 && day <= 25) seasonalEvents.push("Forum économique mondial de Davos");
      // February
      if (month === 2 && day >= 10 && day <= 20) seasonalEvents.push("Conférence de Munich sur la sécurité");
      // March
      if (month === 3 && day >= 1 && day <= 15) seasonalEvents.push("Session du Conseil des droits de l'homme de l'ONU à Genève");
      // April
      if (month === 4 && day >= 10 && day <= 20) seasonalEvents.push("Réunions de printemps du FMI et de la Banque mondiale");
      // May
      if (month === 5 && day >= 5 && day <= 15) seasonalEvents.push("Sommet de l'OTAN");
      if (month === 5 && day >= 20 && day <= 31) seasonalEvents.push("Sommet du G7");
      // June
      if (month === 6 && day >= 1 && day <= 15) seasonalEvents.push("Forum de Shangri-La sur la sécurité en Asie");
      if (month === 6 && day >= 20 && day <= 30) seasonalEvents.push("Sommet de l'Union européenne");
      // July
      if (month === 7) seasonalEvents.push("Présidence tournante du Conseil de sécurité de l'ONU");
      // August
      if (month === 8 && day >= 1 && day <= 15) seasonalEvents.push("Sommet de la CEDEAO");
      if (month === 8 && day >= 20 && day <= 31) seasonalEvents.push("Sommet des BRICS");
      // September
      if (month === 9 && day >= 15 && day <= 30) seasonalEvents.push("Assemblée générale des Nations Unies à New York");
      // October
      if (month === 10 && day >= 10 && day <= 20) seasonalEvents.push("Assemblées annuelles du FMI");
      // November
      if (month === 11 && day >= 1 && day <= 15) seasonalEvents.push("COP - Conférence des Nations Unies sur le climat");
      if (month === 11 && day >= 15 && day <= 25) seasonalEvents.push("Sommet du G20");
      if (month === 11 && day >= 10 && day <= 15) seasonalEvents.push("Forum de Paris sur la Paix");
      // December
      if (month === 12 && day >= 1 && day <= 15) seasonalEvents.push("Sommet UE-Afrique");

      // Apply seasonal context only 1 in 3 generations to prevent over-representation
      const useSeasonal = seasonalEvents.length > 0 && Math.random() < 1 / 3;
      const seasonalHint = useSeasonal
        ? `\n\nCONTEXTE SAISONNIER : Nous sommes le ${day}/${month}/2026. En ce moment se déroule : ${seasonalEvents.join(", ")}. Tu DOIS créer une crise en lien direct avec cet événement international (tensions en coulisses, incident pendant le sommet, fuite diplomatique, coup de théâtre en marge de l'événement, etc.). Mentionne explicitement le sommet/événement dans le titre ou la description.`
        : `\n\nNous sommes le ${day}/${month}/2026. Génère une crise basée sur l'actualité géopolitique de cette période. NE FAIS PAS référence à un sommet international en cours.`;

      // Anti-duplication: fetch last 5 generated root events to inject as exclusion list
      const { data: recentEvents } = await sb
        .from("flash_events")
        .select("title, region, event_type")
        .is("parent_event_id", null)
        .order("created_at", { ascending: false })
        .limit(5);

      const recentList = (recentEvents || []).map((e: any) => `- "${e.title}" (${e.region}, ${e.event_type})`).join("\n");
      const antiDupHint = recentList
        ? `\n\nÉVÉNEMENTS RÉCEMMENT GÉNÉRÉS (À ÉVITER ABSOLUMENT) :\n${recentList}\n\nTu DOIS générer une crise avec un thème, une région ET un type d'événement DIFFÉRENTS de ceux ci-dessus. Pas de répétition de fuites de données, de sommets FMI/Banque mondiale, ou de scénarios similaires.`
        : "";

      // Forced rotation: pick a region category and event_type not used recently
      const allRegions = ["Europe de l'Est", "Asie-Pacifique", "Moyen-Orient", "Afrique subsaharienne", "Amérique latine", "Arctique", "Asie centrale", "Corne de l'Afrique", "Caucase", "Mer de Chine méridionale"];
      const allTypes = ["militaire", "diplomatique", "économique", "humanitaire", "renseignement", "cyber"];
      const recentRegions = new Set((recentEvents || []).map((e: any) => e.region));
      const recentTypes = new Set((recentEvents || []).map((e: any) => e.event_type));
      const availableRegions = allRegions.filter(r => !recentRegions.has(r));
      const availableTypes = allTypes.filter(t => !recentTypes.has(t));
      const forcedRegion = availableRegions.length > 0 ? availableRegions[Math.floor(Math.random() * availableRegions.length)] : allRegions[Math.floor(Math.random() * allRegions.length)];
      const forcedType = availableTypes.length > 0 ? availableTypes[Math.floor(Math.random() * availableTypes.length)] : allTypes[Math.floor(Math.random() * allTypes.length)];
      const rotationHint = `\n\nROTATION FORCÉE : La crise DOIT se dérouler dans la région "${forcedRegion}" et être de type "${forcedType}". Adapte le scénario en conséquence.`;

      const aiResp = await fetch(AI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: `Tu es un système de simulation de crises géopolitiques. Réponds UNIQUEMENT en JSON valide, aucun texte autour. Génère une crise flash imprévue et réaliste.${seasonalHint}${antiDupHint}${rotationHint}` },
            { role: "user", content: `Génère un événement flash géopolitique urgent. La crise doit être surprenante mais plausible.
JSON: {"title":"Titre court","description":"Description en 2-3 phrases.","region":"Zone géographique","event_type":"militaire|diplomatique|économique|humanitaire","urgency":4,"options":[{"id":"opt1","label":"Action rapide 1","desc":"Description","cat":"militaire|diplomatique|économique|renseignement","risk":"faible|modéré|élevé","scoreDeltas":{"stability":3,"diplomacy":-2,"military":5,"intelligence":0}},{"id":"opt2","label":"Action rapide 2","desc":"Description","cat":"...","risk":"...","scoreDeltas":{...}},{"id":"opt3","label":"Action rapide 3","desc":"Description","cat":"...","risk":"...","scoreDeltas":{...}}]}
Urgency 3-5. Exactement 3 options avec des scoreDeltas entre -10 et +10.` },
          ],
        }),
      });

      if (!aiResp.ok) { const errText = await aiResp.text(); console.error("AI error:", aiResp.status, errText); throw new Error(`AI error ${aiResp.status}`); }

      const aiData = await aiResp.json();
      const raw = aiData.choices?.[0]?.message?.content || "";
      let parsed;
      try {
        const m = raw.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || raw.match(/(\{[\s\S]*?\})/s);
        parsed = JSON.parse(m ? m[1] : raw);
      } catch {
        parsed = {
          title: "Incident diplomatique majeur", description: "Un incident diplomatique inattendu secoue les relations internationales.",
          region: "Global", event_type: "diplomatique", urgency: 4,
          options: [
            { id: "opt1", label: "Médiation immédiate", desc: "Lancer une médiation d'urgence.", cat: "diplomatique", risk: "faible", scoreDeltas: { stability: 3, diplomacy: 5, military: 0, intelligence: -1 } },
            { id: "opt2", label: "Posture défensive", desc: "Renforcer la posture de défense.", cat: "militaire", risk: "modéré", scoreDeltas: { stability: -2, diplomacy: -3, military: 6, intelligence: 2 } },
            { id: "opt3", label: "Opération de renseignement", desc: "Infiltration pour évaluer la menace.", cat: "renseignement", risk: "élevé", scoreDeltas: { stability: 0, diplomacy: -1, military: 2, intelligence: 8 } },
          ],
        };
      }

      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const { data: flashEvent, error: insertErr } = await sb.from("flash_events").insert({
        title: parsed.title, description: parsed.description, region: parsed.region,
        event_type: parsed.event_type, urgency: parsed.urgency || 4, options: parsed.options || [], expires_at: expiresAt,
      }).select().single();

      if (insertErr) { console.error("Insert error:", insertErr); throw insertErr; }

      // Push notifications with proper encryption
      if (VAPID_PRIVATE_KEY) {
        const { data: subs } = await sb.from("push_subscriptions").select("subscription, notify_flash").eq("notify_flash", true);
        if (subs && subs.length > 0) {
          const pushPayload = { title: `⚡ ${parsed.title}`, body: parsed.description?.slice(0, 120) || "Événement flash en cours !", url: "/", tag: `flash-${flashEvent.id}` };
          await Promise.allSettled(subs.map((s: any) => sendPush(s.subscription, pushPayload, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY)));
        }
      }

      return new Response(JSON.stringify({ success: true, data: flashEvent }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("flash-events error:", e);
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
