import { useEffect, useRef, useCallback } from "react";

// ─── Audio preference persistence ────────────────────────────
const AUDIO_KEY = "geocmd_audio";
export interface AudioPrefs { muted: boolean; volume: number; disabledSfx: string[]; ambienceEnabled: boolean; }
export function getAudioPrefs(): AudioPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(AUDIO_KEY) || "{}");
    return { muted: v.muted === true, volume: typeof v.volume === "number" ? v.volume : 0.5, disabledSfx: Array.isArray(v.disabledSfx) ? v.disabledSfx : [], ambienceEnabled: v.ambienceEnabled !== false };
  } catch { return { muted: false, volume: 0.5, disabledSfx: [], ambienceEnabled: true }; }
}
export function saveAudioPrefs(p: AudioPrefs) {
  localStorage.setItem(AUDIO_KEY, JSON.stringify(p));
}

// ─── Types ───────────────────────────────────────────────────
type ScreenType = "init" | "login" | "hub" | "scenario-select" | "theater" | "profile" | "settings" | "community";

// ─── Utility: create filtered noise buffer ───────────────────
function createNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ─── Ambience builders ──────────────────────────────────────
// Each returns an array of nodes to stop on cleanup
type AmbienceBuilder = (ctx: AudioContext, master: GainNode) => (() => void);

function buildHubAmbience(ctx: AudioContext, master: GainNode): () => void {
  const t = ctx.currentTime;
  const stops: (() => void)[] = [];

  // Layer 1: Deep server room hum (50Hz + 100Hz harmonics)
  [50, 100, 150].forEach((freq, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.value = [0.08, 0.04, 0.02][i];
    // Slow wobble
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 0.03 + i * 0.02;
    lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(o.frequency);
    o.connect(g).connect(master);
    o.start(); lfo.start();
    stops.push(() => { try { o.stop(); lfo.stop(); } catch {} });
  });

  // Layer 2: Air conditioning / ventilation noise
  const noise = ctx.createBufferSource();
  noise.buffer = createNoise(ctx, 4);
  noise.loop = true;
  const nf = ctx.createBiquadFilter();
  nf.type = "lowpass"; nf.frequency.value = 300; nf.Q.value = 0.5;
  const ng = ctx.createGain();
  ng.gain.value = 0.035;
  noise.connect(nf).connect(ng).connect(master);
  noise.start();
  stops.push(() => { try { noise.stop(); } catch {} });

  // Layer 3: Occasional keyboard / digital blips (scheduled)
  const blipInterval = setInterval(() => {
    if (Math.random() > 0.4) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    const now = ctx.currentTime;
    o.frequency.setValueAtTime(800 + Math.random() * 2000, now);
    g.gain.setValueAtTime(0.015, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    o.connect(g).connect(master);
    o.start(now); o.stop(now + 0.05);
  }, 2000);
  stops.push(() => clearInterval(blipInterval));

  return () => stops.forEach(fn => fn());
}

function buildTheaterAmbience(ctx: AudioContext, master: GainNode): () => void {
  const stops: (() => void)[] = [];

  // Layer 1: Tense low drone (layered detuned sines)
  [42, 42.5, 84, 84.7].forEach((freq, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = i < 2 ? "sine" : "triangle";
    o.frequency.value = freq;
    g.gain.value = i < 2 ? 0.07 : 0.03;
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 0.1 + i * 0.05;
    lfoG.gain.value = 1.5;
    lfo.connect(lfoG).connect(o.frequency);
    o.connect(g).connect(master);
    o.start(); lfo.start();
    stops.push(() => { try { o.stop(); lfo.stop(); } catch {} });
  });

  // Layer 2: Radar sweep — periodic ping
  const radarInterval = setInterval(() => {
    const now = ctx.currentTime;
    // Ping tone
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 15;
    o.type = "sine";
    o.frequency.value = 1400;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.06, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    o.connect(f).connect(g).connect(master);
    o.start(now); o.stop(now + 0.9);
    // Subtle sweep noise after ping
    const ns = ctx.createBufferSource();
    ns.buffer = createNoise(ctx, 1);
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass"; nf.frequency.value = 2000; nf.Q.value = 5;
    nf.frequency.linearRampToValueAtTime(800, now + 0.6);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.02, now + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    ns.connect(nf).connect(ng).connect(master);
    ns.start(now + 0.05); ns.stop(now + 0.8);
  }, 4000);
  stops.push(() => clearInterval(radarInterval));

  // Layer 3: Radio chatter noise (filtered, rhythmic)
  const chatterInterval = setInterval(() => {
    if (Math.random() > 0.35) return;
    const now = ctx.currentTime;
    const dur = 0.3 + Math.random() * 0.5;
    const ns = ctx.createBufferSource();
    ns.buffer = createNoise(ctx, 2);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 1500 + Math.random() * 1000; bp.Q.value = 8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(0.018, now + 0.02);
    ng.gain.setValueAtTime(0.018, now + dur - 0.05);
    ng.gain.exponentialRampToValueAtTime(0.001, now + dur);
    ns.connect(bp).connect(ng).connect(master);
    ns.start(now); ns.stop(now + dur);
  }, 3500);
  stops.push(() => clearInterval(chatterInterval));

  // Layer 4: Heartbeat-like sub pulse
  const pulseInterval = setInterval(() => {
    const now = ctx.currentTime;
    [0, 0.18].forEach(delay => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 35;
      const t = now + delay;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + 0.3);
    });
  }, 2800);
  stops.push(() => clearInterval(pulseInterval));

  return () => stops.forEach(fn => fn());
}

