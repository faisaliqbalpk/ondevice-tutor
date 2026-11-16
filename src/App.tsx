import { useEffect, useState } from 'react';
import { watchAccount, type Account as AccountT } from './lib/auth';
import { Account } from './components/Account';
import { Solve } from './components/Solve';
import { Learn } from './components/Learn';
import { Reading } from './components/Reading';
import { Review } from './components/Review';
import { chromeVersion, deviceStatus, prepareDeviceModel, type DeviceStatus } from './lib/ai';
import { addStudent, watchAlerts, watchStudents, type Alert, type Student } from './lib/mastery';
import { MarkSheet } from './components/MarkSheet';
import { Practice } from './components/Practice';
import { TutorChat } from './components/TutorChat';
import { Progress } from './components/Progress';
import { Ledger } from './components/Ledger';
import { Onboarding } from './components/Onboarding';
import { Assessments } from './components/Assessments';
import { Missions } from './components/Missions';
import { answerKeyText, type Assessment } from './lib/mastery';
import { errorText } from './lib/errors';

type Tab =
  | 'learn'
  | 'read'
  | 'solve'
  | 'tutor'
  | 'daily'
  | 'cards'
  | 'practice'
  | 'missions'
  | 'bank'
  | 'start'
  | 'assess'
  | 'mark'
  | 'progress'
  | 'privacy';

/** Tabs grouped the way a student thinks about them: learn something, practise it, check it, see progress. */
const GROUPS: { label: string; tabs: { id: Tab; label: string }[] }[] = [
  {
    label: 'Learn',
    tabs: [
      { id: 'learn', label: 'Guided path' },
      { id: 'read', label: 'Reading' },
      { id: 'solve', label: 'Solve' },
      { id: 'tutor', label: 'Voice tutor' },
    ],
  },
  {
    label: 'Practise',
    tabs: [
      { id: 'daily', label: 'Today' },
      { id: 'cards', label: 'Flash cards' },
      { id: 'practice', label: 'Quiz' },
      { id: 'missions', label: 'Missions' },
      { id: 'bank', label: 'Question bank' },
    ],
  },
  {
    label: 'Assess',
    tabs: [
      { id: 'start', label: 'Interview' },
      { id: 'assess', label: 'Assessments' },
      { id: 'mark', label: 'Mark sheet' },
    ],
  },
  {
    label: 'Progress',
    tabs: [
      { id: 'progress', label: 'Progress & guardian' },
      { id: 'privacy', label: 'Privacy ledger' },
    ],
  },
];

const groupOf = (t: Tab) => GROUPS.find((g) => g.tabs.some((x) => x.id === t)) ?? GROUPS[0];

