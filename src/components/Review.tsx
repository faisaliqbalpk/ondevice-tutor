import { useEffect, useMemo, useState } from 'react';
import { makeQuiz, markShortAnswers } from '../lib/tutor';
import { makeCards } from '../lib/studyAi';
import { recordResults, weakestSkills, type Student } from '../lib/mastery';
import {
  addCards,
  dailyStreak,
  deleteBankItem,
  deleteCard,
  dueLabel,
  isDue,
  logDaily,
  recordBankAttempt,
  reviewCard,
  saveToBank,
  today,
  watchBank,
  watchCards,
  watchDaily,
  type BankItem,
  type Card,
  type DailyLog,
  type Grade,
  type NewBankItem,
} from '../lib/study';
import { noteActivitySoon } from '../lib/memory';
import { speak } from '../lib/speech';
import type { Source } from '../lib/ai';
import { ErrorNote, SourceBadge } from './common';
import { errorText } from '../lib/errors';

export type ReviewView = 'daily' | 'cards' | 'bank';

interface Props {
  uid: string;
  student: Student;
  view: ReviewView;
  onAlerts: (a: string[]) => void;
  onToast: (t: string) => void;
}

/** Daily practice, flash cards and the question bank share live data, so they live together. */
export function Review({ uid, student, view, onAlerts, onToast }: Props) {
  const [bank, setBank] = useState<BankItem[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  useEffect(() => watchBank(uid, student.id, setBank), [uid, student.id]);
  useEffect(() => watchCards(uid, student.id, setCards), [uid, student.id]);
  useEffect(() => watchDaily(uid, student.id, setLogs), [uid, student.id]);

  if (view === 'cards') return <Cards uid={uid} student={student} cards={cards} onToast={onToast} />;
  if (view === 'bank') return <Bank uid={uid} student={student} bank={bank} onAlerts={onAlerts} />;
  return <Daily uid={uid} student={student} bank={bank} cards={cards} logs={logs} onAlerts={onAlerts} />;
}

// ---------- A set of questions (bank items or new ones), answered together ----------

type SetItem = (BankItem | (NewBankItem & { id?: undefined })) & { fresh?: boolean };

function QuestionSet({
  uid,
  student,
  items,
  source,
  onAlerts,
  onDone,
}: {
  uid: string;
  student: Student;
  items: SetItem[];
  source?: Source;
  onAlerts: (a: string[]) => void;
  onDone?: (done: number, correct: number) => void;
}) {
  const [given, setGiven] = useState<Record<number, string>>({});
  const [marks, setMarks] = useState<Record<number, { ok: boolean; feedback?: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const out: Record<number, { ok: boolean; feedback?: string }> = {};
      const shortIdx: number[] = [];
      items.forEach((q, i) => {
        if (q.choices.length) out[i] = { ok: given[i] === q.answer };
        else shortIdx.push(i);
      });
      if (shortIdx.length) {
        const r = await markShortAnswers(
          shortIdx.map((i) => ({ prompt: items[i].prompt, expected: items[i].answer, given: given[i] ?? '' })),
        );
        shortIdx.forEach((i, k) => {
          const m = r.data.marks[k];
          out[i] = { ok: !!m?.isCorrect, feedback: m?.feedback };
        });
      }
      setMarks(out);
      const fresh: (NewBankItem & { result: boolean })[] = [];
      items.forEach((q, i) => {
        if (q.id) recordBankAttempt(uid, q as BankItem, out[i].ok);
        else fresh.push({ prompt: q.prompt, choices: q.choices, answer: q.answer, skill: q.skill, hint: q.hint, origin: q.origin, result: out[i].ok });
      });
      if (fresh.length) void saveToBank(uid, student.id, fresh);
      onAlerts(
        await recordResults(
          uid,
          student,
          items.map((q, i) => ({
            skill: q.skill,
            isCorrect: out[i].ok,
            mistake: out[i].ok ? undefined : `${q.skill}: "${q.prompt}" answered "${given[i] || 'no answer'}"`,
          })),
        ),
      );
      const correct = Object.values(out).filter((m) => m.ok).length;
      onDone?.(items.length, correct);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const correct = marks ? Object.values(marks).filter((m) => m.ok).length : 0;

  return (
    <div className="quiz">
      {source && (
        <div className="row spread">
          <span className="muted small">New questions written for your weak spots</span>
          <SourceBadge source={source} />
        </div>
      )}
      {items.map((q, i) => {
        const m = marks?.[i];
        return (
          <div key={i} className="question">
            <p>
              <strong>{i + 1}.</strong> {q.prompt}{' '}
              <span className="diff-pill small">{q.id ? `review · ${q.skill}` : `new · ${q.skill}`}</span>
            </p>
            {q.choices.length ? (
              <div className="choices">
                {q.choices.map((c, j) => (
                  <label
                    key={j}
                    className={m ? (c === q.answer ? 'choice right' : given[i] === c ? 'choice wrong' : 'choice') : 'choice'}
                  >
                    <input
                      type="radio"
                      name={`set${i}`}
                      disabled={!!marks}
                      checked={given[i] === c}
                      onChange={() => setGiven((g) => ({ ...g, [i]: c }))}
                    />
                    {c}
                  </label>
                ))}
              </div>
            ) : (
              <input
                value={given[i] ?? ''}
                disabled={!!marks}
                onChange={(e) => setGiven((g) => ({ ...g, [i]: e.target.value }))}
                placeholder="Your answer"
              />
            )}
            {!marks && q.hint && (
              <details>
                <summary>Hint</summary>
                {q.hint}
              </details>
            )}
            {m && (
              <p className={m.ok ? 'good-text small' : 'bad-text small'}>
                {m.ok ? 'Correct.' : `Answer: ${q.answer}.`} {m.feedback}{' '}
                {!m.ok && 'It will come back for review soon.'}
              </p>
            )}
          </div>
        );
      })}
      <ErrorNote error={error} />
      {!marks ? (
        <button onClick={submit} disabled={busy || Object.keys(given).length < items.length}>
          {busy ? 'Checking…' : 'Check answers'}
        </button>
      ) : (
        <h3>
          Score: {correct} / {items.length}
        </h3>
      )}
    </div>
  );
}

// ---------- Daily practice ----------

const DAILY_SIZE = 6;

function Daily({
  uid,
  student,
  bank,
  cards,
  logs,
  onAlerts,
}: {
  uid: string;
  student: Student;
  bank: BankItem[];
  cards: Card[];
  logs: DailyLog[];
  onAlerts: (a: string[]) => void;
}) {
  const [set, setSet] = useState<{ items: SetItem[]; source?: Source } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const due = useMemo(
    () => bank.filter((b) => isDue(b)).sort((a, b) => (a.due ?? 0) - (b.due ?? 0)),
    [bank],
  );
  const dueCards = cards.filter((c) => isDue(c)).length;
  const todayLog = logs.find((l) => l.date === today());
  const streak = dailyStreak(logs);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      // Spaced review first, oldest due first; then top up with new questions on weak skills.
      const review: SetItem[] = due.slice(0, DAILY_SIZE - 2);
      const need = DAILY_SIZE - review.length;
      let fresh: SetItem[] = [];
      let source: Source | undefined;
      try {
        const weak = weakestSkills(student, 2);
        const r = await makeQuiz(weak.length ? weak : ['mental arithmetic', 'reading comprehension'], student.grade, student.mistakes.slice(-3), need);
        source = r.source;
        fresh = r.data.questions.slice(0, need).map((q) => ({
          prompt: q.prompt,
          choices: q.choices,
          answer: q.choices[q.answerIndex] ?? q.choices[0],
          skill: q.skill,
          hint: q.hint,
          origin: 'daily' as const,
          fresh: true,
        }));
      } catch (e) {
        // Offline with no model: practise what's due, if anything.
        if (!review.length) throw e;
      }
      setSet({ items: [...review, ...fresh], source });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="row spread wrap">
        <h2>Today's practice</h2>
        <span className="pill">{streak > 0 ? `🔥 ${streak}-day streak` : 'Start a streak today'}</span>
      </div>
      <p className="muted">
        A short daily set: questions due for spaced review come back first, then new ones on {student.nickname}'s
        weakest skills. Wrong answers return tomorrow; right ones wait longer each time.
      </p>
      <div className="stats">
        <div>
          <strong>{due.length}</strong>
          <span className="small muted">questions due</span>
        </div>
        <div>
          <strong>{dueCards}</strong>
          <span className="small muted">cards due</span>
        </div>
        <div>
          <strong>{todayLog ? `${todayLog.correct}/${todayLog.done}` : '0'}</strong>
          <span className="small muted">done today</span>
        </div>
        <div>
          <strong>{bank.length}</strong>
          <span className="small muted">in question bank</span>
        </div>
      </div>
      {!set && (
        <button className="big" onClick={start} disabled={busy}>
          {busy ? 'Building today’s set…' : todayLog ? 'Practise some more' : 'Start today’s practice'}
        </button>
      )}
      <ErrorNote error={error} />
      {set && (
        <>
          <QuestionSet
            uid={uid}
            student={student}
            items={set.items}
            source={set.source}
            onAlerts={onAlerts}
            onDone={(done, correct) => {
              logDaily(uid, student.id, todayLog, done, correct);
              noteActivitySoon(uid, student, `Daily practice: ${correct}/${done}`);
            }}
          />
          <button className="secondary" onClick={() => setSet(null)}>
            Done
          </button>
        </>
      )}
    </section>
  );
}

// ---------- Flash cards ----------

function Cards({ uid, student, cards, onToast }: { uid: string; student: Student; cards: Card[]; onToast: (t: string) => void }) {
  const due = cards.filter((c) => isDue(c));
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [showAll, setShowAll] = useState(false);
  const card = due[0];

  function grade(g: Grade) {
    if (!card) return;
    reviewCard(uid, card, g);
    setFlipped(false);
  }

  async function fromMistakes() {
    setBusy(true);
    setError(null);
    try {
      const r = await makeCards('mistakes', student.mistakes.slice(-8).join('\n'), student.grade, 6);
      addCards(uid, student.id, r.data.cards, 'mistake');
      onToast(`Added ${r.data.cards.length} cards from recent mistakes.`);
      noteActivitySoon(uid, student, 'Made flash cards from recent mistakes');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function addManual(e: React.FormEvent) {
    e.preventDefault();
    if (!front.trim() || !back.trim()) return;
    addCards(uid, student.id, [{ front: front.trim(), back: back.trim(), skill: 'my cards' }], 'manual');
    setFront('');
    setBack('');
  }

  return (
    <section className="panel">
      <div className="row spread wrap">
        <h2>Flash cards</h2>
        <span className="muted small">
          {due.length} due · {cards.length} total
        </span>
      </div>
      <p className="muted">
        Cards come from mistakes, readings, lessons and solutions. Rate how well you knew each one; cards you know
        come back less often.
      </p>
      {card ? (
        <div className="flash-wrap">
          <button className={`flash ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped((f) => !f)} aria-label="Flip card">
            <span className="flash-face">
              <span className="small muted">{flipped ? 'Answer' : card.skill}</span>
              <span className="flash-text">{flipped ? card.back : card.front}</span>
              {!flipped && <span className="small muted">Tap to flip</span>}
            </span>
          </button>
          <div className="row center wrap">
            <button className="secondary small" onClick={() => speak(flipped ? card.back : card.front)}>
              🔊
            </button>
            {flipped && (
              <>
                <button className="grade again" onClick={() => grade('again')}>
                  Again
                </button>
                <button className="grade hard" onClick={() => grade('hard')}>
                  Hard
                </button>
                <button className="grade good" onClick={() => grade('good')}>
                  Good
                </button>
                <button className="grade easy" onClick={() => grade('easy')}>
                  Easy
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="empty">{cards.length ? 'All caught up! No cards due right now.' : 'No cards yet.'}</p>
      )}
      <div className="row wrap">
        <button className="secondary" onClick={fromMistakes} disabled={busy || student.mistakes.length === 0}>
          {busy ? 'Writing cards…' : 'Make cards from my mistakes'}
        </button>
        {student.mistakes.length === 0 && <span className="muted small">No mistakes recorded yet.</span>}
      </div>
      <ErrorNote error={error} />
      <form className="row wrap" onSubmit={addManual}>
        <input value={front} onChange={(e) => setFront(e.target.value)} placeholder="Front (question)" />
        <input value={back} onChange={(e) => setBack(e.target.value)} placeholder="Back (answer)" />
        <button type="submit" className="secondary" disabled={!front.trim() || !back.trim()}>
          Add card
        </button>
      </form>
      {cards.length > 0 && (
        <details open={showAll} onToggle={(e) => setShowAll((e.target as HTMLDetailsElement).open)}>
          <summary>All cards</summary>
          <table>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id}>
                  <td>{c.front}</td>
                  <td>{c.back}</td>
                  <td className="small muted">{dueLabel(c)}</td>
                  <td>
                    <button className="secondary small" onClick={() => deleteCard(uid, c.id)} aria-label="Delete card">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

// ---------- Question bank ----------

function Bank({ uid, student, bank, onAlerts }: { uid: string; student: Student; bank: BankItem[]; onAlerts: (a: string[]) => void }) {
  const [skill, setSkill] = useState('all');
  const [onlyWrong, setOnlyWrong] = useState(false);
  const [practice, setPractice] = useState<BankItem[] | null>(null);
  const skills = [...new Set(bank.map((b) => b.skill))].sort();
  const shown = bank.filter((b) => (skill === 'all' || b.skill === skill) && (!onlyWrong || b.lastCorrect === false));

  if (practice) {
    return (
      <section className="panel">
        <button className="secondary small" onClick={() => setPractice(null)}>
          ← Question bank
        </button>
        <h2>Practise from the bank</h2>
        <QuestionSet uid={uid} student={student} items={practice} onAlerts={onAlerts} />
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Question bank</h2>
      <p className="muted">
        Every question {student.nickname} answers in quizzes, lessons, assessments and Solve is saved here with their
        results, and scheduled for review.
      </p>
      <div className="row wrap">
        <select value={skill} onChange={(e) => setSkill(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="all">All skills ({bank.length})</option>
          {skills.map((s) => (
            <option key={s} value={s}>
              {s} ({bank.filter((b) => b.skill === s).length})
            </option>
          ))}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} />
          Only ones I got wrong
        </label>
        <button onClick={() => setPractice([...shown].sort(() => Math.random() - 0.5).slice(0, 8))} disabled={!shown.length}>
          Practise {Math.min(8, shown.length)} of these
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="muted">No questions yet. Take a quiz, a lesson check or today's practice.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Question</th>
              <th>Skill</th>
              <th>Record</th>
              <th>Next review</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((b) => (
              <tr key={b.id} className={b.lastCorrect === false ? 'bad' : b.lastCorrect ? 'ok' : ''}>
                <td>
                  <details>
                    <summary>{b.prompt}</summary>
                    Answer: {b.answer}
                  </details>
                </td>
                <td className="small">{b.skill}</td>
                <td className="small">
                  {b.correct ?? 0}/{b.attempts ?? 0}
                </td>
                <td className="small muted">{dueLabel(b)}</td>
                <td>
                  <button className="secondary small" onClick={() => deleteBankItem(uid, b.id)} aria-label="Delete question">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