function buildScenarioSelectAmbience(ctx: AudioContext, master: GainNode): () => void {
  const stops: (() => void)[] = [];

  // Scanning / data stream ambience
  // Layer 1: Mid-tone hum
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "triangle";
  o.frequency.value = 65;
  g.gain.value = 0.06;
  const lfo = ctx.createOscillator();
  const lfoG = ctx.createGain();
  lfo.type = "sine"; lfo.frequency.value = 0.12; lfoG.gain.value = 3;
  lfo.connect(lfoG).connect(o.frequency);
  o.connect(g).connect(master);
  o.start(); lfo.start();
  stops.push(() => { try { o.stop(); lfo.stop(); } catch {} });

  // Layer 2: Digital scanning blips (fast, varied pitch)
  const scanInterval = setInterval(() => {
    const now = ctx.currentTime;
    const numBlips = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numBlips; i++) {
      const bo = ctx.createOscillator();
      const bg = ctx.createGain();
      bo.type = "sine";
      const t = now + i * 0.06;
      bo.frequency.setValueAtTime(600 + Math.random() * 3000, t);
      bg.gain.setValueAtTime(0.012, t);
      bg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      bo.connect(bg).connect(master);
      bo.start(t); bo.stop(t + 0.04);
    }
  }, 1800);
  stops.push(() => clearInterval(scanInterval));

  // Layer 3: Data stream noise
  const noise = ctx.createBufferSource();
  noise.buffer = createNoise(ctx, 4);
  noise.loop = true;
  const nf = ctx.createBiquadFilter();
  nf.type = "highpass"; nf.frequency.value = 4000;
  const ng = ctx.createGain();
  ng.gain.value = 0.008;
  const nlfo = ctx.createOscillator();
  const nlfoG = ctx.createGain();
  nlfo.type = "sine"; nlfo.frequency.value = 0.3; nlfoG.gain.value = 0.006;
  nlfo.connect(nlfoG).connect(ng.gain);
  noise.connect(nf).connect(ng).connect(master);
  noise.start(); nlfo.start();
  stops.push(() => { try { noise.stop(); nlfo.stop(); } catch {} });

  return () => stops.forEach(fn => fn());
}

function buildQuietAmbience(ctx: AudioContext, master: GainNode): () => void {
  const stops: (() => void)[] = [];
  // Gentle server room hum
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine"; o.frequency.value = 55; g.gain.value = 0.04;
  o.connect(g).connect(master);
  o.start();
  stops.push(() => { try { o.stop(); } catch {} });
  // Very soft ventilation
  const n = ctx.createBufferSource();
  n.buffer = createNoise(ctx, 4); n.loop = true;
  const nf = ctx.createBiquadFilter();
  nf.type = "lowpass"; nf.frequency.value = 250;
  const ng = ctx.createGain(); ng.gain.value = 0.015;
  n.connect(nf).connect(ng).connect(master);
  n.start();
  stops.push(() => { try { n.stop(); } catch {} });
  return () => stops.forEach(fn => fn());
}

const AMBIENCE_BUILDERS: Record<string, AmbienceBuilder> = {
  hub: buildHubAmbience,
  "scenario-select": buildScenarioSelectAmbience,
  theater: buildTheaterAmbience,
  profile: buildQuietAmbience,
  settings: buildQuietAmbience,
  community: buildQuietAmbience,
};

// ─── SFX synthesizer functions ───────────────────────────────

