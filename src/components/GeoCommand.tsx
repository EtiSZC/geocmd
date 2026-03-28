import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const VAPID_PUBLIC_KEY = "BH4pO72nfLseaBl-9cvw1mNqpg6HcRPNDwrrS1-qiZiFZrJB9ikMCxwot-AKrPt_Lz089a99rdhwq3c2H7kpnng";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function subscribeToPush(playerId: string) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }

    // Save to DB
    await supabase.from("push_subscriptions").upsert(
      { player_id: playerId, subscription: sub.toJSON() as any },
      { onConflict: "player_id" }
    );
  } catch (e) {
    console.warn("Push subscription failed:", e);
  }
}

async function loadActiveFlashEvents() {
  const { data } = await supabase
    .from("flash_events")
    .select("*")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(5);
  return data || [];
}

async function loadPlayerFlashResponses(playerId: string) {
  const { data } = await supabase
    .from("flash_event_responses")
    .select("event_id")
    .eq("player_id", playerId);
  return (data || []).map(r => r.event_id);
}

async function respondToFlashEvent(eventId: string, playerId: string, option: any) {
  const { error } = await supabase.from("flash_event_responses").insert({
    event_id: eventId,
    player_id: playerId,
    chosen_option: option as any,
    score_deltas: (option.scoreDeltas || null) as any,
  });
  return !error;
}

