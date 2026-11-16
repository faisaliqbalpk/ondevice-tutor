import { useEffect, useState } from 'react';
import { makeAssessment, markShortAnswers, type AssessmentDraft, type ShortAnswerMark } from '../lib/tutor';
import {
  recordResults,
  saveAssessment,
  watchAssessments,
  type Assessment,
  type Student,
} from '../lib/mastery';
import type { Source } from '../lib/ai';
import { ErrorNote, SourceBadge } from './common';
import { saveToBank } from '../lib/study';
import { errorText } from '../lib/errors';
import { SUBJECTS } from '../lib/subjects';

const LEVEL_TEXT: Record<string, string> = {
  'needs support': 'below grade level',
  'on track': 'at grade level',
  ahead: 'above grade level',
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

interface Props {
  uid: string;
  student: Student;
  onAlerts: (a: string[]) => void;
  onMarkPrinted: (a: Assessment) => void;
}

export function Assessments({ uid, student, onAlerts, onMarkPrinted }: Props) {
  const subjects = student.subjects?.length ? student.subjects : SUBJECTS;
  const [subject, setSubject] = useState(subjects[0]);
  const [topics, setTopics] = useState('');
  const [level, setLevel] = useState(LEVEL_TEXT[student.levels?.[subjects[0]] ?? ''] ?? 'at grade level');
  const [count, setCount] = useState(6);
  const [mix, setMix] = useState<'mcq' | 'short' | 'mixed'>('mixed');
  const [draft, setDraft] = useState<{ data: AssessmentDraft; source: Source } | null>(null);
  const [saved, setSaved] = useState<Assessment[]>([]);
  const [taking, setTaking] = useState<Assessment | null>(null);
  const [printing, setPrinting] = useState<{ a: Assessment; withKey: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => watchAssessments(uid, setSaved), [uid]);

  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 50);
    return () => clearTimeout(t);
  }, [printing]);

  function pickSubject(s: string) {
    setSubject(s);
    setLevel(LEVEL_TEXT[student.levels?.[s] ?? ''] ?? 'at grade level');
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await makeAssessment({ subject, topics, grade: student.grade, level, count, mix });
      setDraft({ data: r.data, source: r.source });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!draft) return;
    saveAssessment(uid, { title: draft.data.title, subject, grade: student.grade, questions: draft.data.questions });
    setDraft(null);
  }

  if (taking) {
    return (
      <TakeAssessment
        uid={uid}
        student={student}
        assessment={taking}
        onAlerts={onAlerts}
        onClose={() => setTaking(null)}
      />
    );
  }

  return (
    <>
      <section className="panel no-print">
        <h2>Create an assessment</h2>
        <p className="muted">
          Gemini Nano writes the questions on this device. Take it on screen, or print it and mark the paper copies
          with a photo.
        </p>
        <div className="grid2">
          <label className="field">
            <span>Subject</span>
            <select value={subject} onChange={(e) => pickSubject(e.target.value)}>
              {subjects.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Topics (optional)</span>
            <input value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="e.g. fractions, percentages" />
          </label>
          <label className="field">
            <span>Level</span>
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              {Object.values(LEVEL_TEXT).map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <div className="grid2">
            <label className="field">
              <span>Questions</span>
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[4, 6, 8, 10].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Type</span>
              <select value={mix} onChange={(e) => setMix(e.target.value as typeof mix)}>
                <option value="mixed">Mixed</option>
                <option value="mcq">Multiple choice</option>
                <option value="short">Short answer</option>
              </select>
            </label>
          </div>
        </div>
        <div className="row">
          <button onClick={generate} disabled={busy}>
            {busy ? 'Writing questions…' : 'Create assessment'}
          </button>
        </div>
        <ErrorNote error={error} />
        {draft && (
          <div className="result">
            <div className="row spread">
              <h3>{draft.data.title}</h3>
              <SourceBadge source={draft.source} />
            </div>
            <ol>
              {draft.data.questions.map((q, i) => (
                <li key={i} className="question">
                  <p>
                    {q.prompt} <span className="muted">({q.skill})</span>
                  </p>
                  {q.type === 'mcq' && (
                    <ol type="A">
                      {q.choices.map((c, j) => (
                        <li key={j} className={c === q.answer ? 'answer' : ''}>
                          {c}
                        </li>
                      ))}
                    </ol>
                  )}
                  {q.type === 'short' && <p className="muted">Model answer: {q.answer}</p>}
                  <button
                    className="secondary small"
                    onClick={() =>
                      setDraft({ ...draft, data: { ...draft.data, questions: draft.data.questions.filter((_, k) => k !== i) } })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
            <div className="row">
              <button onClick={save} disabled={!draft.data.questions.length}>
                Save assessment
              </button>
              <button className="secondary" onClick={generate} disabled={busy}>
                Try again
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel no-print" style={{ marginTop: 16 }}>
        <h2>Saved assessments</h2>
        {saved.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="ledger">
            {saved.map((a) => (
              <li key={a.id}>
                <div className="row spread">
                  <div>
                    <strong>{a.title}</strong>
                    <div className="muted">
                      {a.subject} · {a.grade} · {a.questions.length} questions
                    </div>
                  </div>
                  <div className="row">
                    <button onClick={() => setTaking(a)}>Take now</button>
                    <button className="secondary" onClick={() => setPrinting({ a, withKey: false })}>
                      Print
                    </button>
                    <button className="secondary" onClick={() => setPrinting({ a, withKey: true })}>
                      Print key
                    </button>
                    <button className="secondary" onClick={() => onMarkPrinted(a)}>
                      Mark paper copy
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {printing && <PrintSheet a={printing.a} withKey={printing.withKey} />}
    </>
  );
}

function PrintSheet({ a, withKey }: { a: Assessment; withKey: boolean }) {
  return (
    <div className="print-only">
      <h1>{a.title}</h1>
      <p>
        {a.subject} · {a.grade}
        {withKey ? ' · ANSWER KEY' : ''}
      </p>
      {!withKey && <p>Name: ______________________ Date: ____________</p>}
      <ol>
        {a.questions.map((q, i) => (
          <li key={i} className="print-q">
            <p>{q.prompt}</p>
            {q.type === 'mcq' ? (
              <ol type="A">
                {q.choices.map((c, j) => (
                  <li key={j}>
                    {c}
                    {withKey && c === q.answer ? '  ✓' : ''}
                  </li>
                ))}
              </ol>
            ) : withKey ? (
              <p>
                <em>{q.answer}</em>
              </p>
            ) : (
              <p>Answer: ____________________________________________</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function TakeAssessment({
  uid,
  student,
  assessment,
  onAlerts,
  onClose,
}: {
  uid: string;
  student: Student;
  assessment: Assessment;
  onAlerts: (a: string[]) => void;
  onClose: () => void;
}) {
  const [answers, setAnswers] = useState<string[]>(() => assessment.questions.map(() => ''));
  const [marks, setMarks] = useState<ShortAnswerMark[] | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const qs = assessment.questions;
      const result: ShortAnswerMark[] = qs.map((q, i) =>
        q.type === 'mcq'
          ? { isCorrect: same(answers[i], q.answer), feedback: same(answers[i], q.answer) ? 'Correct.' : `The answer is ${q.answer}.` }
          : { isCorrect: false, feedback: '' },
      );
      const shortIdx = qs.map((q, i) => (q.type === 'short' ? i : -1)).filter((i) => i >= 0);
      if (shortIdx.length) {
        const r = await markShortAnswers(
          shortIdx.map((i) => ({ prompt: qs[i].prompt, expected: qs[i].answer, given: answers[i] })),
        );
        shortIdx.forEach((qi, k) => {
          result[qi] = r.data.marks[k] ?? { isCorrect: false, feedback: 'Could not mark this answer.' };
        });
        setSource(r.source);
      } else {
        setSource('on_device');
      }
      setMarks(result);
      void saveToBank(
        uid,
        student.id,
        qs.map((q, i) => ({
          prompt: q.prompt,
          choices: q.type === 'mcq' ? q.choices : [],
          answer: q.answer,
          skill: `${assessment.subject.toLowerCase()}: ${q.skill}`,
          origin: 'assessment' as const,
          result: result[i].isCorrect,
        })),
      );
      onAlerts(
        await recordResults(
          uid,
          student,
          qs.map((q, i) => ({
            skill: `${assessment.subject.toLowerCase()}: ${q.skill}`,
            isCorrect: result[i].isCorrect,
            mistake: result[i].isCorrect ? undefined : `${q.skill}: "${q.prompt}" answered "${answers[i] || 'blank'}"`,
          })),
        ),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const score = marks ? marks.filter((m) => m.isCorrect).length : 0;

  return (
    <section className="panel">
      <div className="row spread">
        <h2>{assessment.title}</h2>
        <button className="secondary" onClick={onClose}>
          Back
        </button>
      </div>
      {assessment.questions.map((q, i) => (
        <div key={i} className="question">
          <p>
            <strong>{i + 1}.</strong> {q.prompt}
          </p>
          {q.type === 'mcq' ? (
            <div className="choices">
              {q.choices.map((c, j) => (
                <label
                  key={j}
                  className={marks ? (c === q.answer ? 'choice right' : answers[i] === c ? 'choice wrong' : 'choice') : 'choice'}
                >
                  <input
                    type="radio"
                    name={`a${i}`}
                    disabled={!!marks}
                    checked={answers[i] === c}
                    onChange={() => setAnswers((x) => x.map((v, k) => (k === i ? c : v)))}
                  />
                  {c}
                </label>
              ))}
            </div>
          ) : (
            <input
              value={answers[i]}
              disabled={!!marks}
              onChange={(e) => setAnswers((x) => x.map((v, k) => (k === i ? e.target.value : v)))}
              placeholder="Your answer"
            />
          )}
          {marks && <p className={marks[i].isCorrect ? 'good-text' : 'bad-text'}>{marks[i].feedback}</p>}
        </div>
      ))}
      <ErrorNote error={error} />
      {!marks ? (
        <button onClick={submit} disabled={busy}>
          {busy ? 'Marking…' : 'Submit answers'}
        </button>
      ) : (
        <div className="row spread">
          <h3>
            Score: {score} / {assessment.questions.length}
          </h3>
          {source && <SourceBadge source={source} />}
        </div>
      )}
    </section>
  );
}