// Military-style button click: short metallic tap
function playClick(ctx: AudioContext, vol: number) {
  const now = ctx.currentTime;
  // Metallic transient
  const o1 = ctx.createOscillator();
  const g1 = ctx.createGain();
  o1.type = "square";
  o1.frequency.setValueAtTime(2500, now);
  o1.frequency.exponentialRampToValueAtTime(800, now + 0.015);
  g1.gain.setValueAtTime(vol * 0.15, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  o1.connect(g1).connect(ctx.destination);
  o1.start(now); o1.stop(now + 0.05);
  // Sub thunk
  const o2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  o2.type = "sine";
  o2.frequency.value = 120;
  g2.gain.setValueAtTime(vol * 0.12, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  o2.connect(g2).connect(ctx.destination);
  o2.start(now); o2.stop(now + 0.07);
}


// Success: ascending military confirmation tones
function playSuccess(ctx: AudioContext, vol: number) {
  const now = ctx.currentTime;
  const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    const t = now + i * 0.08;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 0.12, t + 0.01);
    g.gain.setValueAtTime(vol * 0.12, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.18);
  });
  // Static crackle on top
  const ns = ctx.createBufferSource();
  ns.buffer = createNoise(ctx, 0.5);
  const nf = ctx.createBiquadFilter();
  nf.type = "highpass"; nf.frequency.value = 6000;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vol * 0.04, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  ns.connect(nf).connect(ng).connect(ctx.destination);
  ns.start(now); ns.stop(now + 0.45);
}

// Alert: urgent klaxon-style alarm
function playAlert(ctx: AudioContext, vol: number) {
  const now = ctx.currentTime;
  // Three rapid warning tones
  [0, 0.12, 0.24].forEach((delay, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = i % 2 === 0 ? 880 : 740;
    const t = now + delay;
    g.gain.setValueAtTime(vol * 0.12, t);
    g.gain.setValueAtTime(vol * 0.12, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 2000;
    o.connect(f).connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.11);
  });
  // Rumble underneath
  const o2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  o2.type = "sawtooth";
  o2.frequency.value = 60;
  g2.gain.setValueAtTime(vol * 0.08, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 200;
  o2.connect(lp).connect(g2).connect(ctx.destination);
  o2.start(now); o2.stop(now + 0.45);
}

// Error: descending warning buzz
function playError(ctx: AudioContext, vol: number) {
  const now = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(400, now);
  o.frequency.exponentialRampToValueAtTime(120, now + 0.4);
  g.gain.setValueAtTime(vol * 0.14, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  const f = ctx.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = 1200;
  o.connect(f).connect(g).connect(ctx.destination);
  o.start(now); o.stop(now + 0.55);
  // Static burst
  const ns = ctx.createBufferSource();
  ns.buffer = createNoise(ctx, 0.3);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vol * 0.06, now + 0.1);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  const nf = ctx.createBiquadFilter();
  nf.type = "bandpass"; nf.frequency.value = 2000; nf.Q.value = 3;
  ns.connect(nf).connect(ng).connect(ctx.destination);
  ns.start(now + 0.1); ns.stop(now + 0.4);
}

// Radio static: realistic radio squelch open/close
function playRadioStatic(ctx: AudioContext, vol: number) {
  const now = ctx.currentTime;
  // Squelch open burst
  const ns1 = ctx.createBufferSource();
  ns1.buffer = createNoise(ctx, 0.6);
  const bp1 = ctx.createBiquadFilter();
  bp1.type = "bandpass"; bp1.frequency.value = 2500; bp1.Q.value = 3;
  const g1 = ctx.createGain();
  g1.gain.setValueAtTime(vol * 0.15, now);
  g1.gain.exponentialRampToValueAtTime(vol * 0.04, now + 0.05);
  g1.gain.setValueAtTime(vol * 0.04, now + 0.35);
  g1.gain.exponentialRampToValueAtTime(vol * 0.12, now + 0.4);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  ns1.connect(bp1).connect(g1).connect(ctx.destination);
  ns1.start(now); ns1.stop(now + 0.55);
  // Tone burst in the middle (simulated voice carrier)
  const o = ctx.createOscillator();
  const g2 = ctx.createGain();
  o.type = "sine";
  o.frequency.value = 1200;
  g2.gain.setValueAtTime(0, now + 0.06);
  g2.gain.linearRampToValueAtTime(vol * 0.04, now + 0.1);
  g2.gain.setValueAtTime(vol * 0.04, now + 0.3);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  o.connect(g2).connect(ctx.destination);
  o.start(now + 0.06); o.stop(now + 0.4);
}

// Data loading: modem/computer processing sound
function playDataLoad(ctx: AudioContext, vol: number) {
  const now = ctx.currentTime;
  // Rapid digital chirps
  for (let i = 0; i < 8; i++) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    const t = now + i * 0.05;
    o.frequency.setValueAtTime(1000 + Math.random() * 4000, t);
    o.frequency.setValueAtTime(500 + Math.random() * 2000, t + 0.02);
    g.gain.setValueAtTime(vol * 0.04, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 4000;
    o.connect(f).connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.045);
  }
  // Underlying hum
  const oh = ctx.createOscillator();
  const gh = ctx.createGain();
  oh.type = "sawtooth";
  oh.frequency.value = 200;
  gh.gain.setValueAtTime(vol * 0.03, now);
  gh.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 600;
  oh.connect(lp).connect(gh).connect(ctx.destination);
  oh.start(now); oh.stop(now + 0.55);
}


