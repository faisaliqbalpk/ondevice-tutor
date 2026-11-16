/** Push-to-talk using the browser's Web Speech API. Prefers on-device recognition where Chrome supports it. */

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  processLocally?: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const speechSupported = () => !!ctor();

export function listen(onText: (t: string) => void, onDone: (err?: string) => void): () => void {
  const C = ctor();
  if (!C) {
    onDone('Speech recognition is not supported in this browser.');
    return () => {};
  }
  const r = new C();
  r.lang = 'en-US';
  r.interimResults = false;
  r.continuous = false;
  if ('processLocally' in r) r.processLocally = true;
  let text = '';
  r.onresult = (e) => {
    text = Array.from(e.results)
      .map((res) => res[0].transcript)
      .join(' ');
  };
  r.onerror = (e) => onDone(e.error);
  r.onend = () => {
    if (text) onText(text.trim());
    onDone();
  };
  r.start();
  return () => r.stop();
}

export interface SpeakOptions {
  /** Any string (e.g. a persona name): picks a stable voice, pitch and rate for that character. */
  voiceSeed?: string;
  onStart?: () => void;
  onEnd?: () => void;
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function speak(text: string, opts: SpeakOptions = {}) {
  if (!('speechSynthesis' in window)) {
    opts.onEnd?.();
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 1;
  if (opts.voiceSeed) {
    const h = hash(opts.voiceSeed);
    // Prefer voices that run locally, so persona speech also works offline.
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
    const local = voices.filter((v) => v.localService);
    const pool = local.length ? local : voices;
    if (pool.length) u.voice = pool[h % pool.length];
    u.pitch = 0.8 + ((h >> 3) % 5) * 0.1;
    u.rate = 0.95 + ((h >> 6) % 3) * 0.05;
  }
  u.onstart = () => opts.onStart?.();
  u.onend = () => opts.onEnd?.();
  u.onerror = () => opts.onEnd?.();
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
