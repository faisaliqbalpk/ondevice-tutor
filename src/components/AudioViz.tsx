import { useEffect, useRef } from 'react';

/**
 * Live microphone level bars, drawn from a local Web Audio analyser.
 * Audio never leaves the browser; it is only measured to draw the bars.
 */
export function MicLevel({ active }: { active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let stopped = false;

    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        ctx.createMediaStreamSource(s).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const color = getComputedStyle(document.documentElement).getPropertyValue('--bad').trim() || '#b42318';

        const draw = () => {
          const c = canvas.current;
          if (c) {
            const g = c.getContext('2d')!;
            const dpr = devicePixelRatio || 1;
            const w = (c.width = c.clientWidth * dpr);
            const h = (c.height = c.clientHeight * dpr);
            analyser.getByteFrequencyData(data);
            g.clearRect(0, 0, w, h);
            g.fillStyle = color;
            const bars = 16;
            const bw = w / bars;
            for (let i = 0; i < bars; i++) {
              const v = data[i + 1] / 255;
              const bh = Math.max(2 * dpr, v * h);
              g.fillRect(i * bw + bw * 0.2, (h - bh) / 2, bw * 0.6, bh);
            }
          }
          raf = requestAnimationFrame(draw);
        };
        draw();
      })
      .catch(() => {
        /* Permission denied: the speech recogniser reports the error. */
      });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [active]);

  return active ? <canvas ref={canvas} className="miclevel" aria-hidden="true" /> : null;
}

export type StageState = 'idle' | 'listening' | 'thinking' | 'speaking';

/** The persona's avatar, animated by what is happening in the conversation. */
export function PersonaStage({ emoji, state, name }: { emoji: string; state: StageState; name: string }) {
  const label = { idle: 'Your turn', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' }[state];
  return (
    <div className={`stage ${state}`}>
      <div className="orb" aria-hidden="true">
        <span className="ring" />
        <span className="ring r2" />
        <span className="avatar">{emoji}</span>
      </div>
      <div className="stage-text">
        <strong>{name}</strong>
        <span className="muted">{label}</span>
      </div>
    </div>
  );
}
