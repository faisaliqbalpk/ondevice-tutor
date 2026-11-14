import { useState } from 'react';
import type { Part } from 'firebase/ai';
import { photoToPart } from '../lib/image';
import { markSheet, type MarkResult } from '../lib/tutor';
import { recordResults, resultsFromSheet, type Student } from '../lib/mastery';
import type { Source } from '../lib/ai';
import { ErrorNote, SourceBadge } from './common';
import { errorText } from '../lib/errors';

interface Props {
  uid: string;
  student: Student;
  onAlerts: (a: string[]) => void;
}

export function MarkSheet({ uid, student, onAlerts }: Props) {
  const [image, setImage] = useState<{ part: Part; previewUrl: string } | null>(null);
  const [answerKey, setAnswerKey] = useState('1. 12\n2. 3/4\n3. 45 degrees');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [result, setResult] = useState<{ data: MarkResult; source: Source } | null>(null);
  const [saved, setSaved] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setResult(null);
    setSaved(false);
    setNeedsConsent(false);
    setImage(await photoToPart(f));
  }

  async function mark(allowCloud: boolean) {
    if (!image) return;
    setBusy(true);
    setError(null);
    setNeedsConsent(false);
    try {
      const r = await markSheet(image.part, answerKey, Object.keys(student.skills), allowCloud);
      setResult({ data: r.data, source: r.source });
    } catch (e) {
      if (!allowCloud) {
        setNeedsConsent(true);
      } else {
        setError(errorText(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!result) return;
    const raised = await recordResults(uid, student, resultsFromSheet(result.data));
    onAlerts(raised);
    setSaved(true);
  }

  const score = result ? result.data.questions.filter((q) => q.isCorrect).length : 0;

  return (
    <section className="panel">
      <h2>Mark an answer sheet</h2>
      <p className="muted">
        The photo is read by Gemini Nano on this device. It is only sent to the cloud if you say so.
      </p>
      <div className="grid2">
        <label className="field">
          <span>Answer sheet photo</span>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <label className="field">
          <span>Answer key (one per line)</span>
          <textarea rows={4} value={answerKey} onChange={(e) => setAnswerKey(e.target.value)} />
        </label>
      </div>
      {image && <img className="preview" src={image.previewUrl} alt="Answer sheet preview" />}
      <div className="row">
        <button disabled={!image || busy} onClick={() => mark(false)}>
          {busy ? 'Marking…' : 'Mark on this device'}
        </button>
      </div>
      {needsConsent && (
        <div className="consent">
          <p>
            Gemini Nano isn't available on this device right now. You can mark this sheet in the cloud instead.
            The photo will be sent to Gemini and logged in the privacy ledger. Cover the student's name first.
          </p>
          <button onClick={() => mark(true)} disabled={busy}>
            Send this photo to the cloud
          </button>
        </div>
      )}
      <ErrorNote error={error} />
      {result && (
        <div className="result">
          <div className="row spread">
            <h3>
              {score} / {result.data.questions.length} correct
            </h3>
            <SourceBadge source={result.source} />
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Answer</th>
                <th>Expected</th>
                <th>Skill</th>
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody>
              {result.data.questions.map((q) => (
                <tr key={q.number} className={q.isCorrect ? 'ok' : 'bad'}>
                  <td>{q.number}</td>
                  <td>
                    {q.studentAnswer}
                    {q.confidence < 0.6 && <span className="hint" title="Low reading confidence"> ?</span>}
                  </td>
                  <td>{q.correctAnswer}</td>
                  <td>{q.skill}</td>
                  <td>{q.feedback}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={save} disabled={saved}>
            {saved ? 'Saved to profile' : `Save to ${student.nickname}'s profile`}
          </button>
        </div>
      )}
    </section>
  );
}
