import { useEffect, useMemo, useState } from 'react';
import { mastery, type Alert, type Student } from '../lib/mastery';
import { RANKS, missionStats, watchMissionLog, type MissionRecord } from '../lib/missions';

export function Progress({ uid, student, alerts }: { uid: string; student: Student; alerts: Alert[] }) {
  const [records, setRecords] = useState<MissionRecord[]>([]);
  useEffect(() => watchMissionLog(uid, setRecords), [uid]);
  const stats = useMemo(() => missionStats(records, student.id), [records, student.id]);
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
    </section>
  );
}
