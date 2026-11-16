import { useState } from 'react';
import type { Part } from 'firebase/ai';
import { explainStep, makeCards, solveProblem, type Solution } from '../lib/studyAi';
import { markShortAnswers } from '../lib/tutor';
import { recordResults, tutorContext, type Student } from '../lib/mastery';
import { addCards, saveToBank } from '../lib/study';
import { noteActivitySoon } from '../lib/memory';
import { photoToPart } from '../lib/image';
import { speak, stopSpeaking } from '../lib/speech';
import type { Source } from '../lib/ai';
import { ErrorNote, SourceBadge } from './common';
import { errorText } from '../lib/errors';

interface Props {
  uid: string;
  student: Student;
  onAlerts: (a: string[]) => void;
  onToast: (t: string) => void;
}

export function Solve({ uid, student, onAlerts, onToast }: Props) {
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ part: Part; previewUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [sol, setSol] = useState<{ data: Solution; source: Source } | null>(null);
  const [stepByStep, setStepByStep] = useState(true);
  const [shown, setShown] = useState(1);
  const [help, setHelp] = useState<Record<number, string | 'loading'>>({});
  const [ask, setAsk] = useState<Record<number, string>>({});
  const [tryAnswer, setTryAnswer] = useState('');
  const [tryResult, setTryResult] = useState<{ ok: boolean; feedback: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [carded, setCarded] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setNeedsConsent(false);
    setImage(await photoToPart(f));
  }

  async function solve(allowCloud: boolean) {
    setBusy(true);
    setError(null);
    setNeedsConsent(false);
    setSol(null);
    setHelp({});
    setTryAnswer('');
    setTryResult(null);
    setCarded(false);
    stopSpeaking();
    try {
      const r = await solveProblem({
        text: text.trim(),
        image: image?.part,
        grade: student.grade,
        context: tutorContext(student),
        allowCloud,
      });
      setSol({ data: r.data, source: r.source });
      setShown(stepByStep ? 1 : r.data.steps.length);
      noteActivitySoon(uid, student, `Asked for help solving a ${r.data.skill} problem`);
    } catch (e) {
      if (image && !allowCloud) setNeedsConsent(true);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function explain(i: number) {
    if (!sol) return;
    setHelp((h) => ({ ...h, [i]: 'loading' }));
    try {
      const r = await explainStep(sol.data, i, ask[i] ?? '', student.grade);
      setHelp((h) => ({ ...h, [i]: r.data }));
    } catch (e) {
      setHelp((h) => ({ ...h, [i]: errorText(e) }));
    }
  }

  async function checkTry() {
    if (!sol) return;
    setChecking(true);
    try {
      const p = sol.data.practice;
      const r = await markShortAnswers([{ prompt: p.prompt, expected: p.answer, given: tryAnswer }]);
      const m = r.data.marks[0] ?? { isCorrect: false, feedback: 'Could not mark this answer.' };
      setTryResult({ ok: m.isCorrect, feedback: m.feedback });
      await saveToBank(uid, student.id, [
        { prompt: p.prompt, choices: [], answer: p.answer, skill: sol.data.skill, origin: 'solve', result: m.isCorrect },
      ]);
      onAlerts(
        await recordResults(uid, student, [
          {
            skill: sol.data.skill,
            isCorrect: m.isCorrect,
            mistake: m.isCorrect ? undefined : `${sol.data.skill}: "${p.prompt}" answered "${tryAnswer}"`,
          },
        ]),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setChecking(false);
    }
  }

  async function cards() {
    if (!sol) return;
    try {
      const s = sol.data;
      const material = `${s.problem}\n${s.steps.map((x, i) => `${i + 1}. ${x.title}: ${x.work} (${x.why})`).join('\n')}\nAnswer: ${s.answer}`;
      const r = await makeCards('solution', material, student.grade, 4);
      addCards(uid, student.id, r.data.cards, 'solve');
      setCarded(true);
      onToast(`Added ${r.data.cards.length} flash cards.`);
    } catch (e) {
      setError(errorText(e));
    }
  }

  function readAloud() {
    if (!sol) return;
    const s = sol.data;
    speak(
      [s.understand, ...s.steps.slice(0, shown).map((x, i) => `Step ${i + 1}. ${x.title}. ${x.work}. ${x.why}`)].join(' '),
    );
  }

  const s = sol?.data;
  const allShown = s ? shown >= s.steps.length : false;

  return (
    <section className="panel">
      <h2>Solve it with me</h2>
      <p className="muted">
        Type a problem or snap a photo of it. Nano works through it step by step on this device. Photos only go to
        the cloud if you say so.
      </p>
      <div className="grid2">
        <label className="field">
          <span>Problem</span>
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. A rectangle is 3 times as long as it is wide. Its perimeter is 48 cm. How wide is it?"
          />
        </label>
        <label className="field">
          <span>Or a photo of the problem</span>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} />
          {image && (
            <button className="secondary small" onClick={() => setImage(null)}>
              Remove photo
            </button>
          )}
        </label>
      </div>
      {image && <img className="preview" src={image.previewUrl} alt="Problem preview" />}
      <div className="row wrap">
        <button disabled={busy || (!text.trim() && !image)} onClick={() => solve(false)}>
          {busy ? 'Working it out…' : 'Solve step by step'}
        </button>
        <label className="toggle">
          <input type="checkbox" checked={stepByStep} onChange={(e) => setStepByStep(e.target.checked)} />
          Show one step at a time
        </label>
      </div>
      {needsConsent && (
        <div className="consent">
          <p>
            Gemini Nano can't read this photo on this device right now. You can send it to the cloud instead; it will
            be logged in the privacy ledger. Or type the problem and it stays on the device.
          </p>
          <button onClick={() => solve(true)} disabled={busy}>
            Send this photo to the cloud
          </button>
        </div>
      )}
      <ErrorNote error={error} />

      {s && sol && (
        <div className="result">
          <div className="row spread">
            <h3>{s.topic}</h3>
            <div className="row">
              <button className="secondary small" onClick={readAloud}>
                🔊 Read aloud
              </button>
              <SourceBadge source={sol.source} />
            </div>
          </div>
          <p className="objective compact">
            <strong>Problem.</strong> {s.problem}
            <br />
            <strong>What it asks.</strong> {s.understand}
          </p>
          <ol className="steps">
            {s.steps.slice(0, shown).map((st, i) => {
              const h = help[i];
              return (
                <li key={i} className="step">
                  <strong>{st.title}</strong>
                  <p className="prewrap work">{st.work}</p>
                  <p className="muted small">Why: {st.why}</p>
                  {h === undefined ? (
                    <div className="row">
                      <input
                        value={ask[i] ?? ''}
                        onChange={(e) => setAsk((a) => ({ ...a, [i]: e.target.value }))}
                        placeholder="Stuck? Ask about this step"
                      />
                      <button className="secondary small" onClick={() => explain(i)}>
                        Explain
                      </button>
                    </div>
                  ) : (
                    <p className="coach-tip">{h === 'loading' ? 'Thinking…' : h}</p>
                  )}
                </li>
              );
            })}
          </ol>
          {!allShown ? (
            <button onClick={() => setShown((n) => n + 1)}>Next step</button>
          ) : (
            <>
              <p className="answer-box">
                <strong>Answer:</strong> {s.answer}
              </p>
              <p className="muted">Check: {s.check}</p>
              <div className="question">
                <h3>Your turn</h3>
                <p>{s.practice.prompt}</p>
                <div className="row">
                  <input value={tryAnswer} onChange={(e) => setTryAnswer(e.target.value)} placeholder="Your answer" />
                  <button onClick={checkTry} disabled={checking || !tryAnswer.trim() || !!tryResult}>
                    {checking ? 'Checking…' : 'Check'}
                  </button>
                </div>
                {tryResult && (
                  <p className={tryResult.ok ? 'good-text' : 'bad-text'}>
                    {tryResult.ok ? 'Correct! ' : `Not quite. The answer is ${s.practice.answer}. `}
                    {tryResult.feedback}
                  </p>
                )}
              </div>
              <button className="secondary" onClick={cards} disabled={carded}>
                {carded ? 'Flash cards added' : 'Make flash cards from this'}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
