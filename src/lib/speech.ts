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

export function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 1;
  speechSynthesis.speak(u);
}
