import { mastery, type Alert, type Student } from '../lib/mastery';

export function Progress({ student, alerts }: { student: Student; alerts: Alert[] }) {
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