const STATUS_TEXT: Record<DeviceStatus, string> = {
  available: 'Gemini Nano ready on this device',
  downloadable: 'Gemini Nano can be downloaded',
  downloading: 'Gemini Nano is downloading',
  unavailable: 'Gemini Nano not available on this device, using cloud',
  unsupported: 'On-device AI is off in this browser, using cloud',
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
  const [account, setAccount] = useState<AccountT | null>(null);
  const uid = account?.uid ?? null;
  const [authError, setAuthError] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('start');
  const [preset, setPreset] = useState<{ title: string; key: string } | null>(null);
  const [status, setStatus] = useState<DeviceStatus>('unsupported');
  const [progress, setProgress] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [toasts, setToasts] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [newGrade, setNewGrade] = useState('Grade 6');
  const online = useOnline();

  useEffect(() => {
    const off = watchAccount(
      (a) => {
        // A different account (signed in or out) has different students.
        setAccount(a);
        setStudents([]);
        setCurrent(null);
        if (a) setAuthError(null);
      },
      (e) => setAuthError(errorText(e)),
    );
    void deviceStatus().then(setStatus);
    return off;
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

  function toast(t: string) {
    setToasts((x) => [...x, t]);
    setTimeout(() => setToasts((x) => x.slice(1)), 6000);
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
          {(status === 'unsupported' || status === 'unavailable') && (
            <button className="secondary" onClick={() => setShowHelp((x) => !x)}>
              {showHelp ? 'Hide help' : 'Turn on on-device AI'}
            </button>
          )}
          {progress !== null && <span className="muted">Downloading {Math.round(progress * 100)}%</span>}
          <span className={`pill ${online ? '' : 'offline'}`}>{online ? 'Online' : 'Offline'}</span>
          <Account account={account} onToast={toast} />
        </div>
      </header>

      {showHelp && status !== 'available' && (
        <div className="panel help no-print">
          <h3>Turn on Gemini Nano in Chrome</h3>
          <ol>
            <li>
              Use desktop Chrome 139 or newer (Windows, macOS, Linux or ChromeOS).{' '}
              <span className="muted">
                {chromeVersion() ? `You have Chrome ${chromeVersion()}.` : 'This browser does not look like Chrome.'}
              </span>
            </li>
            <li>
              Open <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code> and set it to{' '}
              <strong>Enabled</strong>.
            </li>
            <li>
              Open <code>chrome://flags/#optimization-guide-on-device-model</code> and set it to{' '}
              <strong>Enabled BypassPerfRequirement</strong>.
            </li>
            <li>Click Relaunch, then come back to this page.</li>
            <li>
              Check <code>chrome://on-device-internals</code>: under Model Status it should say the model is ready or
              downloading. The model needs about 22 GB of free disk space.
            </li>
          </ol>
          <p className="muted">Chrome blocks links to chrome:// pages, so copy each address into the address bar.</p>
          <button
            onClick={async () => {
              const s = await deviceStatus();
              setStatus(s);
              if (s === 'available') setShowHelp(false);
            }}
          >
            Check again
          </button>
        </div>
      )}

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

      <nav className="no-print groups">
        {GROUPS.map((g) => (
          <button
            key={g.label}
            className={g === groupOf(tab) ? 'tab active' : 'tab'}
            onClick={() => g !== groupOf(tab) && setTab(g.tabs[0].id)}
          >
            {g.label}
          </button>
        ))}
      </nav>
      <div className="subtabs no-print">
        {groupOf(tab).tabs.map((t) => (
          <button key={t.id} className={t.id === tab ? 'chip active' : 'chip'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <main>
        {tab === 'privacy' ? (
          <Ledger />
        ) : !uid ? (
          <p className="muted">Connecting…</p>
        ) : !student ? (
          <p className="panel muted">Add a student to get started. Use a nickname, not a full name.</p>
        ) : tab === 'start' ? (
          <Onboarding key={student.id} uid={uid} student={student} onAlerts={onAlerts} onDone={() => setTab('learn')} />
        ) : tab === 'assess' ? (
          <Assessments key={student.id} uid={uid} student={student} onAlerts={onAlerts} onMarkPrinted={markPrinted} />
        ) : tab === 'mark' ? (
          <MarkSheet key={`${student.id}:${preset?.key ?? ''}`} uid={uid} student={student} onAlerts={onAlerts} preset={preset} />
        ) : tab === 'practice' ? (
          <Practice key={student.id} uid={uid} student={student} onAlerts={onAlerts} />
        ) : tab === 'missions' ? (
          <Missions key={student.id} uid={uid} student={student} onAlerts={onAlerts} />
        ) : tab === 'learn' ? (
          <Learn key={student.id} uid={uid} student={student} onAlerts={onAlerts} onToast={toast} />
        ) : tab === 'read' ? (
          <Reading key={student.id} uid={uid} student={student} onToast={toast} />
        ) : tab === 'solve' ? (
          <Solve key={student.id} uid={uid} student={student} onAlerts={onAlerts} onToast={toast} />
        ) : tab === 'daily' || tab === 'cards' || tab === 'bank' ? (
          <Review key={student.id} uid={uid} student={student} view={tab} onAlerts={onAlerts} onToast={toast} />
        ) : tab === 'tutor' ? (
          <TutorChat key={student.id} student={student} />
        ) : (
          <Progress uid={uid} student={student} alerts={alerts} />
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
