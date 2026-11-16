import { useEffect, useMemo, useState } from 'react';
import { mastery, type Alert, type Student } from '../lib/mastery';
import { RANKS, missionStats, watchMissionLog, type MissionRecord } from '../lib/missions';
import {
  dailyStreak,
  isDue,
  today,
  watchCards,
  watchDaily,
  watchPaths,
  type Card,
  type DailyLog,
  type LearningPath,
} from '../lib/study';
import { clearMemory, refreshMemory } from '../lib/memory';
import { guardianUrl, publishGuardian, stopSharing } from '../lib/guardian';
import { errorText } from '../lib/errors';

export function Progress({ uid, student, alerts }: { uid: string; student: Student; alerts: Alert[] }) {
  const [records, setRecords] = useState<MissionRecord[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  useEffect(() => watchMissionLog(uid, setRecords), [uid]);
  useEffect(() => watchDaily(uid, student.id, setLogs), [uid, student.id]);
  useEffect(() => watchPaths(uid, student.id, setPaths), [uid, student.id]);
  useEffect(() => watchCards(uid, student.id, setCards), [uid, student.id]);
  const stats = useMemo(() => missionStats(records, student.id), [records, student.id]);
  const streak = dailyStreak(logs);
  const skills = Object.entries(student.skills).sort(([, a], [, b]) => mastery(a) - mastery(b));
  const mine = alerts.filter((a) => a.studentId === student.id);
  return (
    <section className="panel">
      <h2>{student.nickname}'s progress</h2>
      {skills.length === 0 ? (
        <p className="muted">No marked work yet. Mark an answer sheet or take a quiz.</p>
      ) : (
        <ul className="skills">
          {skills.map(([k, s]) => {
            const pct = Math.round(mastery(s) * 100);
            return (
              <li key={k}>
                <div className="row spread">
                  <span>{k}</span>
                  <span className="muted">
                    {pct}% recent · {s.correct}/{s.total} all time
                  </span>
                </div>
                <div className="bar">
                  <div className={pct < 50 ? 'fill low' : pct < 80 ? 'fill mid' : 'fill high'} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <h3>Daily practice</h3>
      <p>
        {streak > 0 ? `🔥 ${streak}-day streak` : 'No streak yet'} ·{' '}
        {logs.find((l) => l.date === today())?.done ?? 0} questions today · {cards.filter((c) => isDue(c)).length} flash
        cards due
      </p>
      {paths.length > 0 && (
        <>
          <h3>Guided learning</h3>
          <ul className="skills">
            {paths.map((p) => {
              const passed = p.topics.filter((t) => t.status === 'passed').length;
              return (
                <li key={p.id}>
                  <div className="row spread">
                    <span>
                      {p.subject}
                      {p.focus ? `: ${p.focus}` : ''}
                    </span>
                    <span className="muted">
                      {passed}/{p.topics.length} topics
                    </span>
                  </div>
                  <div className="bar">
                    <div className="fill high" style={{ width: `${(passed / p.topics.length) * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <h3>Missions</h3>
      {stats.records.length === 0 ? (
        <p className="muted">No missions yet. Try one in the Missions tab.</p>
      ) : (
        <>
          <p>
            Level {stats.level} · {stats.xp} XP · {stats.records.filter((r) => r.completed).length} completed
            {stats.streak > 0 ? ` · 🔥 ${stats.streak}-day streak` : ''}
          </p>
          <ul className="mission-log">
            {stats.records.slice(0, 10).map((r) => (
              <li key={r.id}>
                <span>{r.emoji}</span>
                <span>{r.title}</span>
                <span className="muted small">
                  {r.mode === 'coach' ? 'Coach' : 'Challenge'} ·{' '}
                  {!r.completed ? 'not finished' : r.score ? `${RANKS[r.score].stars} ${RANKS[r.score].name}` : 'practised'} · +{r.xp} XP
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Alerts</h3>
      {mine.length === 0 ? (
        <p className="muted">No alerts.</p>
      ) : (
        <ul className="alerts">
          {mine.map((a) => (
            <li key={a.id}>{a.message}</li>
          ))}
        </ul>
      )}
      <Memory uid={uid} student={student} />
      <Guardian uid={uid} student={student} logs={logs} paths={paths} cards={cards} streak={streak} mstats={stats} />
    </section>
  );
}

function Memory({ uid, student }: { uid: string; student: Student }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="objective memory">
      <h3>What the tutor remembers</h3>
      <p className="muted small">
        A short note Gemini Nano keeps about how {student.nickname} learns. It is added to on-device prompts so lessons,
        solutions and the voice tutor are personalised. It is never sent with cloud-first requests like the study plan; if Nano is unavailable and a request falls back to the cloud, that request shows in the Privacy ledger.
      </p>
      <p className="prewrap">{student.memory || 'Nothing yet. It fills in after a few lessons, solves or practice sets.'}</p>
      {student.memoryAt ? <p className="muted small">Updated {new Date(student.memoryAt).toLocaleString()}</p> : null}
      <div className="row">
        <button
          className="secondary small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await refreshMemory(uid, student);
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Updating…' : 'Update now'}
        </button>
        <button className="secondary small" onClick={() => clearMemory(uid, student)} disabled={!student.memory}>
          Forget everything
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Guardian(props: {
  uid: string;
  student: Student;
  logs: DailyLog[];
  paths: LearningPath[];
  cards: Card[];
  streak: number;
  mstats: ReturnType<typeof missionStats>;
}) {
  const { uid, student, logs, paths, cards, streak, mstats } = props;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = student.guardianToken;

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const weekAgo = today(new Date(Date.now() - 6 * 864e5));
      const week = logs.filter((l) => l.date >= weekAgo);
      await publishGuardian(uid, student, {
        dailyStreak: streak,
        practiceDays7: week.filter((l) => l.done > 0).length,
        questionsAnswered7: week.reduce((n, l) => n + l.done, 0),
        missionLevel: mstats.level,
        missionsCompleted: mstats.records.filter((r) => r.completed).length,
        paths: paths.map((p) => ({
          subject: p.focus ? `${p.subject}: ${p.focus}` : p.subject,
          passed: p.topics.filter((t) => t.status === 'passed').length,
          total: p.topics.length,
          current: p.topics.find((t) => t.status === 'open')?.title ?? 'Complete',
        })),
        cardsDue: cards.filter((c) => isDue(c)).length,
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="objective">
      <h3>Guardian view</h3>
      <p className="muted small">
        Share a read-only progress page with a parent or carer. It shows scores, streaks and learning paths only: no
        answers, photos, notes or tutor memory. It is a snapshot, so press Update to refresh it.
      </p>
      {token ? (
        <>
          <div className="row wrap">
            <input readOnly value={guardianUrl(token)} onFocus={(e) => e.target.select()} />
            <button
              className="small"
              onClick={async () => {
                await navigator.clipboard?.writeText(guardianUrl(token));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <div className="row wrap">
            <a href={guardianUrl(token)} target="_blank" rel="noreferrer">
              Open guardian view
            </a>
            <button className="secondary small" onClick={publish} disabled={busy}>
              {busy ? 'Updating…' : 'Update snapshot'}
            </button>
            <button className="secondary small" onClick={() => stopSharing(uid, student)}>
              Stop sharing
            </button>
          </div>
        </>
      ) : (
        <button className="secondary" onClick={publish} disabled={busy}>
          {busy ? 'Creating link…' : 'Create guardian link'}
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
