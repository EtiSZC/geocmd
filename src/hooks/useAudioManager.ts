import { useEffect, useRef, useCallback } from "react";

// ─── Audio preference persistence ────────────────────────────
const AUDIO_KEY = "geocmd_audio";
export function getAudioPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(AUDIO_KEY) || "{}");
    return { muted: v.muted === true, volume: typeof v.volume === "number" ? v.volume : 0.5 };
  } catch { return { muted: false, volume: 0.5 }; }
}
export function saveAudioPrefs(p: { muted: boolean; volume: number }) {
  localStorage.setItem(AUDIO_KEY, JSON.stringify(p));
}

// ─── Types ───────────────────────────────────────────────────
type ScreenType = "init" | "login" | "hub" | "scenario-select" | "theater" | "profile" | "settings" | "community";

interface AmbienceConfig {
  baseFreq: number;
  modFreq: number;
  modDepth: number;
  filterFreq: number;
  gain: number;
  noiseGain: number;
}

const AMBIENCE: Record<string, AmbienceConfig> = {
  hub:              { baseFreq: 55,  modFreq: 0.08, modDepth: 4, filterFreq: 400,  gain: 0.12, noiseGain: 0.03 },
  "scenario-select":{ baseFreq: 65,  modFreq: 0.15, modDepth: 6, filterFreq: 600,  gain: 0.14, noiseGain: 0.04 },
  theater:          { baseFreq: 48,  modFreq: 0.25, modDepth: 8, filterFreq: 800,  gain: 0.16, noiseGain: 0.05 },
  profile:          { baseFreq: 60,  modFreq: 0.05, modDepth: 3, filterFreq: 350,  gain: 0.10, noiseGain: 0.02 },
  settings:         { baseFreq: 60,  modFreq: 0.05, modDepth: 3, filterFreq: 350,  gain: 0.10, noiseGain: 0.02 },
  community:        { baseFreq: 58,  modFreq: 0.06, modDepth: 3, filterFreq: 380,  gain: 0.10, noiseGain: 0.02 },
};

// ─── SFX synthesizer functions ───────────────────────────────
function playClick(ctx: AudioContext, vol: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(1200, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.06);
  g.gain.setValueAtTime(vol * 0.3, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
  o.connect(g).connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + 0.1);
}

function playTransition(ctx: AudioContext, vol: number) {
  // Swoosh / sweep
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = 2000;
  o.type = "sawtooth";
  o.frequency.setValueAtTime(150, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.3);
  g.gain.setValueAtTime(vol * 0.15, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
  o.connect(f).connect(g).connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + 0.4);
}

function playSuccess(ctx: AudioContext, vol: number) {
  [800, 1000, 1200].forEach((freq, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    const t = ctx.currentTime + i * 0.1;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 0.2, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.25);
  });
}

function playAlert(ctx: AudioContext, vol: number) {
  // Urgent double beep
  [0, 0.15].forEach(delay => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = 880;
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(vol * 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.12);
  });
}

function playError(ctx: AudioContext, vol: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(300, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.3);
  g.gain.setValueAtTime(vol * 0.2, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
  o.connect(g).connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + 0.4);
}

