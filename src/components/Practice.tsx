import { useState } from 'react';
import { makeQuiz, explainMistake, type Quiz } from '../lib/tutor';
import { recordResults, weakestSkills, type Student } from '../lib/mastery';
import type { Source } from '../lib/ai';
import { ErrorNote, SourceBadge } from './common';
import { errorText } from '../lib/errors';

interface Props {
  uid: string;
  student: Student;
  onAlerts: (a: string[]) => void;
}

export function Practice({ uid, student, onAlerts }: Props) {
  const weak = weakestSkills(student);
  const [quiz, setQuiz] = useState<{ data: Quiz; source: Source } | null>(null);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explain, setExplain] = useState<Record<number, { text: string; source: Source } | 'loading'>>({});

  async function generate() {
    setBusy(true);
    setError(null);
    setPicked({});
    setSubmitted(false);
    setExplain({});
    try {
      const skills = weak.length ? weak : ['fractions', 'mental arithmetic'];
      const r = await makeQuiz(skills, student.grade, student.mistakes.slice(-5));
      setQuiz({ data: r.data, source: r.source });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!quiz) return;
    setSubmitted(true);
    const results = quiz.data.questions.map((q, i) => ({
      skill: q.skill,
      isCorrect: picked[i] === q.answerIndex,
      mistake:
        picked[i] === q.answerIndex
          ? undefined
          : `${q.skill}: "${q.prompt}" answered "${q.choices[picked[i]] ?? 'no answer'}"`,
    }));
    onAlerts(await recordResults(uid, student, results));
  }

  async function why(i: number) {
    if (!quiz) return;
    const q = quiz.data.questions[i];
    setExplain((x) => ({ ...x, [i]: 'loading' }));
    try {
      const r = await explainMistake(q.skill, q.prompt, q.choices[picked[i]] ?? 'no answer', q.choices[q.answerIndex], student.grade);
      setExplain((x) => ({ ...x, [i]: { text: r.data, source: r.source } }));
    } catch (e) {
      setExplain((x) => ({ ...x, [i]: { text: errorText(e), source: 'in_cloud' } }));
    }
  }

  const score = quiz ? quiz.data.questions.filter((q, i) => picked[i] === q.answerIndex).length : 0;

  return (
    <section className="panel">
      <h2>Practice quiz</h2>
      <p className="muted">
        {weak.length ? (
          <>Targets {student.nickname}'s weakest skills: <strong>{weak.join(', ')}</strong>.</>
        ) : (
          <>Mark an answer sheet first to target weak skills. Until then this makes a general quiz.</>
        )}
      </p>
      <button onClick={generate} disabled={busy}>
        {busy ? 'Writing quiz…' : quiz ? 'New quiz' : 'Make a quiz'}
      </button>
      <ErrorNote error={error} />
      {quiz && (
        <div className="quiz">
          <div className="row spread">
            <h3>{quiz.data.title}</h3>
            <SourceBadge source={quiz.source} />
          </div>
          {quiz.data.questions.map((q, i) => {
            const ex = explain[i];
            return (
              <div key={i} className="question">
                <p>
                  <strong>{i + 1}.</strong> {q.prompt}
                </p>
                <div className="choices">
                  {q.choices.map((c, j) => (
                    <label
                      key={j}
                      className={
                        submitted ? (j === q.answerIndex ? 'choice right' : picked[i] === j ? 'choice wrong' : 'choice') : 'choice'
                      }
                    >
                      <input
                        type="radio"
                        name={`q${i}`}
                        disabled={submitted}
                        checked={picked[i] === j}
                        onChange={() => setPicked((p) => ({ ...p, [i]: j }))}
                      />
                      {c}
                    </label>
                  ))}
                </div>
                {!submitted && <details><summary>Hint</summary>{q.hint}</details>}
                {submitted && picked[i] !== q.answerIndex && (
                  <div className="explain">
                    {!ex && <button className="secondary" onClick={() => why(i)}>Why was I wrong?</button>}
                    {ex === 'loading' && <p className="muted">Thinking…</p>}
                    {ex && ex !== 'loading' && (
                      <>
                        <SourceBadge source={ex.source} />
                        <p className="prewrap">{ex.text}</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!submitted ? (
            <button onClick={submit} disabled={Object.keys(picked).length < quiz.data.questions.length}>
              Check answers
            </button>
          ) : (
            <h3>
              Score: {score} / {quiz.data.questions.length}
            </h3>
          )}
        </div>
      )}
    </section>
  );
}
