import { useRef, useState } from 'react';
import { tutorReply, type Turn } from '../lib/tutor';
import { tutorContext, type Student } from '../lib/mastery';
import { listen, speak, speechSupported } from '../lib/speech';
import type { Source } from '../lib/ai';
import { ErrorNote, SourceBadge } from './common';
import { errorText } from '../lib/errors';

type Msg = Turn & { source?: Source };

export function TutorChat({ student }: { student: Student }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => {});

  async function send(text: string) {
    if (!text.trim()) return;
    setDraft('');
    setError(null);
    const history = msgs;
    setMsgs((m) => [...m, { role: 'student', text }]);
    setBusy(true);
    try {
      const r = await tutorReply(history, text, tutorContext(student));
      setMsgs((m) => [...m, { role: 'tutor', text: r.data.trim(), source: r.source }]);
      if (voice) speak(r.data);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function talk() {
    if (listening) {
      stopRef.current();
      return;
    }
    setListening(true);
    stopRef.current = listen(
      (t) => void send(t),
      (err) => {
        setListening(false);
        if (err && err !== 'no-speech' && err !== 'aborted') setError(`Microphone: ${err}`);
      },
    );
  }

  return (
    <section className="panel chat">
      <div className="row spread">
        <h2>Talk to your tutor</h2>
        <label className="toggle">
          <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Speak replies
        </label>
      </div>
      <p className="muted">
        The tutor knows {student.nickname}'s skill profile and runs on-device when Gemini Nano is available.
      </p>
      <div className="messages">
        {msgs.length === 0 && <p className="muted">Try: "I don't get why 2/4 is the same as 1/2."</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            <p>{m.text}</p>
            {m.source && <SourceBadge source={m.source} />}
          </div>
        ))}
        {busy && <div className="bubble tutor muted">…</div>}
      </div>
      <ErrorNote error={error} />
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        {speechSupported() && (
          <button type="button" className={listening ? 'mic on' : 'mic'} onClick={talk} disabled={busy}>
            {listening ? 'Listening… tap to stop' : 'Tap to talk'}
          </button>
        )}
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Or type a question" />
        <button type="submit" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