function playRadioStatic(ctx: AudioContext, vol: number) {
  // Short static burst
  const bufferSize = ctx.sampleRate * 0.15;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = "bandpass"; f.frequency.value = 3000; f.Q.value = 2;
  src.buffer = buffer;
  g.gain.setValueAtTime(vol * 0.15, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(); src.stop(ctx.currentTime + 0.15);
}

// ─── Hook ────────────────────────────────────────────────────
export type SFXType = "click" | "transition" | "success" | "alert" | "error" | "radio";

export function useAudioManager(screen: ScreenType) {
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<{ osc?: OscillatorNode; lfo?: OscillatorNode; gain?: GainNode; noiseGain?: GainNode; noiseSrc?: AudioBufferSourceNode; filter?: BiquadFilterNode }>({}); 
  const prefsRef = useRef(getAudioPrefs());
  const currentScreenRef = useRef<string>("");
  const initRef = useRef(false);

  // Lazy-init AudioContext on first user gesture
  const ensureCtx = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    try {
      const c = new AudioContext();
      ctxRef.current = c;
      return c;
    } catch { return null; }
  }, []);

  // Start/switch ambient drone for a screen
  const startAmbience = useCallback((scr: string) => {
    const prefs = prefsRef.current;
    if (prefs.muted) { stopAmbience(); return; }
    const cfg = AMBIENCE[scr] || AMBIENCE.hub;
    const ctx = ensureCtx();
    if (!ctx) return;

    // Fade out existing
    stopAmbience(0.8);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(cfg.gain * prefs.volume, ctx.currentTime + 1.2);
    masterGain.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cfg.filterFreq;
    filter.connect(masterGain);

    // Base oscillator
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = cfg.baseFreq;
    osc.connect(filter);

    // LFO modulation
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = "sine";
    lfo.frequency.value = cfg.modFreq;
    lfoGain.gain.value = cfg.modDepth;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    // Filtered noise layer
    const noiseLen = ctx.sampleRate * 4;
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) noiseData[i] = Math.random() * 2 - 1;
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 500;
    const noiseGainNode = ctx.createGain();
    noiseGainNode.gain.value = cfg.noiseGain * prefs.volume;
    noiseSrc.connect(noiseFilter).connect(noiseGainNode).connect(masterGain);

    osc.start();
    lfo.start();
    noiseSrc.start();

    nodesRef.current = { osc, lfo, gain: masterGain, noiseSrc, noiseGain: noiseGainNode, filter };
  }, []);

  const stopAmbience = useCallback((fadeTime = 0.3) => {
    const n = nodesRef.current;
    const ctx = ctxRef.current;
    if (!ctx || !n.gain) return;
    try {
      n.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeTime);
      const cleanup = { ...n };
      setTimeout(() => {
        try { cleanup.osc?.stop(); } catch {}
        try { cleanup.lfo?.stop(); } catch {}
        try { cleanup.noiseSrc?.stop(); } catch {}
        try { cleanup.gain?.disconnect(); } catch {}
      }, fadeTime * 1000 + 100);
    } catch {}
    nodesRef.current = {};
  }, []);

  // Play SFX
  const playSFX = useCallback((type: SFXType) => {
    const prefs = prefsRef.current;
    if (prefs.muted) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const v = prefs.volume;
    switch (type) {
      case "click": playClick(ctx, v); break;
      case "transition": playTransition(ctx, v); break;
      case "success": playSuccess(ctx, v); break;
      case "alert": playAlert(ctx, v); break;
      case "error": playError(ctx, v); break;
      case "radio": playRadioStatic(ctx, v); break;
    }
  }, []);

  // Update prefs
  const updatePrefs = useCallback((muted: boolean, volume: number) => {
    prefsRef.current = { muted, volume };
    saveAudioPrefs({ muted, volume });
    if (muted) {
      stopAmbience();
    } else {
      // Restart ambience with new volume
      startAmbience(currentScreenRef.current);
    }
  }, [startAmbience, stopAmbience]);

  // Initialize on first user interaction
  useEffect(() => {
    const initOnGesture = () => {
      if (initRef.current) return;
      initRef.current = true;
      const ctx = ensureCtx();
      if (ctx?.state === "suspended") ctx.resume();
      if (currentScreenRef.current) startAmbience(currentScreenRef.current);
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
    if (!initRef.current) return; // Wait for user gesture
    if (screen === "init" || screen === "login") {
      stopAmbience();
      return;
    }
    playSFX("transition");
    startAmbience(screen);
  }, [screen, startAmbience, stopAmbience, playSFX]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAmbience(0);
      try { ctxRef.current?.close(); } catch {}
    };
  }, []);

  return { playSFX, updatePrefs, getPrefs: () => prefsRef.current };
}