function injectStyles() {
  if (document.getElementById("gc-styles")) return;
  const s = document.createElement("style");
  s.id = "gc-styles";
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@300;400;500;600;700&family=Share+Tech+Mono&family=Barlow:wght@300;400;500&display=swap');
    *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
    .gc {
      --bg:#060810; --surf:#0a0f1c; --brd:#162030; --brd2:#1e2e48;
      --gold:#c8a84b; --green:#00e87a; --red:#ff3344; --blue:#4d8eff;
      --txt:#dce4f0; --muted:#5a6a88; --muted2:#2e3e56;
      font-family:'Barlow',sans-serif; background:var(--bg); color:var(--txt);
      min-height:100vh; position:relative; overflow-x:hidden;
    }
    .gc::before {
      content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
      background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(255,255,255,0.011) 3px,rgba(255,255,255,0.011) 4px);
    }
    .gc::after {
      content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
      background:
        radial-gradient(ellipse 55% 40% at 10% 65%,rgba(200,168,75,0.07) 0%,transparent 70%),
        radial-gradient(ellipse 40% 30% at 90% 15%,rgba(0,232,122,0.04) 0%,transparent 65%);
    }
    .gc-grid {
      position:fixed; inset:0; z-index:0; pointer-events:none;
      background-image:linear-gradient(rgba(22,32,48,0.55) 1px,transparent 1px),linear-gradient(90deg,rgba(22,32,48,0.55) 1px,transparent 1px);
      background-size:38px 38px;
    }
    .gc-z { position:relative; z-index:1; }
    .gc-h { font-family:'Rajdhani',sans-serif; }
    .gc-m { font-family:'Share Tech Mono',monospace; }
    .gc-header {
      position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:space-between;
      padding:12px 20px; background:rgba(6,8,16,0.94); backdrop-filter:blur(14px);
      border-bottom:1px solid var(--brd);
    }
    .gc-panel { background:var(--surf); border:1px solid var(--brd); position:relative; }
    .gc-panel::before {
      content:''; position:absolute; top:0; left:0; right:0; height:1px;
      background:linear-gradient(90deg,transparent,rgba(200,168,75,0.45),transparent);
    }
    .gc-btn {
      display:inline-flex; align-items:center; gap:8px; cursor:pointer;
      padding:11px 22px; font-family:'Rajdhani',sans-serif; font-size:14px;
      font-weight:600; letter-spacing:2.5px; text-transform:uppercase;
      border:1px solid var(--gold); background:transparent; color:var(--gold);
      clip-path:polygon(10px 0%,100% 0%,calc(100% - 10px) 100%,0% 100%);
      transition:all .18s; white-space:nowrap;
    }
    .gc-btn:hover:not(:disabled) { background:var(--gold); color:var(--bg); }
    .gc-btn:disabled { opacity:.33; cursor:not-allowed; }
    .gc-btn.ghost { border-color:var(--brd2); color:var(--muted); clip-path:none; font-size:12px; }
    .gc-btn.ghost:hover:not(:disabled) { border-color:var(--muted); color:var(--txt); background:transparent; }
    .gc-btn.danger { border-color:rgba(255,51,68,.4); color:var(--red); clip-path:none; }
    .gc-btn.full { width:100%; justify-content:center; }
    .gc-input {
      background:rgba(6,8,16,.85); border:1px solid var(--brd); color:var(--txt);
      font-family:'Share Tech Mono',monospace; font-size:13px; padding:11px 14px;
      width:100%; outline:none; transition:border-color .2s;
    }
    .gc-input:focus { border-color:var(--gold); }
    .gc-input::placeholder { color:var(--muted2); }
    .gc-label { font-family:'Share Tech Mono',monospace; font-size:10px; letter-spacing:2.5px; color:var(--muted); display:block; margin-bottom:7px; }
    .gc-badge { font-family:'Share Tech Mono',monospace; font-size:9px; letter-spacing:2.5px; padding:3px 7px; border:1px solid; }
    .gc-badge.ts { border-color:var(--red); color:var(--red); }
    .gc-badge.c  { border-color:var(--gold); color:var(--gold); }
    .gc-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--green); box-shadow:0 0 7px var(--green); animation:blink 2.2s ease-in-out infinite; }
    .gc-dot.green  { background:#00e87a; box-shadow:0 0 7px #00e87a; }
    .gc-dot.orange { background:#ff8800; box-shadow:0 0 7px #ff8800; }
    .gc-dot.grey   { background:var(--muted2); box-shadow:none; animation:none; }
    .gc-notif-badge {
      display:inline-flex; align-items:center; justify-content:center;
      min-width:20px; height:20px; border-radius:10px; padding:0 6px;
      background:#00e87a; color:#060810; font-family:'Share Tech Mono',monospace;
      font-size:10px; font-weight:700; letter-spacing:1px;
      animation:pulse-badge 2s ease-in-out infinite;
      box-shadow:0 0 12px rgba(0,232,122,0.5);
    }
    @keyframes pulse-badge { 0%,100%{box-shadow:0 0 8px rgba(0,232,122,0.4)} 50%{box-shadow:0 0 18px rgba(0,232,122,0.7)} }
    .gc-ready-card { border-color:rgba(0,232,122,0.3) !important; background:rgba(0,232,122,0.03) !important; }
    .gc-ready-card:hover { border-color:rgba(0,232,122,0.5) !important; }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.35} }
    .gc-theater {
      background:var(--surf); border:1px solid var(--brd); padding:18px 20px;
      cursor:pointer; transition:all .2s; position:relative; overflow:hidden;
    }
    .gc-theater::after { content:''; position:absolute; left:0; top:0; bottom:0; width:3px; transition:background .2s; }
    .gc-theater:hover { border-color:var(--brd2); }
    .gc-theater.done::after    { background:var(--muted2); }
    .gc-theater.pending::after { background:var(--gold); }
    .gc-action { background:var(--surf); border:1px solid var(--brd); padding:16px; cursor:pointer; transition:all .18s; position:relative; }
    .gc-action::after { content:''; position:absolute; left:0; top:0; bottom:0; width:3px; background:transparent; transition:background .18s; }
    .gc-action:hover { border-color:var(--brd2); background:#0d1522; }
    .gc-action:hover::after { background:var(--gold); }
    .gc-action.sel { border-color:var(--gold); background:rgba(200,168,75,.07); }
    .gc-action.sel::after { background:var(--gold); }
    .gc-scenario { background:var(--surf); border:1px solid var(--brd); padding:20px; cursor:pointer; transition:all .2s; position:relative; overflow:hidden; }
    .gc-scenario::before { content:''; position:absolute; top:0; left:0; right:0; height:2px; background:transparent; transition:background .2s; }
    .gc-scenario:hover { border-color:var(--brd2); transform:translateY(-1px); }
    .gc-scenario:hover::before, .gc-scenario.sel::before { background:var(--gold); }
    .gc-scenario.sel { border-color:var(--gold); }
    .gc-scenario.disabled { opacity:.38; cursor:not-allowed; pointer-events:none; }
    .gc-div { height:1px; background:linear-gradient(90deg,transparent,var(--brd2),transparent); margin:20px 0; }
    .gc-risk { font-family:'Share Tech Mono',monospace; font-size:10px; letter-spacing:1px; padding:2px 6px; border:1px solid; }
    .gc-risk.lo { border-color:var(--green); color:var(--green); }
    .gc-risk.md { border-color:#ff8800; color:#ff8800; }
    .gc-risk.hi { border-color:var(--red); color:var(--red); }
    .gc-cat { font-family:'Share Tech Mono',monospace; font-size:9px; letter-spacing:1.5px; padding:2px 7px; border:1px solid; }
    .gc-consequence { border-left:3px solid var(--gold); padding:16px 18px; background:rgba(200,168,75,.05); }
    @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    .gc-fade { animation:fadeUp .35s ease forwards; }
    @keyframes slideR { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:translateX(0)} }
    .gc-slide { animation:slideR .28s ease forwards; }
    ::-webkit-scrollbar { width:3px; }
    ::-webkit-scrollbar-track { background:var(--bg); }
    ::-webkit-scrollbar-thumb { background:var(--brd2); border-radius:2px; }
  `;
  document.head.appendChild(s);
}

async function callAI(type: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke("geocmd-ai", {
    body: { type, ...params },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || "AI error");
  return data.data;
}

function parseJ(raw) {
  try {
    const m = raw.match(/```(?:json)?\n?([\s\S]*?)\n?```/) || raw.match(/(\[[\s\S]*?\]|\{[\s\S]*?\})/s);
    return JSON.parse(m ? m[1] : raw);
  } catch { return null; }
}

// ---- Supabase persistence helpers ----

async function loadPlayerByEmail(email: string) {
  const { data } = await supabase.from("players").select("*").eq("email", email).maybeSingle();
  return data;
}

async function upsertPlayer(email: string, callsign: string) {
  const { data } = await supabase
    .from("players")
    .upsert({ email, callsign }, { onConflict: "email" })
    .select()
    .single();
  return data;
}

async function loadOtherPlayersWithTheaters(currentPlayerId: string) {
  const { data: allPlayers } = await supabase.from("players").select("id, callsign, influence_score").neq("id", currentPlayerId);
  if (!allPlayers || allPlayers.length === 0) return [];
  const { data: allTheaters } = await supabase.from("theaters").select("player_id, scenario, history").in("player_id", allPlayers.map(p => p.id));
  return allPlayers.map(p => ({
    callsign: p.callsign,
    influence_score: p.influence_score as any,
    theaters: (allTheaters || []).filter(t => t.player_id === p.id).map(t => ({
      title: (t.scenario as any)?.title || "Inconnu",
      decisions: Array.isArray(t.history) ? (t.history as any[]).length : 0,
    })),
  }));
}

async function updatePlayerScore(playerId: string, score: any) {
  await supabase.from("players").update({ influence_score: score } as any).eq("id", playerId);
}

async function loadTheaters(playerId: string) {
  const { data } = await supabase
    .from("theaters")
    .select("*")
    .eq("player_id", playerId)
    .order("created_at", { ascending: true });
  return (data || []).map(t => ({
    dbId: t.id,
    scenario: t.scenario as any,
    history: (t.history as any) || [],
    consequence: t.consequence as any,
  }));
}

async function insertTheater(playerId: string, scenario: any) {
  const { data } = await supabase
    .from("theaters")
    .insert({ player_id: playerId, scenario, history: [] })
    .select()
    .single();
  return data;
}

async function updateTheater(theaterId: string, updates: { history?: any; consequence?: any; notified_ready?: boolean }) {
  await supabase.from("theaters").update(updates).eq("id", theaterId);
}

async function deleteTheater(theaterId: string) {
  await supabase.from("theaters").delete().eq("id", theaterId);
}

async function deletePlayerAndTheaters(playerId: string) {
  await supabase.from("theaters").delete().eq("player_id", playerId);
  await supabase.from("players").delete().eq("id", playerId);
}

// Meta (last session) — keep in localStorage for auto-login convenience
const META_KEY = "geocmd_meta";
const ldMeta = () => { try { return JSON.parse(localStorage.getItem(META_KEY) || "{}"); } catch { return {}; } };
const svMeta = (d: any) => localStorage.setItem(META_KEY, JSON.stringify(d));

const fmtDate = () => new Date().toLocaleDateString("fr-FR");
const MAX_THEATERS = 4;
const DEFAULT_SCORE = { stability: 50, diplomacy: 50, military: 50, intelligence: 50 };
const SCORE_LABELS = { stability: "STABILITÉ", diplomacy: "DIPLOMATIE", military: "MILITAIRE", intelligence: "RENSEIGNEMENT" };
const SCORE_COLORS = { stability: "#00e87a", diplomacy: "#4d8eff", military: "#ff3344", intelligence: "#c8a84b" };
function totalScore(s: any) { if (!s) return 200; return (s.stability||50)+(s.diplomacy||50)+(s.military||50)+(s.intelligence||50); }
function clampScore(s: any) { const c = {...s}; for (const k of Object.keys(c)) c[k] = Math.max(0, Math.min(100, c[k])); return c; }
function applyDeltas(current: any, deltas: any) {
  if (!deltas) return current;
  const s = { ...(current || DEFAULT_SCORE) };
  for (const k of ["stability","diplomacy","military","intelligence"]) {
    if (deltas[k] !== undefined) s[k] = (s[k]||50) + deltas[k];
  }
  return clampScore(s);
}

const FALLBACK_SCENARIOS = [
  { id:"ukraine",      title:"Guerre en Ukraine",             region:"Europe de l'Est",  type:"Conflit armé",          playerRole:"Chef d'État-Major",    playerCountry:"Ukraine",         description:"Le front s'est stabilisé mais une nouvelle offensive russe est signalée au nord-est.", urgency:5 },
  { id:"taiwan",       title:"Crise du Détroit de Taïwan",    region:"Asie-Pacifique",   type:"Tension diplomatique",  playerRole:"Président",            playerCountry:"Taïwan",          description:"La marine chinoise intensifie ses exercices. Washington réaffirme son soutien.", urgency:4 },
  { id:"sahel",        title:"Instabilité au Sahel",          region:"Afrique de l'Ouest", type:"Conflit armé",        playerRole:"Commandant en Chef",   playerCountry:"CEDEAO",          description:"Les groupes jihadistes progressent. Le Groupe Wagner étend son influence.", urgency:4 },
  { id:"terres-rares", title:"Guerre des Terres Rares",       region:"Global",            type:"Rivalité économique",  playerRole:"Ministre Industrie",   playerCountry:"Union Européenne",description:"La Chine restreint ses exportations de minéraux critiques. L'Europe réagit.", urgency:3 },
  { id:"proche-orient",title:"Tensions au Proche-Orient",     region:"Moyen-Orient",      type:"Conflit armé",         playerRole:"Premier Ministre",     playerCountry:"Israël",          description:"Escalade des tensions régionales. Les négociations de cessez-le-feu sont au point mort.", urgency:5 },
  { id:"coree",        title:"Crise Péninsule Coréenne",      region:"Asie du Nord-Est",  type:"Tension diplomatique", playerRole:"Cmd Forces Alliées",   playerCountry:"Corée du Sud",    description:"Pyongyang intensifie ses tests balistiques. Séoul renforce sa posture.", urgency:4 },
];

const FB_BRIEFING = s => ({
  classification:"TRÈS SECRET",
  situation:`Situation dégradée sur le théâtre ${s.title}. Les 24 dernières heures exigent une décision de commandement immédiate.`,
  keyDevelopments:["Mouvements adverses confirmés par imagerie satellite.", "Signal diplomatique ambigu reçu via canal secondaire.", "Pression logistique croissante sur les lignes alliées."],
  assessment:"La fenêtre d'action optimale est estimée à 48-72h. Une inaction favorise l'initiative adverse.",
  threatLevel:"ÉLEVÉ", coords:"48°52'N, 2°21'E"
});

const FB_ACTIONS = [
  { id:"a1", label:"Renforcer les positions défensives",   cat:"militaire",      catColor:"#ff3344", desc:"Consolider les lignes et positionner les réserves en profondeur.", risk:"faible",  outcome:"Stabilisation sous 48h, initiative concédée à l'adversaire." },
  { id:"a2", label:"Ouvrir un canal diplomatique secret",  cat:"diplomatique",   catColor:"#00e87a", desc:"Négociations discrètes via intermédiaire neutre.", risk:"modéré", outcome:"Désescalade possible, risque de fuite médiatique." },
  { id:"a3", label:"Opération de renseignement HUMINT",    cat:"renseignement",  catColor:"#4d8eff", desc:"Déployer des actifs clandestins dans les cercles adverses.", risk:"élevé",  outcome:"Gain informationnel critique, risque d'incident diplomatique." },
  { id:"a4", label:"Pression économique ciblée",           cat:"économique",     catColor:"#c8a84b", desc:"Sanctions sectorielles pour asphyxier les capacités adverses.", risk:"modéré", outcome:"Affaiblissement progressif sous 30 jours." },
];

const FB_CONSEQUENCE = (scenario, actionLabel) => ({
  headline: `Effets observés sur ${scenario.title}`,
  narrative: `Les premiers rapports de terrain indiquent que la décision « ${actionLabel} » produit désormais des effets mesurables. La situation reste évolutive et une consolidation du renseignement est en cours avant le prochain briefing.`,
  metrics: [],
  scoreDeltas: { stability: 2, diplomacy: -1, military: 3, intelligence: 1 },
});

function TerminalLoader({ messages=[] }) {
  const [vis, setVis] = useState(0);
  useEffect(() => {
    const ts = messages.map((_,i) => setTimeout(()=>setVis(i+1), i*560));
    return () => ts.forEach(clearTimeout);
  }, []);
  return (
    <div style={{ padding:"40px 24px", minHeight:180, display:"flex", flexDirection:"column", justifyContent:"center" }}>
      <div className="gc-m" style={{ fontSize:12, color:"#00e87a", lineHeight:2.1 }}>
        {messages.slice(0,vis).map((l,i) => <div key={i} className="gc-slide"><span style={{color:"#c8a84b"}}>▸ </span>{l}</div>)}
        {vis <= messages.length && <span style={{animation:"blink .9s infinite"}}>█</span>}
      </div>
    </div>
  );
}

function Header({ player, theaters, onProfile }) {
  const DELAY_MS = 5 * 60 * 60 * 1000;
  const waitingCount = theaters.filter(t => {
    const last = t.history[t.history.length - 1];
    const decidedAt = last?.decided_at ? new Date(last.decided_at).getTime() : 0;
    return !!(last?.decided_at && !t.consequence && decidedAt && (Date.now() - decidedAt) < DELAY_MS);
  }).length;
  const readyCount = theaters.filter(t => {
    const last = t.history[t.history.length - 1];
    const decidedAt = last?.decided_at ? new Date(last.decided_at).getTime() : 0;
    return !!(last?.decided_at && !t.consequence && decidedAt && (Date.now() - decidedAt) >= DELAY_MS);
  }).length;
  const score = player?.influence_score || DEFAULT_SCORE;
  const total = totalScore(score);
  return (
    <header className="gc-header">
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <span className="gc-h" style={{ fontSize:20, fontWeight:700, letterSpacing:4, color:"#c8a84b" }}>
          GEO<span style={{color:"#dce4f0"}}>CMD</span>
        </span>
        <span className="gc-m" style={{ fontSize:10, color:"#c8a84b", letterSpacing:1 }}>◈ {total}</span>
        {theaters.length > 0 && (
          <>
            {readyCount > 0 && (
              <span className="gc-notif-badge" title={`${readyCount} théâtre${readyCount>1?"s":""} avec résultats non consultés`}>
                {readyCount}
              </span>
            )}
            {readyCount > 0 && (
              <span className="gc-m" style={{ fontSize:10, color:"#00e87a", letterSpacing:1.5 }}>
                PRÊT{readyCount>1?"S":""}
              </span>
            )}
            {waitingCount > 0 && (
              <span className="gc-m" style={{ fontSize:10, color:"#ff8800", letterSpacing:1.5 }}>
                {waitingCount} EN ATTENTE
              </span>
            )}
            {readyCount === 0 && waitingCount === 0 && (
              <span className="gc-m" style={{ fontSize:10, color:"#5a6a88", letterSpacing:1.5 }}>
                {theaters.length} THÉÂTRE{theaters.length>1?"S":""}
              </span>
            )}
          </>
        )}
      </div>
      {player && (
        <button onClick={onProfile} style={{ background:"transparent", border:"1px solid #162030", cursor:"pointer", fontFamily:"Share Tech Mono", fontSize:11, color:"#5a6a88", padding:"5px 12px", display:"flex", alignItems:"center", gap:6, transition:"all .2s" }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor="#c8a84b";e.currentTarget.style.color="#c8a84b";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor="#162030";e.currentTarget.style.color="#5a6a88";}}
        >◈ {player.callsign}</button>
      )}
    </header>
  );
}

function LoginScreen({ onLogin }) {
  const [callsign, setCallsign] = useState("");
  const [email, setEmail] = useState("");
  const ok = callsign.trim().length >= 2 && email.includes("@");
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ width:"100%", maxWidth:400 }} className="gc-fade">
        <div style={{ textAlign:"center", marginBottom:44 }}>
          <div className="gc-h" style={{ fontSize:46, fontWeight:700, letterSpacing:8, color:"#c8a84b", lineHeight:1 }}>GEO<span style={{color:"#dce4f0"}}>CMD</span></div>
          <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", letterSpacing:3.5, marginTop:10 }}>COMMANDEMENT STRATÉGIQUE GLOBAL</div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7, marginTop:14 }}>
            <span className="gc-dot"/><span className="gc-m" style={{ fontSize:10, color:"#00e87a", letterSpacing:2 }}>RÉSEAU SIGINT ACTIF — {fmtDate()}</span>
          </div>
        </div>
        <div className="gc-panel" style={{ padding:26 }}>
          <div style={{ marginBottom:16 }}>
            <label className="gc-label">INDICATIF D'APPEL</label>
            <input className="gc-input" placeholder="EX: AIGLE-01 / ÉLYSÉE / KREMLIN" value={callsign} onChange={e=>setCallsign(e.target.value.toUpperCase())} />
          </div>
          <div style={{ marginBottom:24 }}>
            <label className="gc-label">EMAIL D'ACCRÉDITATION</label>
            <input className="gc-input" type="email" placeholder="operateur@geocmd.net" value={email} onChange={e=>setEmail(e.target.value)} />
          </div>
          <button className="gc-btn full" disabled={!ok} onClick={()=>onLogin({callsign,email})}>▸ ACCÉDER AU COMMANDEMENT</button>
        </div>
        <div className="gc-m" style={{ fontSize:9, color:"#1e2e48", textAlign:"center", marginTop:14, lineHeight:2, letterSpacing:1.5 }}>
          ACCÈS RÉSERVÉ AUX OPÉRATEURS CERTIFIÉS NIVEAU 5<br/>TOUTES LES DÉCISIONS SONT JOURNALISÉES
        </div>
      </div>
    </div>
  );
}

function HubScreen({ player, theaters, onOpenTheater, onAddTheater, onDropTheater }) {
  const today = fmtDate();
  const urgencyColor = u => u>=5?"#ff3344":u>=4?"#ff8800":"#c8a84b";

  return (
    <div style={{ padding:"24px 20px", maxWidth:480, margin:"0 auto" }} className="gc-fade">

      {/* Greeting */}
      <div style={{ marginBottom:36 }}>
        <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", letterSpacing:3 }}>COMMANDEMENT</div>
        <h1 className="gc-h" style={{ fontSize:32, fontWeight:700, letterSpacing:3, marginTop:4 }}>{player.callsign}</h1>
        <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", marginTop:6 }}>{today}</div>
      </div>

      {/* Empty state */}
      {theaters.length === 0 && (
        <div style={{ textAlign:"center", padding:"48px 0" }}>
          <div className="gc-m" style={{ fontSize:10, color:"#2e3e56", letterSpacing:3, marginBottom:20 }}>AUCUN THÉÂTRE ACTIF</div>
          <button className="gc-btn" onClick={onAddTheater}>▸ OUVRIR UN THÉÂTRE</button>
        </div>
      )}

      {/* Theater list */}
      {theaters.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
          {theaters.map((t, i) => {
            const lastH = t.history[t.history.length - 1];
            const DELAY_MS = 5 * 60 * 60 * 1000;
            const decidedAt = lastH?.decided_at ? new Date(lastH.decided_at).getTime() : 0;
            const isWaiting = !!(lastH?.decided_at && !t.consequence && decidedAt && (Date.now() - decidedAt) < DELAY_MS);
            const isReady = !!(lastH?.decided_at && !t.consequence && decidedAt && (Date.now() - decidedAt) >= DELAY_MS);
            const isAvailable = !lastH?.decided_at || !!t.consequence;
            const uc = urgencyColor(t.scenario.urgency || 3);
            const statusColor = isReady ? "#00e87a" : isWaiting ? "#ff8800" : "#5a6a88";
            const statusLabel = isReady ? "PRÊT" : isWaiting ? "EN COURS" : "EN ATTENTE";
            const barColor = isReady ? "#00e87a" : isWaiting ? "#ff8800" : uc;
            return (
              <div
                key={t.scenario.id}
                className={isReady ? "gc-ready-card" : ""}
                onClick={() => onOpenTheater(i)}
                style={{
                  display:"flex", alignItems:"center", gap:0,
                  background:"var(--surf)", border:"1px solid var(--brd)",
                  cursor:"pointer", position:"relative", overflow:"hidden",
                  transition:"border-color .15s, background .15s",
                }}
                onMouseEnter={e => { if(!isReady){e.currentTarget.style.borderColor = isWaiting?"#1e2e48":"rgba(200,168,75,0.5)"; e.currentTarget.style.background="#0d1522";} }}
                onMouseLeave={e => { if(!isReady){e.currentTarget.style.borderColor = "var(--brd)"; e.currentTarget.style.background="var(--surf)";} }}
              >
                {/* accent bar */}
                <div style={{ width:3, alignSelf:"stretch", background: barColor, flexShrink:0 }} />

                {/* content */}
                <div style={{ flex:1, padding:"16px 16px" }}>
                  <div className="gc-h" style={{ fontSize:20, fontWeight:700, letterSpacing:1, marginBottom:4 }}>
                    {t.scenario.title}
                  </div>
                  <div className="gc-m" style={{ fontSize:10, color:"#c8a84b", letterSpacing:1 }}>
                    {t.scenario.playerRole} — {t.scenario.playerCountry}
                  </div>
                  {isReady && (
                    <div className="gc-m" style={{ fontSize:9, color:"#00e87a", letterSpacing:1.5, marginTop:6 }}>
                      ◈ EFFETS DISPONIBLES — CONSULTATION REQUISE
                    </div>
                  )}
                </div>

                {/* status */}
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:10, padding:"16px 16px", flexShrink:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span className={`gc-dot ${isReady?"green":isWaiting?"orange":"grey"}`} />
                    <span className="gc-m" style={{ fontSize:9, letterSpacing:1.5, color: statusColor }}>
                      {statusLabel}
                    </span>
                  </div>
                  {t.history.length === 0 && (
                    <button
                      onClick={e => { e.stopPropagation(); if(confirm("Confirmez-vous le retrait de ce théâtre ? Le slot sera immédiatement libéré.")) onDropTheater(i); }}
                      style={{ background:"transparent", border:"none", cursor:"pointer", color:"#2e3e56", fontFamily:"Share Tech Mono", fontSize:9, letterSpacing:1, padding:0, transition:"color .15s" }}
                      onMouseEnter={e => e.currentTarget.style.color="#ff3344"}
                      onMouseLeave={e => e.currentTarget.style.color="#2e3e56"}
                    >✕ SE RETIRER</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add theater */}
      {theaters.length > 0 && (
        theaters.length < MAX_THEATERS ? (
          <button
            className="gc-btn ghost full"
            style={{ padding:"13px", letterSpacing:2, fontSize:11, borderStyle:"dashed" }}
            onClick={onAddTheater}
          >
            + AJOUTER UN THÉÂTRE
          </button>
        ) : (
          <div className="gc-m" style={{ fontSize:10, color:"#2e3e56", textAlign:"center", letterSpacing:2, padding:"12px 0" }}>
            CAPACITÉ MAXIMALE ATTEINTE ({MAX_THEATERS} THÉÂTRES)
          </div>
        )
      )}
    </div>
  );
}

function ScenarioSelect({ existingIds, onSelect, onBack }) {
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const p = await callAI("scenarios");
        setScenarios(Array.isArray(p)&&p.length>=3 ? p : FALLBACK_SCENARIOS);
      } catch { setScenarios(FALLBACK_SCENARIOS); }
      setLoading(false);
    })();
  }, []);

  const urgencyColor = u => u>=5?"#ff3344":u>=4?"#ff8800":"#c8a84b";

  return (
    <div style={{ padding:"24px 20px", maxWidth:600, margin:"0 auto" }}>
      <div style={{ marginBottom:22 }}>
        <button className="gc-btn ghost" style={{ marginBottom:16 }} onClick={onBack}>← RETOUR</button>
        <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", letterSpacing:3 }}>NOUVEAU THÉÂTRE</div>
        <h2 className="gc-h" style={{ fontSize:26, fontWeight:600, letterSpacing:2, marginTop:4 }}>CONFLITS ACTIFS</h2>
        <div style={{ display:"flex", alignItems:"center", gap:7, marginTop:6 }}>
          <span className="gc-dot"/>
          <span className="gc-m" style={{ fontSize:10, color:"#00e87a", letterSpacing:2 }}>DONNÉES EN TEMPS RÉEL — {fmtDate()}</span>
        </div>
      </div>
      {loading ? (
        <TerminalLoader messages={["CONNEXION AU RÉSEAU SIGINT...", "SCAN DES ZONES DE TENSION...", "ANALYSE DES FLUX DIPLOMATIQUES...", "COMPILATION DES THÉÂTRES..."]}/>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }} className="gc-fade">
          {scenarios.map(s => {
            const already = existingIds.includes(s.id);
            return (
              <div key={s.id} className={`gc-scenario ${sel?.id===s.id?"sel":""} ${already?"disabled":""}`}
                onClick={()=>!already&&setSel(sel?.id===s.id?null:s)}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                  <div className="gc-m" style={{ fontSize:9, color:"#5a6a88", letterSpacing:2 }}>{s.region} — {(s.type||"").toUpperCase()}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    {already && <span className="gc-m" style={{ fontSize:9, color:"#5a6a88" }}>ACTIF</span>}
                    <div style={{ display:"flex", gap:3 }}>
                      {[1,2,3,4,5].map(n=>(
                        <div key={n} style={{ width:7, height:7, background:n<=(s.urgency||3)?urgencyColor(s.urgency):"#162030" }}/>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="gc-h" style={{ fontSize:19, fontWeight:600, marginBottom:3 }}>{s.title}</div>
                <div className="gc-m" style={{ fontSize:11, color:"#c8a84b", marginBottom:8 }}>{s.playerRole} / {s.playerCountry}</div>
                <p style={{ fontSize:13, color:"#8a9ab8", lineHeight:1.58 }}>{s.description}</p>
                {sel?.id===s.id && (
                  <div style={{ marginTop:14 }}>
                    <button className="gc-btn full" onClick={()=>onSelect(s)}>▸ PRENDRE LE COMMANDEMENT</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TheaterView({ theater, theaterIndex, onDecisionMade, onBack }) {
  const [phase, setPhase] = useState("idle"); // idle → briefing → actions → confirmed
  const [briefing, setBriefing] = useState(null);
  const [actions, setActions] = useState(null);
  const [actionsReady, setActionsReady] = useState(false);
  const [selAction, setSelAction] = useState(null);

  // Scroll to top on phase change
  useEffect(() => { window.scrollTo(0, 0); }, [phase]);

  const { scenario, history } = theater;
  const today = fmtDate();
  // A decision is "pending" if the last history entry has decided_at but no consequence yet
  const lastEntry_ = history[history.length - 1];
  const hasPendingDecision = !!(lastEntry_?.decided_at && !theater.consequence);
  // Player can start a new briefing only if there's no pending unresolved decision
  const canStartNewBriefing = !hasPendingDecision;

  useEffect(() => {
    if (phase !== "briefing") return;
    if (hasPendingDecision) return;
    let alive = true;
    (async () => {
      let brief = null;
      try {
        const hctx = history.length
          ? history.slice(-3).map(h=>h.actionLabel)
          : [];
        brief = await callAI("briefing", { scenario, history: history.slice(-3) });
        if (!brief || !brief.situation) brief = FB_BRIEFING(scenario);
      } catch { brief = FB_BRIEFING(scenario); }
      if (!alive) return;
      setBriefing(brief);

      let acts = null;
      try {
        acts = await callAI("actions", { scenario, briefing: brief });
        if (!Array.isArray(acts)||acts.length<2) acts = FB_ACTIONS;
      } catch { acts = FB_ACTIONS; }
      if (!alive) return;
      setActions(acts);
      setActionsReady(true);
    })();
    return () => { alive = false; };
  }, [phase]);

  const handleConfirm = () => {
    if (!selAction) return;
    // Store decision with timestamp — consequence will be generated after 5h
    onDecisionMade(theaterIndex, selAction, null);
    setPhase("confirmed");
  };

  const riskClass = r => r==="faible"?"lo":r==="modéré"?"md":"hi";
  const urgencyColor = u => u>=5?"#ff3344":u>=4?"#ff8800":"#c8a84b";

  // 5-hour delay logic for consequences
  const DELAY_MS = 5 * 60 * 60 * 1000; // 5 hours
  const lastEntry = history[history.length - 1];
  const decidedAt = lastEntry?.decided_at ? new Date(lastEntry.decided_at).getTime() : 0;
  const elapsed = decidedAt ? Date.now() - decidedAt : Infinity;
  const consequenceReady = elapsed >= DELAY_MS;
  const [countdown, setCountdown] = useState("");
  const [generatingConsequence, setGeneratingConsequence] = useState(false);
  const generatingConsequenceRef = useRef(false);

  // Countdown timer
  useEffect(() => {
    if (!lastEntry?.decided_at || theater.consequence || consequenceReady) return;
    const tick = () => {
      const remaining = DELAY_MS - (Date.now() - decidedAt);
      if (remaining <= 0) { setCountdown(""); return; }
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [lastEntry?.decided_at, theater.consequence, consequenceReady, decidedAt]);

  // Auto-generate consequence when 5h elapsed
  useEffect(() => {
    if (!lastEntry?.decided_at || !consequenceReady || theater.consequence) return;
    if (phase !== "idle") return;
    if (generatingConsequenceRef.current) return;

    let alive = true;
    generatingConsequenceRef.current = true;
    setGeneratingConsequence(true);

    (async () => {
      const action = { id: lastEntry.actionId, label: lastEntry.actionLabel, outcome: "" };
      try {
        const parsed = await callAI("consequence", { scenario, action });
        const safeConsequence = parsed?.headline && parsed?.narrative
          ? parsed
          : FB_CONSEQUENCE(scenario, action.label);
        if (alive) onDecisionMade(theaterIndex, action, safeConsequence);
      } catch {
        if (alive) onDecisionMade(theaterIndex, action, FB_CONSEQUENCE(scenario, action.label));
      } finally {
        generatingConsequenceRef.current = false;
        if (alive) setGeneratingConsequence(false);
      }
    })();

    return () => { alive = false; };
  }, [phase, consequenceReady, theater.consequence, lastEntry?.decided_at, onDecisionMade, scenario, theaterIndex]);

  // ── IDLE : résumé du théâtre, pas de chargement ──
  if (phase === "idle" && canStartNewBriefing) {
    const last = history[history.length - 1];
    return (
      <div style={{ padding:"24px 20px", maxWidth:580, margin:"0 auto" }} className="gc-fade">
        <button className="gc-btn ghost" style={{ marginBottom:20 }} onClick={onBack}>← COMMANDEMENT</button>

        {/* Header théâtre */}
        <div style={{ marginBottom:24 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <span className="gc-m" style={{ fontSize:9, color:"#5a6a88", letterSpacing:2 }}>
              {scenario.region} — {(scenario.type||"").toUpperCase()}
            </span>
            <div style={{ display:"flex", gap:3 }}>
              {[1,2,3,4,5].map(n=>(
                <div key={n} style={{ width:8, height:8, background:n<=(scenario.urgency||3)?urgencyColor(scenario.urgency):"#162030" }}/>
              ))}
            </div>
          </div>
          <h2 className="gc-h" style={{ fontSize:28, fontWeight:700, letterSpacing:2, marginBottom:4 }}>{scenario.title}</h2>
          <div className="gc-m" style={{ fontSize:12, color:"#c8a84b" }}>{scenario.playerRole} — {scenario.playerCountry}</div>
        </div>

        {/* Consequence du jour précédent (only shown once ready) */}
        {theater.consequence && (
          <div style={{ marginBottom:20 }}>
            <div className="gc-m" style={{ fontSize:10, color:"#c8a84b", letterSpacing:2.5, marginBottom:8 }}>◈ EFFETS DE VOTRE DERNIÈRE DÉCISION</div>
            <div className="gc-consequence">
              <div className="gc-h" style={{ fontSize:16, fontWeight:600, marginBottom:6 }}>{theater.consequence.headline}</div>
              <p style={{ fontSize:13, color:"#8a9ab8", lineHeight:1.65 }}>{theater.consequence.narrative}</p>
              {theater.consequence.metrics?.length > 0 && (
                <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
                  {theater.consequence.metrics.map((m,i) => (
                    <span key={i} className="gc-m" style={{ fontSize:10, padding:"3px 8px", border:`1px solid ${m.positive?"#00e87a":"#ff3344"}`, color:m.positive?"#00e87a":"#ff3344" }}>
                      {m.label}: {m.change}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pending consequence — waiting for 5h delay */}
        {!theater.consequence && last?.decided_at && !consequenceReady && (
          <div style={{ marginBottom:20 }}>
            <div className="gc-m" style={{ fontSize:10, color:"#ff8800", letterSpacing:2.5, marginBottom:8 }}>◈ ORDRE EN COURS D'EXÉCUTION</div>
            <div className="gc-panel" style={{ padding:18 }}>
              <div style={{ fontSize:14, color:"#dce4f0", marginBottom:8 }}>{last.actionLabel}</div>
              <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", marginBottom:12 }}>Transmis le {last.date}</div>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <span className="gc-dot"/>
                <div>
                  <div className="gc-m" style={{ fontSize:10, color:"#ff8800", letterSpacing:2 }}>DÉPLOIEMENT EN COURS</div>
                  <div className="gc-h" style={{ fontSize:28, fontWeight:700, color:"#c8a84b", marginTop:4, letterSpacing:3 }}>{countdown}</div>
                  <div className="gc-m" style={{ fontSize:9, color:"#2e3e56", marginTop:4, letterSpacing:1.5 }}>EFFETS SUR LE TERRAIN DANS {countdown}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Generating consequence */}
        {!theater.consequence && last?.decided_at && consequenceReady && generatingConsequence && (
          <div style={{ marginBottom:20 }}>
            <TerminalLoader messages={["ANALYSE DES EFFETS SUR LE TERRAIN...", "COMPILATION DES RAPPORTS DE SITUATION...", "ÉVALUATION DES CONSÉQUENCES..."]}/>
          </div>
        )}

        {/* Dernière décision si pas de conséquence et pas de decided_at (legacy) */}
        {!theater.consequence && last && !last.decided_at && (
          <div style={{ marginBottom:20 }}>
            <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", letterSpacing:2, marginBottom:8 }}>◈ DERNIÈRE DÉCISION</div>
            <div style={{ borderLeft:"2px solid #1e2e48", paddingLeft:14 }}>
              <div style={{ fontSize:13, color:"#dce4f0", marginBottom:3 }}>{last.actionLabel}</div>
              <div className="gc-m" style={{ fontSize:10, color:"#2e3e56" }}>Transmis le {last.date}</div>
            </div>
          </div>
        )}

        <div className="gc-div"/>

        {/* CTA principal — disabled while waiting for consequence */}
        {(!last?.decided_at || theater.consequence || consequenceReady) ? (
          <>
            <button className="gc-btn full" onClick={() => setPhase("briefing")}>
              ▸ LANCER LE BRIEFING DU JOUR
            </button>
            <div className="gc-m" style={{ fontSize:9, color:"#2e3e56", textAlign:"center", marginTop:10, letterSpacing:1.5 }}>
              J+{history.length + 1} — {today}
            </div>
          </>
        ) : (
          <div className="gc-m" style={{ fontSize:10, color:"#2e3e56", textAlign:"center", letterSpacing:2 }}>
            ATTENDEZ LA RÉSOLUTION DE VOTRE ORDRE POUR LANCER UN NOUVEAU BRIEFING
          </div>
        )}
      </div>
    );
  }

  // Already played today
  // Show "pending" state when a decision is awaiting its consequence
  if (phase === "idle" && hasPendingDecision) {
    const last = history[history.length-1];
    return (
      <div style={{ padding:"24px 20px", maxWidth:580, margin:"0 auto" }} className="gc-fade">
        <button className="gc-btn ghost" style={{ marginBottom:20 }} onClick={onBack}>← COMMANDEMENT</button>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
          <span className="gc-badge ts">TRÈS SECRET</span>
          <span className="gc-m" style={{ fontSize:10, color:"#5a6a88" }}>{today}</span>
        </div>
        <div className="gc-h" style={{ fontSize:22, fontWeight:600, letterSpacing:2, marginTop:10, marginBottom:3 }}>{scenario.title}</div>
        <div className="gc-m" style={{ fontSize:11, color:"#c8a84b", marginBottom:22 }}>{scenario.playerRole} — {scenario.playerCountry}</div>
        <div className="gc-panel" style={{ padding:20, marginBottom:16 }}>
          <div className="gc-m" style={{ fontSize:11, color:"#ff8800", marginBottom:8 }}>⏳ ORDRE EN COURS D'EXÉCUTION</div>
          <div style={{ fontSize:14, color:"#dce4f0", marginBottom:4 }}>{last?.actionLabel}</div>
          <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", marginBottom:12 }}>Transmis le {last?.date}</div>
          {!consequenceReady && countdown && (
            <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:8 }}>
              <span className="gc-dot orange"/>
              <div>
                <div className="gc-m" style={{ fontSize:10, color:"#ff8800", letterSpacing:2 }}>DÉPLOIEMENT EN COURS</div>
                <div className="gc-h" style={{ fontSize:32, fontWeight:700, color:"#c8a84b", marginTop:4, letterSpacing:4 }}>{countdown}</div>
                <div className="gc-m" style={{ fontSize:9, color:"#5a6a88", marginTop:4, letterSpacing:1.5 }}>EFFETS SUR LE TERRAIN DANS {countdown}</div>
              </div>
            </div>
          )}
          {consequenceReady && generatingConsequence && (
            <TerminalLoader messages={["ANALYSE DES EFFETS SUR LE TERRAIN...", "COMPILATION DES RAPPORTS...", "ÉVALUATION DES CONSÉQUENCES..."]}/>
          )}
        </div>
        <div className="gc-div"/>
        <div className="gc-m" style={{ fontSize:10, color:"#2e3e56", textAlign:"center", letterSpacing:2 }}>ATTENDEZ LA RÉSOLUTION DE VOTRE ORDRE</div>
      </div>
    );
  }

  // Confirmed
  if (phase === "confirmed") {
    return (
      <div style={{ minHeight:"80vh", display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 20px" }}>
        <div style={{ maxWidth:480, width:"100%", textAlign:"center" }} className="gc-fade">
          <div className="gc-m" style={{ fontSize:9, color:"#5a6a88", letterSpacing:2, marginBottom:6 }}>{scenario.title}</div>
          <div className="gc-m" style={{ fontSize:11, color:"#00e87a", letterSpacing:4, marginBottom:14 }}>✓ ORDRE TRANSMIS</div>
          <h2 className="gc-h" style={{ fontSize:26, fontWeight:700, letterSpacing:2, marginBottom:10 }}>{selAction?.label}</h2>
          <p style={{ fontSize:13, color:"#5a6a88", lineHeight:1.72, marginBottom:24 }}>Vos directives ont été transmises.<br/>Les effets sur le terrain seront visibles dans 5 heures.</p>
          <div className="gc-panel" style={{ padding:18, marginBottom:22, textAlign:"left" }}>
            <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", letterSpacing:2, marginBottom:6 }}>◈ RÉSULTAT ATTENDU</div>
            <p style={{ fontSize:13, color:"#8a9ab8", lineHeight:1.68 }}>{selAction?.outcome}</p>
          </div>
          <button className="gc-btn full" onClick={onBack}>▸ RETOUR AU COMMANDEMENT</button>
        </div>
      </div>
    );
  }

  // Briefing
  if (phase === "briefing") {
    return (
      <div style={{ padding:"24px 20px", maxWidth:580, margin:"0 auto" }}>
        <button className="gc-btn ghost" style={{ marginBottom:16 }} onClick={onBack}>← COMMANDEMENT</button>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span className="gc-badge ts">{briefing?.classification||"TRÈS SECRET"}</span>
          <span className="gc-m" style={{ fontSize:10, color:"#5a6a88" }}>{today} — J+{Math.max(1,history.length)}</span>
        </div>
        <h2 className="gc-h" style={{ fontSize:22, fontWeight:600, letterSpacing:2, marginTop:10 }}>BRIEFING QUOTIDIEN</h2>
        <div className="gc-m" style={{ fontSize:11, color:"#c8a84b", marginBottom:20 }}>{scenario.playerRole} — {scenario.playerCountry}</div>
        {!briefing ? (
          <TerminalLoader messages={["CONNEXION RÉSEAU SIGINT...", "DÉCRYPTAGE DES FLUX...", "COMPILATION DES RAPPORTS...", "GÉNÉRATION DU BRIEFING..."]}/>
        ) : (
          <div className="gc-fade">
            <div className="gc-panel" style={{ padding:20, marginBottom:14 }}>
              <div className="gc-m" style={{ fontSize:10, color:"#c8a84b", letterSpacing:2.5, marginBottom:10 }}>◈ SITUATION ACTUELLE</div>
              <p style={{ fontSize:14, lineHeight:1.78, color:"#dce4f0" }}>{briefing.situation}</p>
            </div>
            <div style={{ marginBottom:14 }}>
              <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", letterSpacing:2.5, marginBottom:10 }}>◈ DÉVELOPPEMENTS CLÉS</div>
              {(briefing.keyDevelopments||[]).map((d,i,arr) => (
                <div key={i} style={{ display:"flex", gap:12, padding:"10px 0", borderBottom:i<arr.length-1?"1px solid #162030":"none" }}>
                  <span className="gc-m" style={{ color:"#c8a84b", fontSize:11, flexShrink:0 }}>{String(i+1).padStart(2,"0")}</span>
                  <span style={{ fontSize:13, color:"#8a9ab8", lineHeight:1.62 }}>{d}</span>
                </div>
              ))}
            </div>
            <div style={{ borderLeft:"3px solid #c8a84b", paddingLeft:16, marginBottom:20 }}>
              <div className="gc-m" style={{ fontSize:10, color:"#c8a84b", letterSpacing:2.5, marginBottom:8 }}>◈ APPRÉCIATION DU RENSEIGNEMENT</div>
              <p style={{ fontSize:13, color:"#8a9ab8", lineHeight:1.68 }}>{briefing.assessment}</p>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
              <div>
                <span className="gc-m" style={{ fontSize:10, color:"#5a6a88" }}>MENACE : </span>
                <span className="gc-m" style={{ fontSize:10, color:"#ff3344", letterSpacing:2 }}>{briefing.threatLevel||"ÉLEVÉ"}</span>
              </div>
              <span className="gc-m" style={{ fontSize:10, color:"#2e3e56" }}>{briefing.coords}</span>
            </div>
            {!actionsReady ? (
              <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 0" }}>
                <span className="gc-dot"/><span className="gc-m" style={{ fontSize:11, color:"#5a6a88", letterSpacing:2 }}>GÉNÉRATION DES OPTIONS D'ACTION...</span>
              </div>
            ) : (
              <button className="gc-btn full" onClick={()=>setPhase("actions")}>▸ CHOISIR UNE ACTION</button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Actions
  return (
    <div style={{ padding:"24px 20px", maxWidth:580, margin:"0 auto" }} className="gc-fade">
      <div style={{ marginBottom:22 }}>
        <button className="gc-btn ghost" style={{ marginBottom:16 }} onClick={()=>setPhase("briefing")}>← BRIEFING</button>
        <div className="gc-m" style={{ fontSize:9, color:"#5a6a88", letterSpacing:2, marginBottom:4 }}>{scenario.title}</div>
        <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", letterSpacing:3 }}>DÉCISION DU JOUR</div>
        <h2 className="gc-h" style={{ fontSize:24, fontWeight:600, letterSpacing:2, marginTop:4 }}>CHOISISSEZ VOTRE ACTION</h2>
        <p style={{ fontSize:13, color:"#5a6a88", marginTop:6, lineHeight:1.62 }}>Votre décision produira des effets demain.</p>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:9, marginBottom:24 }}>
        {(actions||FB_ACTIONS).map(a => (
          <div key={a.id} className={`gc-action ${selAction?.id===a.id?"sel":""}`} onClick={()=>setSelAction(selAction?.id===a.id?null:a)}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span className="gc-cat" style={{ color:a.catColor||"#c8a84b", borderColor:a.catColor||"#c8a84b" }}>{(a.cat||"").toUpperCase()}</span>
              <span className={`gc-risk ${riskClass(a.risk)}`}>RISQUE {(a.risk||"").toUpperCase()}</span>
            </div>
            <div className="gc-h" style={{ fontSize:17, fontWeight:600, marginBottom:6 }}>{a.label}</div>
            <p style={{ fontSize:13, color:"#8a9ab8", lineHeight:1.58, marginBottom:8 }}>{a.desc}</p>
            <div className="gc-m" style={{ fontSize:10, color:"#5a6a88" }}>RÉSULTAT PROJETÉ : <span style={{color:"#c8a84b"}}>{a.outcome}</span></div>
          </div>
        ))}
      </div>
      <button className="gc-btn full" disabled={!selAction} onClick={handleConfirm}>▸ TRANSMETTRE L'ORDRE</button>
      <div className="gc-m" style={{ fontSize:9, color:"#1e2e48", textAlign:"center", marginTop:10, letterSpacing:1.5 }}>DÉCISION DÉFINITIVE — IRRÉVERSIBLE</div>
    </div>
  );
}

function ScoreBar({ label, value, color }) {
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <span className="gc-m" style={{ fontSize:9, color:"#5a6a88", letterSpacing:1.5 }}>{label}</span>
        <span className="gc-m" style={{ fontSize:11, color, fontWeight:700 }}>{value}</span>
      </div>
      <div style={{ height:4, background:"#162030", position:"relative" }}>
        <div style={{ height:"100%", width:`${value}%`, background:color, transition:"width .6s ease", boxShadow:`0 0 8px ${color}44` }}/>
      </div>
    </div>
  );
}

function ScorePanel({ score, compact = false }) {
  const s = score || DEFAULT_SCORE;
  return (
    <div className="gc-panel" style={{ padding: compact ? 12 : 18, marginBottom: compact ? 0 : 20 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: compact ? 8 : 14 }}>
        <span className="gc-m" style={{ fontSize:10, color:"#5a6a88", letterSpacing:2 }}>INFLUENCE GÉOPOLITIQUE</span>
        <span className="gc-h" style={{ fontSize: compact ? 20 : 28, fontWeight:700, color:"#c8a84b" }}>{totalScore(s)}</span>
      </div>
      {Object.keys(SCORE_LABELS).map(k => (
        <ScoreBar key={k} label={SCORE_LABELS[k]} value={s[k]||50} color={SCORE_COLORS[k]}/>
      ))}
    </div>
  );
}

function ProfileScreen({ player, theaters, onBack, onReset, onCommunity, onSettings }) {
  const total    = theaters.reduce((acc, t) => acc + t.history.length, 0);
  const nbT      = theaters.length;
  const [confirming, setConfirming] = useState(false);
  return (
    <div style={{ padding:"24px 20px", maxWidth:580, margin:"0 auto" }} className="gc-fade">
      <div style={{ marginBottom:24 }}>
        <button className="gc-btn ghost" style={{ marginBottom:16 }} onClick={onBack}>← RETOUR</button>
        <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", letterSpacing:3 }}>DOSSIER OPÉRATEUR</div>
        <h2 className="gc-h" style={{ fontSize:26, fontWeight:700, letterSpacing:3, marginTop:4 }}>{player.callsign}</h2>
        <div className="gc-m" style={{ fontSize:11, color:"#5a6a88", marginTop:3 }}>{player.email}</div>
      </div>

      <ScorePanel score={player.influence_score}/>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:24 }}>
        {[
          { l:"DÉCISIONS TOTALES", v: total },
          { l:"THÉÂTRES SUIVIS",   v: nbT  },
          { l:"ACCRÉDITATION",     v:"NV.5" },
          { l:"DATE",              v: fmtDate() },
        ].map((s, i) => (
          <div key={i} className="gc-panel" style={{ padding:16 }}>
            <div className="gc-m" style={{ fontSize:9, color:"#5a6a88", letterSpacing:1.5, marginBottom:6 }}>{s.l}</div>
            <div className="gc-h" style={{ fontSize:24, color:"#c8a84b", fontWeight:700 }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Liste explicite de tous les théâtres */}
      {nbT === 0 ? (
        <p style={{ fontSize:13, color:"#5a6a88" }}>Aucun théâtre actif.</p>
      ) : (
        theaters.map((t, ti) => (
          <div key={`${t.scenario.id}-${ti}`} style={{ marginBottom:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <div className="gc-m" style={{ fontSize:10, color:"#c8a84b", letterSpacing:2 }}>
                ◈ {t.scenario.title.toUpperCase()}
              </div>
              <div className="gc-m" style={{ fontSize:9, color:"#5a6a88" }}>
                {t.history.length} DÉCISION{t.history.length !== 1 ? "S" : ""}
              </div>
            </div>
            {t.history.length === 0 ? (
              <p style={{ fontSize:12, color:"#2e3e56", paddingLeft:12 }}>Aucune décision enregistrée.</p>
            ) : (
              [...t.history].reverse().slice(0, 5).map((e, i) => (
                <div key={i} style={{ display:"flex", gap:14, padding:"9px 0 9px 12px", borderBottom:"1px solid #162030" }}>
                  <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", flexShrink:0 }}>{e.date}</div>
                  <div style={{ fontSize:12, color:"#8a9ab8" }}>{e.actionLabel}</div>
                </div>
              ))
            )}
          </div>
        ))
      )}
      <div className="gc-div"/>
      <button className="gc-btn full" style={{ marginBottom:14 }} onClick={onSettings}>▸ PARAMÈTRES NOTIFICATIONS</button>
      <button className="gc-btn full" style={{ marginBottom:14 }} onClick={onCommunity}>▸ OPÉRATEURS EN LIGNE</button>
      {!confirming ? (
        <button className="gc-btn danger" onClick={() => setConfirming(true)}>
          RÉINITIALISER LE DOSSIER
        </button>
      ) : (
        <div style={{ background:"rgba(255,51,68,0.06)", border:"1px solid rgba(255,51,68,0.3)", padding:"16px 18px" }}>
          <div className="gc-m" style={{ fontSize:11, color:"#ff3344", letterSpacing:1.5, marginBottom:12 }}>
            CONFIRMER LA SUPPRESSION DÉFINITIVE ?
          </div>
          <p style={{ fontSize:12, color:"#5a6a88", marginBottom:16, lineHeight:1.6 }}>
            Toutes vos décisions, théâtres et données seront effacés. Cette action est irréversible.
          </p>
          <div style={{ display:"flex", gap:10 }}>
            <button className="gc-btn danger" style={{ flex:1, justifyContent:"center" }} onClick={onReset}>
              ✕ CONFIRMER
            </button>
            <button className="gc-btn ghost" style={{ flex:1, justifyContent:"center" }} onClick={() => setConfirming(false)}>
              ANNULER
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommunityScreen({ playerId, onBack }) {
  const [others, setOthers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    loadOtherPlayersWithTheaters(playerId).then(d => { setOthers(d); setLoading(false); });
  }, [playerId]);
  return (
    <div style={{ padding:"24px 20px", maxWidth:580, margin:"0 auto" }} className="gc-fade">
      <button className="gc-btn ghost" style={{ marginBottom:16 }} onClick={onBack}>← RETOUR</button>
      <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", letterSpacing:3, marginBottom:4 }}>RÉSEAU DE COMMANDEMENT</div>
      <h2 className="gc-h" style={{ fontSize:24, fontWeight:700, letterSpacing:3, marginTop:4, marginBottom:20 }}>OPÉRATEURS EN LIGNE</h2>
      {loading ? (
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"20px 0" }}>
          <span className="gc-dot"/><span className="gc-m" style={{ fontSize:11, color:"#5a6a88", letterSpacing:2 }}>CHARGEMENT...</span>
        </div>
      ) : others.length === 0 ? (
        <p style={{ fontSize:13, color:"#5a6a88" }}>Aucun autre opérateur enregistré.</p>
      ) : (
        others.sort((a, b) => totalScore(b.influence_score) - totalScore(a.influence_score)).map((o, i) => (
          <div key={i} className="gc-panel" style={{ padding:16, marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
              <div className="gc-h" style={{ fontSize:18, fontWeight:600, color:"#c8a84b" }}>{o.callsign}</div>
              <div className="gc-h" style={{ fontSize:18, fontWeight:700, color:"#c8a84b" }}>◈ {totalScore(o.influence_score)}</div>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
              {Object.keys(SCORE_LABELS).map(k => (
                <span key={k} className="gc-m" style={{ fontSize:8, color:SCORE_COLORS[k], letterSpacing:0.5 }}>
                  {SCORE_LABELS[k].slice(0,3)} {(o.influence_score||DEFAULT_SCORE)[k]||50}
                </span>
              ))}
            </div>
            <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", marginBottom:6 }}>{o.theaters.length} THÉÂTRE{o.theaters.length !== 1 ? "S" : ""}</div>
            {o.theaters.length === 0 ? (
              <p style={{ fontSize:12, color:"#2e3e56", paddingLeft:4 }}>Aucun théâtre actif.</p>
            ) : (
              o.theaters.map((th, j) => (
                <div key={j} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, padding:"5px 0 5px 4px", borderBottom: j < o.theaters.length-1 ? "1px solid #162030" : "none" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span className="gc-m" style={{ fontSize:9, color:"#c8a84b" }}>◈</span>
                    <span style={{ fontSize:12, color:"#8a9ab8" }}>{th.title}</span>
                  </div>
                  <span className="gc-m" style={{ fontSize:9, color:"#5a6a88" }}>{th.decisions} ACTION{th.decisions !== 1 ? "S" : ""}</span>
                </div>
              ))
            )}
          </div>
        ))
      )}
    </div>
  );
}

const NOTIF_PREFS_KEY = "geocmd_notif_prefs";
function getNotifPrefs(): { flash: boolean; theater: boolean; community: boolean } {
  try { const v = JSON.parse(localStorage.getItem(NOTIF_PREFS_KEY) || "{}"); return { flash: v.flash !== false, theater: v.theater !== false, community: v.community !== false }; } catch { return { flash: true, theater: true, community: true }; }
}
function saveNotifPrefs(prefs: { flash: boolean; theater: boolean }) {
  localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs));
}

function SettingsScreen({ playerId, onBack }) {
  const [prefs, setPrefs] = useState(getNotifPrefs);
  const [saving, setSaving] = useState(false);
  const toggle = async (key: "flash" | "theater" | "community") => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    saveNotifPrefs(next);
    if (playerId) {
      setSaving(true);
      await supabase.from("push_subscriptions").update({
        notify_flash: next.flash,
        notify_theater: next.theater,
        notify_community: next.community,
      }).eq("player_id", playerId);
      setSaving(false);
    }
  };
  return (
    <div style={{ padding:"24px 20px", maxWidth:580, margin:"0 auto" }} className="gc-fade">
      <button className="gc-btn ghost" style={{ marginBottom:16 }} onClick={onBack}>← RETOUR</button>
      <div className="gc-m" style={{ fontSize:10, color:"#5a6a88", letterSpacing:3, marginBottom:4 }}>CONFIGURATION</div>
      <h2 className="gc-h" style={{ fontSize:24, fontWeight:700, letterSpacing:3, marginTop:4, marginBottom:24 }}>NOTIFICATIONS</h2>

      {[
        { key: "flash" as const, label: "ÉVÉNEMENTS FLASH", desc: "Alertes push lors de nouvelles crises éclair (probabilité 25%/heure)." },
        { key: "theater" as const, label: "THÉÂTRES — STATUT PRÊT", desc: "Notification push lorsqu'un théâtre est prêt après 5 heures d'attente." },
        { key: "community" as const, label: "ALERTES COMMUNAUTAIRES", desc: "Notification quand un autre opérateur rejoint un théâtre dans la même région que l'un des vôtres." },
      ].map(item => (
        <div key={item.key} className="gc-panel" style={{ padding:18, marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <span className="gc-m" style={{ fontSize:11, color:"#c8a84b", letterSpacing:2 }}>{item.label}</span>
            <button
              onClick={() => toggle(item.key)}
              disabled={saving}
              style={{
                width:48, height:26, borderRadius:13, border:"none", cursor:"pointer",
                background: prefs[item.key] ? "#00e87a" : "#2e3e56",
                position:"relative", transition:"background .2s",
                opacity: saving ? 0.6 : 1,
              }}
            >
              <div style={{
                width:20, height:20, borderRadius:10, background:"#fff",
                position:"absolute", top:3,
                left: prefs[item.key] ? 25 : 3,
                transition:"left .2s",
              }}/>
            </button>
          </div>
          <p style={{ fontSize:12, color:"#5a6a88", lineHeight:1.5, margin:0 }}>{item.desc}</p>
        </div>
      ))}

      <div className="gc-panel" style={{ padding:16, marginTop:10 }}>
        <p style={{ fontSize:11, color:"#5a6a88", lineHeight:1.6, margin:0 }}>
          ℹ Les notifications push nécessitent l'autorisation du navigateur. Si vous désactivez un type ci-dessus, les notifications correspondantes ne seront plus envoyées à ce terminal.
        </p>
      </div>
    </div>
  );
}

function FlashEventBanner({ events, respondedIds, playerId, onRespond }) {
  const active = events.filter(e => !respondedIds.includes(e.id));
  const [sel, setSel] = useState<string | null>(null);
  const [selOption, setSelOption] = useState<any>(null);
  const [countdowns, setCountdowns] = useState<Record<string, string>>({});

  useEffect(() => {
    const tick = () => {
      const cd: Record<string, string> = {};
      for (const ev of active) {
        const remaining = new Date(ev.expires_at).getTime() - Date.now();
        if (remaining <= 0) { cd[ev.id] = "EXPIRÉ"; continue; }
        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        cd[ev.id] = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
      }
      setCountdowns(cd);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [active.length]);

  if (active.length === 0) return null;

  const urgencyColor = (u: number) => u >= 5 ? "#ff3344" : u >= 4 ? "#ff8800" : "#c8a84b";
  const catColor = (cat: string) => cat === "militaire" ? "#ff3344" : cat === "diplomatique" ? "#00e87a" : cat === "économique" ? "#c8a84b" : "#4d8eff";

  return (
    <div style={{ padding: "0 20px", maxWidth: 480, margin: "0 auto" }}>
      {active.map(ev => {
        const isOpen = sel === ev.id;
        const options = Array.isArray(ev.options) ? ev.options : [];
        const expired = countdowns[ev.id] === "EXPIRÉ";

        return (
          <div key={ev.id} style={{
            marginBottom: 12,
            border: `1px solid ${urgencyColor(ev.urgency)}`,
            background: `rgba(${ev.urgency >= 5 ? "255,51,68" : ev.urgency >= 4 ? "255,136,0" : "200,168,75"}, 0.08)`,
            animation: "fadeUp .35s ease forwards",
          }}>
            <div
              onClick={() => { setSel(isOpen ? null : ev.id); setSelOption(null); }}
              style={{ padding: "14px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14 }}>⚡</span>
                  <span className="gc-m" style={{ fontSize: 9, color: urgencyColor(ev.urgency), letterSpacing: 2, animation: "blink 1.5s ease-in-out infinite" }}>
                    CRISE FLASH
                  </span>
                </div>
                <div className="gc-h" style={{ fontSize: 17, fontWeight: 700, letterSpacing: 1 }}>{ev.title}</div>
                <div className="gc-m" style={{ fontSize: 10, color: "#5a6a88", marginTop: 4 }}>{ev.region} — {(ev.event_type || "").toUpperCase()}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div className="gc-h" style={{ fontSize: 18, fontWeight: 700, color: expired ? "#ff3344" : urgencyColor(ev.urgency), letterSpacing: 2 }}>
                  {countdowns[ev.id] || "..."}
                </div>
                <div className="gc-m" style={{ fontSize: 8, color: "#5a6a88", letterSpacing: 1.5 }}>TEMPS RESTANT</div>
              </div>
            </div>

            {isOpen && !expired && (
              <div style={{ padding: "0 16px 16px", animation: "fadeUp .25s ease forwards" }}>
                <p style={{ fontSize: 13, color: "#8a9ab8", lineHeight: 1.65, marginBottom: 14 }}>{ev.description}</p>
                <div className="gc-m" style={{ fontSize: 10, color: "#5a6a88", letterSpacing: 2, marginBottom: 10 }}>◈ RÉPONSE RAPIDE</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {options.map((opt: any) => (
                    <div
                      key={opt.id}
                      onClick={() => setSelOption(selOption?.id === opt.id ? null : opt)}
                      style={{
                        padding: "12px 14px",
                        border: `1px solid ${selOption?.id === opt.id ? catColor(opt.cat) : "var(--brd)"}`,
                        background: selOption?.id === opt.id ? `${catColor(opt.cat)}11` : "var(--surf)",
                        cursor: "pointer",
                        transition: "all .15s",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span className="gc-h" style={{ fontSize: 14, fontWeight: 600 }}>{opt.label}</span>
                        <span className="gc-m" style={{ fontSize: 8, color: catColor(opt.cat), letterSpacing: 1 }}>{(opt.cat || "").toUpperCase()}</span>
                      </div>
                      <p style={{ fontSize: 12, color: "#5a6a88", lineHeight: 1.5 }}>{opt.desc}</p>
                    </div>
                  ))}
                </div>
                {selOption && (
                  <button
                    className="gc-btn full"
                    style={{ marginTop: 12 }}
                    onClick={() => onRespond(ev.id, selOption)}
                  >
                    ▸ CONFIRMER LA RÉPONSE
                  </button>
                )}
              </div>
            )}

            {isOpen && expired && (
              <div style={{ padding: "0 16px 16px" }}>
                <div className="gc-m" style={{ fontSize: 11, color: "#ff3344", letterSpacing: 2 }}>ÉVÉNEMENT EXPIRÉ — RÉPONSE IMPOSSIBLE</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════
export default function GeoCommand() {
  useEffect(() => injectStyles(), []);
  const [screen, setScreen_]   = useState("init");
  const setScreen = useCallback((s: string) => { window.scrollTo(0, 0); setScreen_(s); }, []);
  const [player, setPlayer]   = useState<any>(null);
  const [theaters, setTheaters] = useState<any[]>([]);
  const [activeIdx, setActiveIdx] = useState<number|null>(null);
  const [flashEvents, setFlashEvents] = useState<any[]>([]);
  const [respondedFlashIds, setRespondedFlashIds] = useState<string[]>([]);

  // Bootstrap: restore last session from Supabase
  useEffect(() => {
    (async () => {
      try {
        const meta = ldMeta();
        if (meta.email) {
          const p = await loadPlayerByEmail(meta.email);
          if (p) {
            setPlayer({ callsign: p.callsign, email: p.email, dbId: p.id, influence_score: (p as any).influence_score || DEFAULT_SCORE });
            const t = await loadTheaters(p.id);
            setTheaters(t);
            // Load flash events
            const fe = await loadActiveFlashEvents();
            setFlashEvents(fe);
            const responded = await loadPlayerFlashResponses(p.id);
            setRespondedFlashIds(responded);
            // Subscribe to push
            subscribeToPush(p.id);
            setScreen("hub");
            return;
          }
        }
      } catch {}
      setScreen("login");
    })();
  }, []);

  // Refresh flash events every 60s
  useEffect(() => {
    if (!player) return;
    const iv = setInterval(async () => {
      const fe = await loadActiveFlashEvents();
      setFlashEvents(fe);
    }, 60000);
    return () => clearInterval(iv);
  }, [player]);

  const handleLogin = useCallback(async (p: any) => {
    const dbPlayer = await upsertPlayer(p.email, p.callsign);
    if (!dbPlayer) { setScreen("login"); return; }
    const playerObj = { callsign: dbPlayer.callsign, email: dbPlayer.email, dbId: dbPlayer.id, influence_score: (dbPlayer as any).influence_score || DEFAULT_SCORE };
    const t = await loadTheaters(dbPlayer.id);
    setPlayer(playerObj);
    setTheaters(t);
    svMeta({ email: p.email });
    // Load flash events + subscribe to push
    const fe = await loadActiveFlashEvents();
    setFlashEvents(fe);
    const responded = await loadPlayerFlashResponses(dbPlayer.id);
    setRespondedFlashIds(responded);
    subscribeToPush(dbPlayer.id);
    setScreen("hub");
  }, []);

  const handleAddScenario = useCallback(async (scenario: any) => {
    if (!player) return;
    const dbT = await insertTheater(player.dbId, scenario);
    if (!dbT) return;
    const newT = { dbId: dbT.id, scenario, history: [], consequence: null };
    const updated = [...theaters, newT];
    setTheaters(updated);
    setActiveIdx(updated.length - 1);
    setScreen("theater");
    // Fire community notification (non-blocking)
    const region = scenario?.region;
    if (region) {
      supabase.functions.invoke("community-notify", {
        body: { player_id: player.dbId, region, scenario_title: scenario?.title },
      }).catch(() => {});
    }
  }, [player, theaters]);

  const handleOpenTheater = (i: number) => { setActiveIdx(i); setScreen("theater"); };

  const handleDropTheater = useCallback(async (i: number) => {
    const t = theaters[i];
    if (t?.dbId) await deleteTheater(t.dbId);
    setTheaters(prev => prev.filter((_, idx) => idx !== i));
  }, [theaters]);

  const handleDecisionMade = useCallback((index: number, action: any, consequence: any) => {
    setTheaters(prev => {
      const updated = prev.map((t, i) => {
        if (i !== index) return t;
        if (consequence !== null) {
          const newConsequence = consequence;
          if (t.dbId) updateTheater(t.dbId, { history: t.history, consequence: newConsequence });
          if (consequence.scoreDeltas && player) {
            const newScore = applyDeltas(player.influence_score || DEFAULT_SCORE, consequence.scoreDeltas);
            setPlayer(prev => ({ ...prev, influence_score: newScore }));
            if (player.dbId) updatePlayerScore(player.dbId, newScore);
          }
          return { ...t, consequence: newConsequence };
        } else {
          const today = fmtDate();
          const newHistory = [...t.history, { date: today, actionLabel: action.label, actionId: action.id, decided_at: new Date().toISOString() }];
          if (t.dbId) updateTheater(t.dbId, { history: newHistory, consequence: null, notified_ready: false });
          return { ...t, history: newHistory, consequence: null };
        }
      });
      return updated;
    });
  }, [player]);

  const handleFlashRespond = useCallback(async (eventId: string, option: any) => {
    if (!player) return;
    const ok = await respondToFlashEvent(eventId, player.dbId, option);
    if (ok) {
      setRespondedFlashIds(prev => [...prev, eventId]);
      // Apply score deltas
      if (option.scoreDeltas) {
        const newScore = applyDeltas(player.influence_score || DEFAULT_SCORE, option.scoreDeltas);
        setPlayer(prev => ({ ...prev, influence_score: newScore }));
        if (player.dbId) updatePlayerScore(player.dbId, newScore);
      }
    }
  }, [player]);

  const handleReset = useCallback(async () => {
    if (player?.dbId) await deletePlayerAndTheaters(player.dbId);
    setPlayer(null);
    setTheaters([]);
    setActiveIdx(null);
    setScreen("login");
    svMeta({});
  }, [player]);

  return (
    <div className="gc">
      <div className="gc-grid"/>
      <div className="gc-z">
        {screen!=="login"&&screen!=="init"&&(
          <Header player={player} theaters={theaters} onProfile={()=>setScreen("profile")}/>
        )}
        {/* Flash event banners — shown on hub */}
        {screen==="hub"&&player&&flashEvents.length>0&&(
          <div style={{ paddingTop: 12 }}>
            <FlashEventBanner
              events={flashEvents}
              respondedIds={respondedFlashIds}
              playerId={player.dbId}
              onRespond={handleFlashRespond}
            />
          </div>
        )}
        {screen==="init"&&(
          <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <TerminalLoader messages={["INITIALISATION DU SYSTÈME...","CONNEXION BASE DE DONNÉES..."]}/>
          </div>
        )}
        {screen==="login"&&<LoginScreen onLogin={handleLogin}/>}
        {screen==="hub"&&(
          <HubScreen player={player} theaters={theaters}
            onOpenTheater={handleOpenTheater}
            onAddTheater={()=>setScreen("scenario-select")}
            onDropTheater={handleDropTheater}/>
        )}
        {screen==="scenario-select"&&(
          <ScenarioSelect existingIds={theaters.map(t=>t.scenario.id)} onSelect={handleAddScenario} onBack={()=>setScreen("hub")}/>
        )}
        {screen==="theater"&&activeIdx!==null&&theaters[activeIdx]&&(
          <TheaterView theater={theaters[activeIdx]} theaterIndex={activeIdx} onDecisionMade={handleDecisionMade} onBack={()=>setScreen("hub")}/>
        )}
        {screen==="profile"&&(
          <ProfileScreen player={player} theaters={theaters} onBack={()=>setScreen("hub")} onReset={handleReset} onCommunity={()=>setScreen("community")} onSettings={()=>setScreen("settings")}/>
        )}
        {screen==="settings"&&(
          <SettingsScreen playerId={player?.dbId} onBack={()=>setScreen("profile")}/>
        )}
        {screen==="community"&&player&&(
          <CommunityScreen playerId={player.dbId} onBack={()=>setScreen("profile")}/>
        )}
      </div>
    </div>
  );
}
