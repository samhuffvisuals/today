// Tiny synthesized UI sounds (Web Audio, no files). Off by default.
// On iOS these follow the silent switch and mix with your music.

let ctx = null;
let enabled = false;

export function setSoundEnabled(v) {
  enabled = !!v;
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'ambient';
    } catch {}
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ f0, f1, dur, type = 'sine', gain = 0.16, delay = 0 }) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.03);
}

const SOUNDS = {
  pop: () => tone({ f0: 520, f1: 980, dur: 0.12, gain: 0.18 }),
  tick: () => tone({ f0: 1800, f1: 1200, dur: 0.035, type: 'triangle', gain: 0.08 }),
  add: () => tone({ f0: 700, f1: 1100, dur: 0.08, type: 'triangle', gain: 0.1 }),
  delete: () => tone({ f0: 260, f1: 90, dur: 0.16, gain: 0.2 }),
  chime: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ f0: f, dur: 0.5, gain: 0.12, delay: i * 0.08 }));
  },
};

export function play(name) {
  if (!enabled) return;
  try { SOUNDS[name]?.(); } catch {}
}
