import { useEffect, useState } from 'react';
import { waitForUser } from './lib/firebase';
import { deviceStatus, prepareDeviceModel, type DeviceStatus } from './lib/ai';
import { addStudent, watchAlerts, watchStudents, type Alert, type Student } from './lib/mastery';
import { MarkSheet } from './components/MarkSheet';
import { Practice } from './components/Practice';
import { TutorChat } from './components/TutorChat';
import { Progress } from './components/Progress';
import { Ledger } from './components/Ledger';
import { Onboarding } from './components/Onboarding';
import { Assessments } from './components/Assessments';
import { answerKeyText, type Assessment } from './lib/mastery';
import { errorText } from './lib/errors';

type Tab = 'start' | 'assess' | 'mark' | 'practice' | 'tutor' | 'progress' | 'privacy';
const TABS: { id: Tab; label: string }[] = [
  { id: 'start', label: 'Interview' },
  { id: 'assess', label: 'Assessments' },
  { id: 'mark', label: 'Mark sheet' },
  { id: 'practice', label: 'Practice' },
  { id: 'tutor', label: 'Tutor' },
  { id: 'progress', label: 'Progress' },
  { id: 'privacy', label: 'Privacy' },
];

const STATUS_TEXT: Record<DeviceStatus, string> = {
  available: 'Gemini Nano ready on this device',
  downloadable: 'Gemini Nano can be downloaded',
  downloading: 'Gemini Nano is downloading',
  unavailable: 'Gemini Nano unavailable, using cloud',
  unsupported: 'This browser has no on-device model, using cloud',
};

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export default function App() {
  const [uid, setUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('start');
  const [preset, setPreset] = useState<{ title: string; key: string } | null>(null);
  const [status, setStatus] = useState<DeviceStatus>('unsupported');
  const [progress, setProgress] = useState<number | null>(null);
  const [toasts, setToasts] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [newGrade, setNewGrade] = useState('Grade 6');
  const online = useOnline();

  useEffect(() => {
    waitForUser()
      .then((u) => setUid(u.uid))
      .catch((e) => setAuthError(errorText(e)));
    void deviceStatus().then(setStatus);
  }, []);

  useEffect(() => {
    if (!uid) return;
    const a = watchStudents(uid, (s) => {
      setStudents(s);
      setCurrent((c) => c ?? s[0]?.id ?? null);
    });
    const b = watchAlerts(uid, setAlerts);
    return () => {
      a();
      b();
    };
  }, [uid]);

  async function prepare() {
    setProgress(0);
    try {
      await prepareDeviceModel((p) => setProgress(p));
    } catch (e) {
      setToasts((t) => [...t, `Could not prepare Gemini Nano: ${errorText(e)}`]);
    }
    setProgress(null);
    setStatus(await deviceStatus());
  }

  function onAlerts(a: string[]) {
    if (!a.length) return;
    setToasts((t) => [...t, ...a]);
    setTimeout(() => setToasts((t) => t.slice(a.length)), 6000);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!uid || !newName.trim()) return;
    const id = await addStudent(uid, newName.trim(), newGrade);
    setCurrent(id);
    setTab('start');
    setNewName('');
  }

  const student = students.find((s) => s.id === current) ?? null;

  function pickStudent(id: string) {
    setCurrent(id);
    const s = students.find((x) => x.id === id);
    if (s && !s.onboarded) setTab('start');
  }

  function markPrinted(a: Assessment) {
    setPreset({ title: a.title, key: answerKeyText(a) });
    setTab('mark');
  }

  return (
    <div className="app">
      <header className="no-print">
        <div>
          <h1>Nano Tutor</h1>
          <p className="muted">A private tutor that marks, remembers and teaches on your device.</p>
        </div>
        <div className="status">
          <span className={`dot ${status === 'available' ? 'green' : 'amber'}`} />
          <span>{STATUS_TEXT[status]}</span>
          {(status === 'downloadable' || status === 'downloading') && progress === null && (
            <button className="secondary" onClick={prepare}>
              Prepare on-device AI
            </button>
          )}
          {progress !== null && <span className="muted">{Math.round(progress * 100)}%</span>}
          <span className={`pill ${online ? '' : 'offline'}`}>{online ? 'Online' : 'Offline'}</span>
        </div>
      </header>

      {authError && <p className="error">Sign-in failed: {authError}. Check your Firebase config.</p>}

      <div className="students no-print">
        {students.map((s) => (
          <button key={s.id} className={s.id === current ? 'chip active' : 'chip'} onClick={() => pickStudent(s.id)}>
            {s.nickname} <span className="muted">{s.grade}</span>
          </button>
        ))}
        <form onSubmit={create} className="row add">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Student nickname" />
          <select value={newGrade} onChange={(e) => setNewGrade(e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`).map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          <button type="submit" disabled={!uid || !newName.trim()}>
            Add student
          </button>
        </form>
      </div>

      <nav className="no-print">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'privacy' ? (
          <Ledger />
        ) : !uid ? (
          <p className="muted">Connecting…</p>
        ) : !student ? (
          <p className="panel muted">Add a student to get started. Use a nickname, not a full name.</p>
        ) : tab === 'start' ? (
          <Onboarding key={student.id} uid={uid} student={student} onAlerts={onAlerts} onDone={() => setTab('assess')} />
        ) : tab === 'assess' ? (
          <Assessments key={student.id} uid={uid} student={student} onAlerts={onAlerts} onMarkPrinted={markPrinted} />
        ) : tab === 'mark' ? (
          <MarkSheet key={`${student.id}:${preset?.key ?? ''}`} uid={uid} student={student} onAlerts={onAlerts} preset={preset} />
        ) : tab === 'practice' ? (
          <Practice key={student.id} uid={uid} student={student} onAlerts={onAlerts} />
        ) : tab === 'tutor' ? (
          <TutorChat key={student.id} student={student} />
        ) : (
          <Progress student={student} alerts={alerts} />
        )}
      </main>

      <div className="toasts">
        {toasts.map((t, i) => (
          <div key={i} className="toast">
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}
