import { useEffect, useState } from 'react';
import { loadGuardian, type GuardianSnapshot } from '../lib/guardian';
import { errorText } from '../lib/errors';

/** The read-only page a parent or carer opens from a guardian link. No sign-in needed. */
export default function GuardianView({ token }: { token: string }) {
  const [snap, setSnap] = useState<GuardianSnapshot | null | 'missing'>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadGuardian(token)
      .then((s) => setSnap(s ?? 'missing'))
      .catch((e) => setError(errorText(e)));
  }, [token]);

  return (
    <div className="app">
      <header>
        <div>
          <h1>Nano Tutor · Guardian view</h1>
          <p className="muted">A read-only progress summary shared with you.</p>
        </div>
      </header>
      {error && <p className="error">Could not load this summary: {error}</p>}
      {snap === null && !error && <p className="muted">Loading…</p>}
      {snap === 'missing' && (
        <p className="panel">This link is no longer shared. Ask the student to create a new guardian link.</p>
      )}
      {snap && snap !== 'missing' && (
        <section className="panel">
          <h2>
            {snap.nickname} <span className="muted">· {snap.grade}</span>
          </h2>
          <p className="muted small">Last updated {new Date(snap.updatedAt).toLocaleString()}</p>
          <div className="stats">
            <div>
              <strong>{snap.dailyStreak > 0 ? `🔥 ${snap.dailyStreak}` : '0'}</strong>
              <span className="small muted">day streak</span>
            </div>
            <div>
              <strong>{snap.practiceDays7}/7</strong>
              <span className="small muted">days practised this week</span>
            </div>
            <div>
              <strong>{snap.questionsAnswered7}</strong>
              <span className="small muted">questions this week</span>
            </div>
            <div>
              <strong>{snap.missionLevel}</strong>
              <span className="small muted">mission level ({snap.missionsCompleted} done)</span>
            </div>
          </div>
          {Object.keys(snap.levels).length > 0 && (
            <>
              <h3>Placement</h3>
              <div className="row wrap">
                {Object.entries(snap.levels).map(([s, l]) => (
                  <span key={s} className={`level ${l.replace(/\s+/g, '-')}`}>
                    {s}: {l}
                  </span>
                ))}
              </div>
            </>
          )}
          {snap.paths.length > 0 && (
            <>
              <h3>Learning paths</h3>
              <ul className="skills">
                {snap.paths.map((p, i) => (
                  <li key={i}>
                    <div className="row spread">
                      <span>{p.subject}</span>
                      <span className="muted">
                        {p.passed}/{p.total} · now: {p.current}
                      </span>
                    </div>
                    <div className="bar">
                      <div className="fill high" style={{ width: `${(p.passed / Math.max(1, p.total)) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>Skills</h3>
          {snap.skills.length === 0 ? (
            <p className="muted">No marked work yet.</p>
          ) : (
            <ul className="skills">
              {snap.skills.map((s) => (
                <li key={s.name}>
                  <div className="row spread">
                    <span>{s.name}</span>
                    <span className="muted">
                      {s.pct}% recent · {s.attempts} attempts
                    </span>
                  </div>
                  <div className="bar">
                    <div className={s.pct < 50 ? 'fill low' : s.pct < 80 ? 'fill mid' : 'fill high'} style={{ width: `${s.pct}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            Privacy: this page shows scores only. The student's answers, photos, notes and the tutor's private notes
            stay with the student.
          </p>
        </section>
      )}
    </div>
  );
}