// ─── Hook ────────────────────────────────────────────────────
export type SFXType = "click" | "success" | "alert" | "error" | "radio" | "dataload";

export function useAudioManager(screen: ScreenType) {
  const ctxRef = useRef<AudioContext | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const prefsRef = useRef(getAudioPrefs());
  const currentScreenRef = useRef<string>("");
  const initRef = useRef(false);

  const ensureCtx = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    try {
      const c = new AudioContext();
      ctxRef.current = c;
      return c;
    } catch { return null; }
  }, []);

  const stopAmbience = useCallback((fadeTime = 0.5) => {
    const master = masterRef.current;
    const ctx = ctxRef.current;
    if (master && ctx) {
      try {
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeTime);
      } catch {}
    }
    const cleanup = cleanupRef.current;
    if (cleanup) {
      setTimeout(() => { try { cleanup(); } catch {} }, fadeTime * 1000 + 200);
      cleanupRef.current = null;
    }
    if (master) {
      setTimeout(() => { try { master.disconnect(); } catch {} }, fadeTime * 1000 + 300);
      masterRef.current = null;
    }
  }, []);

  const startAmbience = useCallback((scr: string) => {
    const prefs = prefsRef.current;
    if (prefs.muted || !prefs.ambienceEnabled) { stopAmbience(); return; }
    const builder = AMBIENCE_BUILDERS[scr];
    if (!builder) { stopAmbience(); return; }
    const ctx = ensureCtx();
    if (!ctx) return;

    stopAmbience(0.8);

    // Wait for old to fade
    setTimeout(() => {
      const master = ctx.createGain();
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.gain.linearRampToValueAtTime(prefs.volume, ctx.currentTime + 1.5);
      master.connect(ctx.destination);
      masterRef.current = master;

      const cleanup = builder(ctx, master);
      cleanupRef.current = cleanup;
    }, 900);
  }, [stopAmbience, ensureCtx]);

  const playSFX = useCallback((type: SFXType) => {
    const prefs = prefsRef.current;
    if (prefs.muted) return;
    if (prefs.disabledSfx.includes(type)) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const v = prefs.volume;
    switch (type) {
      case "click": playClick(ctx, v); break;
      case "success": playSuccess(ctx, v); break;
      case "alert": playAlert(ctx, v); break;
      case "error": playError(ctx, v); break;
      case "radio": playRadioStatic(ctx, v); break;
      case "dataload": playDataLoad(ctx, v); break;
    }
  }, [ensureCtx]);

  const updatePrefs = useCallback((newPrefs: AudioPrefs) => {
    prefsRef.current = newPrefs;
    saveAudioPrefs(newPrefs);
    // Apply volume change to live ambience
    const master = masterRef.current;
    const ctx = ctxRef.current;
    if (master && ctx) {
      try { master.gain.linearRampToValueAtTime(newPrefs.muted ? 0 : newPrefs.volume, ctx.currentTime + 0.1); } catch {}
    }
    if (newPrefs.muted || !newPrefs.ambienceEnabled) {
      stopAmbience();
    } else if (!masterRef.current || masterRef.current.gain.value === 0) {
      startAmbience(currentScreenRef.current);
    }
  }, [startAmbience, stopAmbience]);

  // Init on first gesture
  useEffect(() => {
    const initOnGesture = () => {
      if (initRef.current) return;
      initRef.current = true;
      const ctx = ensureCtx();
      if (ctx?.state === "suspended") ctx.resume();
      if (currentScreenRef.current && currentScreenRef.current !== "init" && currentScreenRef.current !== "login") {
        startAmbience(currentScreenRef.current);
      }
      document.removeEventListener("click", initOnGesture);
      document.removeEventListener("touchstart", initOnGesture);
    };
    document.addEventListener("click", initOnGesture);
    document.addEventListener("touchstart", initOnGesture);
    return () => {
      document.removeEventListener("click", initOnGesture);
      document.removeEventListener("touchstart", initOnGesture);
    };
  }, []);

  // React to screen changes
  useEffect(() => {
    if (screen === currentScreenRef.current) return;
    currentScreenRef.current = screen;
    if (!initRef.current) return;
    if (screen === "init" || screen === "login") {
      stopAmbience();
      return;
    }
    playSFX("click");
    startAmbience(screen);
  }, [screen, startAmbience, stopAmbience, playSFX]);

  // Cleanup
  useEffect(() => {
    return () => {
      stopAmbience(0);
      try { ctxRef.current?.close(); } catch {}
    };
  }, []);

  return { playSFX, updatePrefs, getPrefs: () => prefsRef.current };
}
