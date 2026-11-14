import { useRef, useState } from 'react';
import {
  firstInterviewQuestion,
  nextInterviewStep,
  studyPlan,
  type InterviewQuestion,
} from '../lib/tutor';
import { masterySummary, recordResults, updateStudent, type Student } from '../lib/mastery';
import { listen, speak, speechSupported } from '../lib/speech';
import type { Source } from '../lib/ai';
import { ErrorNote, SourceBadge } from './common';
import { errorText } from '../lib/errors';
import { SUBJECTS } from '../lib/subjects';


interface Answered {
  q: InterviewQuestion;
  answer: string;
  isCorrect: boolean;
  feedback: string;
  source: Source;
}

const WEIGHT = { easy: 1, medium: 2, hard: 3 } as const;

function levelFor(items: Answered[]): string {
  const total = items.reduce((n, a) => n + WEIGHT[a.q.difficulty], 0);
  const got = items.filter((a) => a.isCorrect).reduce((n, a) => n + WEIGHT[a.q.difficulty], 0);
  const r = total ? got / total : 0;
  return r < 0.4 ? 'needs support' : r < 0.75 ? 'on track' : 'ahead';
}

interface Props {
  uid: string;
  student: Student;
  onAlerts: (a: string[]) => void;
  onDone: () => void;
}

