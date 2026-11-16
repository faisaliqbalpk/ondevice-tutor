import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Part } from 'firebase/ai';
import {
  explainParagraph,
  explainSelection,
  makeCards,
  readPagePhoto,
  summarizePage,
  type ParagraphHelp,
} from '../lib/studyAi';
import { type Student } from '../lib/mastery';
import { addCards, deleteReading, saveReading, updateReading, watchReadings, type Reading as ReadingDoc } from '../lib/study';
import { noteActivitySoon } from '../lib/memory';
import { photoToPart } from '../lib/image';
import { speak, stopSpeaking } from '../lib/speech';
import { ErrorNote } from './common';
import { errorText } from '../lib/errors';

interface Props {
  uid: string;
  student: Student;
  onToast: (t: string) => void;
}

const paragraphsOf = (text: string) =>
  text
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);

/** Wraps every highlighted snippet inside a paragraph in <mark>. */
function withMarks(text: string, highlights: string[]): ReactNode[] {
  const hits = highlights
    .filter((h) => h && text.includes(h))
    .flatMap((h) => {
      const out: [number, number][] = [];
      let i = text.indexOf(h);
      while (i >= 0) {
        out.push([i, i + h.length]);
        i = text.indexOf(h, i + h.length);
      }
      return out;
    })
    .sort((a, b) => a[0] - b[0]);
  const nodes: ReactNode[] = [];
  let at = 0;
  for (const [s, e] of hits) {
    if (s < at) continue;
    if (s > at) nodes.push(text.slice(at, s));
    nodes.push(<mark key={s}>{text.slice(s, e)}</mark>);
    at = e;
  }
  nodes.push(text.slice(at));
  return nodes;
}

