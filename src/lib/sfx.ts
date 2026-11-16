/** Small synthesised sound cues (no audio files, works offline). */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.15) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export const sfx = {
  /** Mission start: a two-note bell. */
  start() {
    tone(784, 0, 0.6, 'triangle');
    tone(1175, 0.12, 0.8, 'triangle');
  },
  /** Mic opens. */
  listen() {
    tone(660, 0, 0.12, 'sine', 0.08);
  },
  /** Mission complete: a rising arpeggio. */
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.5, 'triangle'));
    tone(1568, 0.5, 0.9, 'sine', 0.1);
  },
  /** Mission ended without reaching the objective. */
  end() {
    tone(392, 0, 0.4, 'sine', 0.1);
    tone(330, 0.2, 0.6, 'sine', 0.1);
  },
};