export function Onboarding({ uid, student, onAlerts, onDone }: Props) {
  const [phase, setPhase] = useState<'setup' | 'interview' | 'done'>(student.onboarded ? 'done' : 'setup');
  const [subjects, setSubjects] = useState<string[]>(student.subjects ?? ['Math']);
  const [struggles, setStruggles] = useState('');
  const [schedule, setSchedule] = useState<string[]>([]);
  const [current, setCurrent] = useState<{ q: InterviewQuestion; source: Source } | null>(null);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(true);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ text: string; source: Source } | null>(
    student.plan ? { text: student.plan, source: 'in_cloud' } : null,
  );
  const stopRef = useRef<() => void>(() => {});

  function ask(q: InterviewQuestion, source: Source) {
    setCurrent({ q, source });
    if (voice) speak(q.question);
  }

  async function start() {
    const per = subjects.length >= 3 ? 2 : 3;
    const plan = subjects.flatMap((s) => Array<string>(per).fill(s)).slice(0, 8);
    setSchedule(plan);
    setAnswered([]);
    setPhase('interview');
    setBusy(true);
    setError(null);
    try {
      const r = await firstInterviewQuestion(student.grade, plan[0], struggles);
      ask(r.data, r.source);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(text: string) {
    if (!current) return;
    setBusy(true);
    setError(null);
    const idx = answered.length;
    const isLast = idx + 1 >= schedule.length;
    try {
      const r = await nextInterviewStep(student.grade, current.q, text, schedule[isLast ? idx : idx + 1]);
      const done: Answered = {
        q: current.q,
        answer: text,
        isCorrect: r.data.isCorrect,
        feedback: r.data.feedback,
        source: r.source,
      };
      const all = [...answered, done];
      setAnswered(all);
      setAnswer('');
      if (isLast) {
        await finish(all);
        if (voice) speak(`${r.data.feedback} That's the end of the interview. Well done!`);
      } else {
        setCurrent({ q: r.data, source: r.source });
        if (voice) speak(`${r.data.feedback} ${r.data.question}`);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish(all: Answered[]) {
    const levels = Object.fromEntries(
      subjects.map((s) => [s, levelFor(all.filter((a) => a.q.subject.toLowerCase() === s.toLowerCase()))]),
    );
    const raised = await recordResults(
      uid,
      student,
      all.map((a) => ({
        skill: `${a.q.subject.toLowerCase()}: ${a.q.skill}`,
        isCorrect: a.isCorrect,
        mistake: a.isCorrect ? undefined : `${a.q.skill}: "${a.q.question}" answered "${a.answer}"`,
      })),
    );
    onAlerts(raised);
    updateStudent(uid, student.id, { onboarded: true, subjects, levels });
    setCurrent(null);
    setPhase('done');
  }

  async function makePlan() {
    setBusy(true);
    setError(null);
    try {
      const r = await studyPlan(student.grade, masterySummary(student));
      setPlan({ text: r.data, source: r.source });
      updateStudent(uid, student.id, { plan: r.data });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function talk() {
    if (listening) return stopRef.current();
    setListening(true);
    stopRef.current = listen(
      (t) => {
        setAnswer(t);
        void submit(t);
      },
      (err) => {
        setListening(false);
        if (err && err !== 'no-speech' && err !== 'aborted') setError(`Microphone: ${err}`);
      },
    );
  }

  if (phase === 'setup') {
    return (
      <section className="panel">
        <h2>Hi {student.nickname}! Let's get to know you</h2>
        <p className="muted">
          A short spoken interview finds your level in each subject. It runs on this device, and your answers stay
          here.
        </p>
        <h3>Which subjects do you want help with?</h3>
        <div className="students">
          {SUBJECTS.map((s) => (
            <button
              key={s}
              className={subjects.includes(s) ? 'chip active' : 'chip'}
              onClick={() => setSubjects((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}
            >
              {s}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Is there anything you find hard? (optional)</span>
          <input value={struggles} onChange={(e) => setStruggles(e.target.value)} placeholder="e.g. fractions, essay writing" />
        </label>
        <div className="row">
          <button onClick={start} disabled={!subjects.length}>
            Start interview ({Math.min(8, subjects.length * (subjects.length >= 3 ? 2 : 3))} questions)
          </button>
          <label className="toggle">
            <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Read questions aloud
          </label>
        </div>
      </section>
    );
  }

  if (phase === 'interview') {
    return (
      <section className="panel chat">
        <div className="row spread">
          <h2>Placement interview</h2>
          <span className="muted">
            Question {Math.min(answered.length + 1, schedule.length)} of {schedule.length}
          </span>
        </div>
        <div className="bar">
          <div className="fill high" style={{ width: `${(answered.length / schedule.length) * 100}%` }} />
        </div>
        <div className="messages">
          {answered.map((a, i) => (
            <div key={i} className="turn">
              <div className="bubble tutor">
                <p>{a.q.question}</p>
                <SourceBadge source={a.source} />
              </div>
              <div className="bubble student">
                <p>{a.answer || '(skipped)'}</p>
              </div>
              <div className={`bubble tutor ${a.isCorrect ? 'good' : 'soft'}`}>
                <p>{a.feedback}</p>
              </div>
            </div>
          ))}
          {current && (
            <div className="bubble tutor">
              <p>
                <span className="muted">{current.q.subject} · </span>
                {current.q.question}
              </p>
              <SourceBadge source={current.source} />
            </div>
          )}
          {busy && <div className="bubble tutor muted">…</div>}
        </div>
        <ErrorNote error={error} />
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(answer);
          }}
        >
          {speechSupported() && (
            <button type="button" className={listening ? 'mic on' : 'mic'} onClick={talk} disabled={busy || !current}>
              {listening ? 'Listening… tap to stop' : 'Tap to answer'}
            </button>
          )}
          <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Or type your answer" />
          <button type="submit" disabled={busy || !current}>
            {answer.trim() ? 'Answer' : 'Skip'}
          </button>
        </form>
      </section>
    );
  }

  const levels = Object.entries(student.levels ?? {});
  return (
    <section className="panel">
      <h2>{student.nickname}'s starting point</h2>
      {levels.length ? (
        <ul className="skills">
          {levels.map(([s, l]) => (
            <li key={s} className="row spread">
              <span>{s}</span>
              <span className={`level ${l.replace(' ', '-')}`}>{l}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Saving results…</p>
      )}
      <h3>Study plan</h3>
      <p className="muted">
        Written in the cloud from an anonymous summary: grade, levels and skill scores. No name, answers or photos are
        sent.
      </p>
      {plan ? (
        <>
          <SourceBadge source={plan.source} />
          <p className="prewrap">{plan.text}</p>
        </>
      ) : null}
      <ErrorNote error={error} />
      <div className="row">
        <button onClick={makePlan} disabled={busy}>
          {busy ? 'Writing plan…' : plan ? 'Rewrite study plan' : 'Make my study plan'}
        </button>
        <button className="secondary" onClick={onDone}>
          Go to assessments
        </button>
        <button className="secondary" onClick={() => setPhase('setup')}>
          Retake interview
        </button>
      </div>
    </section>
  );
}