export function Reading({ uid, student, onToast }: Props) {
  const [list, setList] = useState<ReadingDoc[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ part: Part; previewUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => watchReadings(uid, student.id, setList), [uid, student.id]);

  const open = list.find((r) => r.id === openId) ?? null;

  async function onFile(f: File | undefined) {
    if (!f) return;
    setNeedsConsent(false);
    setImage(await photoToPart(f, 1280));
  }

  async function transcribe(allowCloud: boolean) {
    if (!image) return;
    setBusy(true);
    setError(null);
    setNeedsConsent(false);
    try {
      const r = await readPagePhoto(image.part, allowCloud);
      setTitle((t) => t || r.data.title);
      setText(r.data.text);
      setImage(null);
    } catch (e) {
      if (!allowCloud) setNeedsConsent(true);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function create() {
    const id = saveReading(uid, {
      studentId: student.id,
      title: title.trim() || 'Untitled page',
      text: text.trim(),
      highlights: [],
      notes: '',
      explanations: {},
    });
    noteActivitySoon(uid, student, `Started reading "${title.trim() || 'a page'}"`);
    setOpenId(id);
    setAdding(false);
    setTitle('');
    setText('');
  }

  if (open) return <Reader key={open.id} uid={uid} student={student} doc={open} onBack={() => setOpenId(null)} onToast={onToast} />;

  return (
    <section className="panel">
      <div className="row spread wrap">
        <h2>Immersive reading</h2>
        {!adding && <button onClick={() => setAdding(true)}>Add a page</button>}
      </div>
      <p className="muted">
        Paste or snap a textbook page. Tap a paragraph for a simpler explanation, highlight words to look them up, keep
        notes, and listen to it read aloud. Explanations run on this device.
      </p>
      {adding && (
        <div className="objective">
          <div className="grid2">
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Photosynthesis, p. 42" />
            </label>
            <label className="field">
              <span>Snap a page (Nano reads it on this device)</span>
              <input type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
          {image && (
            <>
              <img className="preview" src={image.previewUrl} alt="Page preview" />
              <div className="row">
                <button onClick={() => transcribe(false)} disabled={busy}>
                  {busy ? 'Reading the page…' : 'Read this page on the device'}
                </button>
              </div>
            </>
          )}
          {needsConsent && (
            <div className="consent">
              <p>
                Gemini Nano can't read photos on this device right now. You can send the page to the cloud to be
                transcribed (it is logged in the privacy ledger), or paste the text instead.
              </p>
              <button onClick={() => transcribe(true)} disabled={busy}>
                Send this page to the cloud
              </button>
            </div>
          )}
          <label className="field">
            <span>Text</span>
            <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the text here. Leave a blank line between paragraphs." />
          </label>
          <div className="row">
            <button onClick={create} disabled={!text.trim()}>
              Start reading
            </button>
            <button className="secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
          <ErrorNote error={error} />
        </div>
      )}
      {list.length === 0 && !adding ? (
        <p className="muted">No pages yet.</p>
      ) : (
        <ul className="reading-list">
          {list.map((r) => (
            <li key={r.id}>
              <button className="mission-card" onClick={() => setOpenId(r.id)}>
                <span className="mission-emoji">📖</span>
                <span className="mission-body">
                  <strong>{r.title}</strong>
                  <span className="small muted">
                    {paragraphsOf(r.text).length} paragraphs · {r.highlights.length} highlights
                    {r.notes ? ' · notes' : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Reader({ uid, student, doc, onBack, onToast }: { uid: string; student: Student; doc: ReadingDoc; onBack: () => void; onToast: (t: string) => void }) {
  const paras = paragraphsOf(doc.text);
  const [help, setHelp] = useState<Record<number, ParagraphHelp | 'loading' | string>>({});
  const [selection, setSelection] = useState<{ text: string; para: number } | null>(null);
  const [selHelp, setSelHelp] = useState<string | null>(null);
  const [reading, setReading] = useState<number | null>(null);
  const [notes, setNotes] = useState(doc.notes);
  const [summary, setSummary] = useState<{ summary: string; keyPoints: string[] } | 'loading' | null>(
    doc.summary ? JSON.parse(doc.summary) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const playing = useRef(false);

  useEffect(() => () => {
    playing.current = false;
    stopSpeaking();
  }, []);

  function play(from: number) {
    playing.current = true;
    const step = (i: number) => {
      if (!playing.current || i >= paras.length) {
        playing.current = false;
        setReading(null);
        return;
      }
      setReading(i);
      speak(paras[i], { onEnd: () => step(i + 1) });
    };
    step(from);
  }

  function stop() {
    playing.current = false;
    stopSpeaking();
    setReading(null);
  }

  async function explain(i: number) {
    setHelp((h) => ({ ...h, [i]: 'loading' }));
    try {
      const r = await explainParagraph(paras[i], doc.title, student.grade);
      setHelp((h) => ({ ...h, [i]: r.data }));
      updateReading(uid, doc.id, { explanations: { ...doc.explanations, [i]: r.data.simple } });
    } catch (e) {
      setHelp((h) => ({ ...h, [i]: errorText(e) }));
    }
  }

  function onSelect(para: number) {
    const s = window.getSelection()?.toString().trim() ?? '';
    if (s.length >= 2 && s.length <= 300) {
      setSelection({ text: s, para });
      setSelHelp(null);
    }
  }

  function highlight() {
    if (!selection) return;
    updateReading(uid, doc.id, { highlights: [...new Set([...doc.highlights, selection.text])] });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  async function explainSel() {
    if (!selection) return;
    setSelHelp('…');
    try {
      const r = await explainSelection(selection.text, paras[selection.para], student.grade);
      setSelHelp(r.data);
    } catch (e) {
      setSelHelp(errorText(e));
    }
  }

  async function summarize() {
    setSummary('loading');
    try {
      const r = await summarizePage(doc.text, student.grade);
      setSummary(r.data);
      updateReading(uid, doc.id, { summary: JSON.stringify(r.data) });
    } catch (e) {
      setSummary(null);
      setError(errorText(e));
    }
  }

  async function cards() {
    try {
      const material =
        `${doc.title}\n${doc.text.slice(0, 2000)}` +
        (doc.highlights.length ? `\nHighlighted: ${doc.highlights.join('; ')}` : '') +
        (notes ? `\nStudent notes: ${notes}` : '');
      const r = await makeCards('reading', material, student.grade, 6);
      addCards(uid, student.id, r.data.cards, 'reading');
      onToast(`Added ${r.data.cards.length} flash cards.`);
      noteActivitySoon(uid, student, `Made flash cards from "${doc.title}"`);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="panel">
      <button className="secondary small" onClick={onBack}>
        ← All pages
      </button>
      <div className="row spread wrap">
        <h2>{doc.title}</h2>
        <div className="row wrap">
          {reading === null ? (
            <button className="secondary small" onClick={() => play(0)}>
              🔊 Read aloud
            </button>
          ) : (
            <button className="small" onClick={stop}>
              ⏹ Stop
            </button>
          )}
          <button className="secondary small" onClick={summarize} disabled={summary === 'loading'}>
            Summarize
          </button>
          <button className="secondary small" onClick={cards}>
            Make flash cards
          </button>
        </div>
      </div>
      <ErrorNote error={error} />
      {summary && (
        <div className="objective">
          {summary === 'loading' ? (
            <p className="muted typing">Summarizing…</p>
          ) : (
            <>
              <p>{summary.summary}</p>
              <ul>
                {summary.keyPoints.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {selection && (
        <div className="selbar">
          <span className="small">
            “{selection.text.length > 60 ? `${selection.text.slice(0, 60)}…` : selection.text}”
          </span>
          <button className="small" onClick={highlight}>
            Highlight
          </button>
          <button className="secondary small" onClick={explainSel}>
            What does this mean?
          </button>
          <button className="secondary small" onClick={() => setSelection(null)}>
            ✕
          </button>
          {selHelp && <p className="coach-tip">{selHelp}</p>}
        </div>
      )}
      <p className="muted small">Select words to highlight them or ask what they mean.</p>
      <div className="reader">
        {paras.map((p, i) => {
          const h = help[i];
          return (
            <div key={i} className={`para ${reading === i ? 'reading' : ''}`}>
              <p onMouseUp={() => onSelect(i)} onTouchEnd={() => onSelect(i)}>
                {withMarks(p, doc.highlights)}
              </p>
              <div className="row">
                <button className="secondary small" onClick={() => explain(i)} disabled={h === 'loading'}>
                  Explain simply
                </button>
                <button className="secondary small" onClick={() => play(i)}>
                  🔊 From here
                </button>
              </div>
              {h === 'loading' && <p className="muted typing small">Thinking…</p>}
              {typeof h === 'string' && h !== 'loading' && <p className="error">{h}</p>}
              {h === undefined && doc.explanations?.[i] && <p className="coach-tip">{doc.explanations[i]}</p>}
              {h && typeof h === 'object' && (
                <div className="coach-tip">
                  <p>{h.simple}</p>
                  {h.terms.length > 0 && (
                    <ul className="small">
                      {h.terms.map((t, j) => (
                        <li key={j}>
                          <strong>{t.term}</strong>: {t.meaning}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="small">
                    <span>Check yourself:</span> {h.question}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {doc.highlights.length > 0 && (
        <>
          <h3>Highlights</h3>
          <div className="row wrap">
            {doc.highlights.map((h) => (
              <span key={h} className="hl-chip">
                <mark>{h}</mark>
                <button
                  className="secondary small"
                  aria-label={`Remove highlight ${h}`}
                  onClick={() => updateReading(uid, doc.id, { highlights: doc.highlights.filter((x) => x !== h) })}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </>
      )}
      <h3>My notes</h3>
      <textarea
        rows={4}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== doc.notes && updateReading(uid, doc.id, { notes })}
        placeholder="Write what you learned in your own words."
      />
      <div className="row">
        <button
          className="secondary small"
          onClick={() => {
            stop();
            deleteReading(uid, doc.id);
            onBack();
          }}
        >
          Delete page
        </button>
      </div>
    </section>
  );
}
