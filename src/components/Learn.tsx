import { useEffect, useState } from 'react';
import { makeCards, makeLesson, makePath, type Lesson } from '../lib/studyAi';
import { recordResults, tutorContext, type Student } from '../lib/mastery';
import {
  PASS_MARK,
  addCards,
  deletePath,
  recordTopicCheck,
  savePath,
  saveToBank,
  watchPaths,
  type LearningPath,
} from '../lib/study';
import { noteActivitySoon } from '../lib/memory';
import { SUBJECTS } from '../lib/subjects';
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

const ICON = { passed: '✅', open: '▶️', locked: '🔒' } as const;

export function Learn({ uid, student, onAlerts, onToast }: Props) {
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [pathId, setPathId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState(student.subjects?.[0] ?? 'Math');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topic, setTopic] = useState<number | null>(null);

  useEffect(() => watchPaths(uid, student.id, setPaths), [uid, student.id]);

  const path = paths.find((p) => p.id === pathId) ?? paths[0] ?? null;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await makePath({
        subject,
        focus: focus.trim(),
        grade: student.grade,
        level: student.levels?.[subject] ?? '',
        context: tutorContext(student),
      });
      const topics = r.data.topics.slice(0, 7).map((t, i) => ({
        ...t,
        status: i === 0 ? ('open' as const) : ('locked' as const),
        best: 0,
        attempts: 0,
      }));
      if (!topics.length) throw new Error('Nano did not return any topics. Try again.');
      const id = savePath(uid, { studentId: student.id, subject, focus: focus.trim(), topics });
      setPathId(id);
      setCreating(false);
      setFocus('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (path && topic !== null && path.topics[topic]) {
    return (
      <LessonView
        key={`${path.id}:${topic}`}
        uid={uid}
        student={student}
        path={path}
        index={topic}
        onBack={() => setTopic(null)}
        onNext={() => setTopic(topic + 1 < path.topics.length ? topic + 1 : null)}
        onAlerts={onAlerts}
        onToast={onToast}
      />
    );
  }

  const subjects = [...new Set([...(student.subjects ?? []), ...SUBJECTS])];
  const passed = path ? path.topics.filter((t) => t.status === 'passed').length : 0;

  return (
    <section className="panel">
      <div className="row spread wrap">
        <h2>Guided learning</h2>
        {paths.length > 0 && !creating && (
          <button className="secondary" onClick={() => setCreating(true)}>
            New path
          </button>
        )}
      </div>
      <p className="muted">
        A step-by-step path through a subject. Each topic has a short lesson and a check; score{' '}
        {Math.round(PASS_MARK * 100)}% or more to unlock the next one.
      </p>

      {(creating || paths.length === 0) && (
        <div className="objective">
          <div className="grid2">
            <label className="field">
              <span>Subject</span>
              <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                {subjects.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>What do you want to learn? (optional)</span>
              <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. fractions, the water cycle" />
            </label>
          </div>
          <div className="row">
            <button onClick={create} disabled={busy}>
              {busy ? 'Planning the path…' : 'Plan my path'}
            </button>
            {paths.length > 0 && (
              <button className="secondary" onClick={() => setCreating(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
      <ErrorNote error={error} />

      {paths.length > 1 && (
        <div className="row wrap">
          {paths.map((p) => (
            <button key={p.id} className={p.id === path?.id ? 'chip active' : 'chip'} onClick={() => setPathId(p.id)}>
              {p.subject}
              {p.focus ? `: ${p.focus}` : ''}
            </button>
          ))}
        </div>
      )}

      {path && (
        <div className="path">
          <div className="row spread">
            <h3>
              {path.subject}
              {path.focus ? `: ${path.focus}` : ''}
            </h3>
            <span className="muted small">
              {passed} / {path.topics.length} passed
            </span>
          </div>
          <div className="bar">
            <div className="fill high" style={{ width: `${(passed / path.topics.length) * 100}%` }} />
          </div>
          <ol className="topics">
            {path.topics.map((t, i) => (
              <li key={i} className={`topic ${t.status}`}>
                <button
                  className="topic-btn"
                  disabled={t.status === 'locked'}
                  onClick={() => setTopic(i)}
                  title={t.status === 'locked' ? 'Pass the topic before this one to unlock it' : ''}
                >
                  <span className="topic-icon">{ICON[t.status]}</span>
                  <span className="topic-body">
                    <strong>{t.title}</strong>
                    <span className="small muted">{t.goal}</span>
                  </span>
                  {t.attempts > 0 && <span className="small muted">best {Math.round(t.best * 100)}%</span>}
                </button>
              </li>
            ))}
          </ol>
          <button
            className="secondary small"
            onClick={() => {
              deletePath(uid, path.id);
              setPathId(null);
            }}
          >
            Delete this path
          </button>
        </div>
      )}
    </section>
  );
}

function LessonView(props: {
  uid: string;
  student: Student;
  path: LearningPath;
  index: number;
  onBack: () => void;
  onNext: () => void;
  onAlerts: (a: string[]) => void;
  onToast: (t: string) => void;
}) {
  const { uid, student, path, index, onBack, onNext, onAlerts, onToast } = props;
  const t = path.topics[index];
  const [lesson, setLesson] = useState<{ data: Lesson; source: Source } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [score, setScore] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLesson(null);
    setPicked({});
    setScore(null);
    setError(null);
    makeLesson({
      subject: path.subject,
      title: t.title,
      goal: t.goal,
      grade: student.grade,
      context: tutorContext(student),
      retry: attempt > 0 || (t.attempts > 0 && t.status !== 'passed'),
    })
      .then((r) => live && setLesson({ data: r.data, source: r.source }))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
      stopSpeaking();
    };
    // Regenerate only when the topic or attempt changes, not on every profile update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.id, index, attempt]);

  async function submit() {
    if (!lesson) return;
    const qs = lesson.data.questions;
    const right = qs.filter((q, i) => picked[i] === q.answerIndex).length;
    const s = qs.length ? right / qs.length : 0;
    setScore(s);
    recordTopicCheck(uid, path, index, s);
    const skill = t.title;
    void saveToBank(
      uid,
      student.id,
      qs.map((q, i) => ({
        prompt: q.prompt,
        choices: q.choices,
        answer: q.choices[q.answerIndex] ?? '',
        hint: q.explanation,
        skill,
        origin: 'lesson' as const,
        result: picked[i] === q.answerIndex,
      })),
    );
    onAlerts(
      await recordResults(
        uid,
        student,
        qs.map((q, i) => ({
          skill,
          isCorrect: picked[i] === q.answerIndex,
          mistake:
            picked[i] === q.answerIndex ? undefined : `${skill}: "${q.prompt}" answered "${q.choices[picked[i]] ?? 'no answer'}"`,
        })),
      ),
    );
    noteActivitySoon(uid, student, `Lesson check on "${t.title}" (${path.subject}): ${right}/${qs.length}`);
  }

  async function cards() {
    if (!lesson) return;
    try {
      const l = lesson.data;
      const r = await makeCards('lesson', `${t.title}\n${l.intro}\n${l.keyIdeas.join('\n')}`, student.grade, 4);
      addCards(uid, student.id, r.data.cards, 'lesson');
      onToast(`Added ${r.data.cards.length} flash cards.`);
    } catch (e) {
      setError(errorText(e));
    }
  }

  const l = lesson?.data;
  const passed = score !== null && score >= PASS_MARK;

  return (
    <section className="panel">
      <button className="secondary small" onClick={onBack}>
        ← {path.subject} path
      </button>
      <div className="row spread">
        <h2>
          {index + 1}. {t.title}
        </h2>
        {lesson && <SourceBadge source={lesson.source} />}
      </div>
      <p className="objective compact">
        <strong>Goal.</strong> {t.goal}
      </p>
      <ErrorNote error={error} />
      {!l && !error && <p className="muted typing">Nano is writing your lesson…</p>}
      {l && (
        <>
          <div className="row">
            <button className="secondary small" onClick={() => speak(`${l.intro} ${l.keyIdeas.join('. ')}`)}>
              🔊 Read aloud
            </button>
            <button className="secondary small" onClick={cards}>
              Make flash cards
            </button>
          </div>
          <p>{l.intro}</p>
          <h3>Key ideas</h3>
          <ul>
            {l.keyIdeas.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
          <h3>Worked example</h3>
          <p className="prewrap">{l.example.problem}</p>
          <details>
            <summary>Show the solution</summary>
            <p className="prewrap">{l.example.solution}</p>
          </details>
          <h3>Check</h3>
          {l.questions.map((q, i) => (
            <div key={i} className="question">
              <p>
                <strong>{i + 1}.</strong> {q.prompt}
              </p>
              <div className="choices">
                {q.choices.map((c, j) => (
                  <label
                    key={j}
                    className={
                      score !== null ? (j === q.answerIndex ? 'choice right' : picked[i] === j ? 'choice wrong' : 'choice') : 'choice'
                    }
                  >
                    <input
                      type="radio"
                      name={`lq${i}`}
                      disabled={score !== null}
                      checked={picked[i] === j}
                      onChange={() => setPicked((p) => ({ ...p, [i]: j }))}
                    />
                    {c}
                  </label>
                ))}
              </div>
              {score !== null && picked[i] !== q.answerIndex && <p className="muted small">{q.explanation}</p>}
            </div>
          ))}
          {score === null ? (
            <button onClick={submit} disabled={Object.keys(picked).length < l.questions.length}>
              Check my answers
            </button>
          ) : (
            <div className={`gate ${passed ? 'won' : ''}`}>
              <h3>
                {Math.round(score * 100)}%{' '}
                {passed ? '· Topic passed! 🎉' : `· You need ${Math.round(PASS_MARK * 100)}% to unlock the next topic.`}
              </h3>
              <div className="row">
                {passed ? (
                  <button onClick={onNext}>{index + 1 < path.topics.length ? 'Next topic →' : 'Finish path'}</button>
                ) : (
                  <button onClick={() => setAttempt((a) => a + 1)}>Explain it another way and retry</button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
