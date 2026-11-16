import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DIFFICULTIES,
  RANKS,
  STARTER_MISSIONS,
  createMission,
  debriefMission,
  missionStats,
  personaReply,
  saveMissionRecord,
  watchMissionLog,
  xpFor,
  LEVEL_XP,
  type Debrief,
  type Difficulty,
  type Mission,
  type MissionMode,
  type MissionRecord,
  type MissionTurn,
} from '../lib/missions';
import { recordResults, weakestSkills, type Student } from '../lib/mastery';
import { listen, speak, speechSupported, stopSpeaking } from '../lib/speech';
import { sfx } from '../lib/sfx';
import type { Source } from '../lib/ai';
import { SUBJECTS } from '../lib/subjects';
import { errorText } from '../lib/errors';
import { ErrorNote, SourceBadge } from './common';
import { MicLevel, PersonaStage, type StageState } from './AudioViz';

interface Props {
  uid: string;
  student: Student;
  onAlerts: (a: string[]) => void;
}

interface Line extends MissionTurn {
  tip?: string;
  source?: Source;
}

const MAX_TURNS = 12;
const CUSTOM_KEY = 'tutor.customMissions.v1';

function loadCustom(): Mission[] {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]') as Mission[];
  } catch {
    return [];
  }
}

function saveCustom(list: Mission[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* storage unavailable */
  }
}

export function Missions({ uid, student, onAlerts }: Props) {
  const [records, setRecords] = useState<MissionRecord[]>([]);
  const [custom, setCustom] = useState<Mission[]>(loadCustom);
  const [subject, setSubject] = useState<string>('All');
  const [mode, setMode] = useState<MissionMode>('coach');
  const [mission, setMission] = useState<Mission | null>(null);
  const [phase, setPhase] = useState<'pick' | 'brief' | 'play' | 'debrief'>('pick');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDiff, setNewDiff] = useState<Difficulty>('Medium');

  useEffect(() => watchMissionLog(uid, setRecords), [uid]);
  const stats = useMemo(() => missionStats(records, student.id), [records, student.id]);

  const all = [...custom, ...STARTER_MISSIONS];
  const subjects = ['All', ...SUBJECTS.filter((s) => all.some((m) => m.subject === s))];
  const shown = all.filter((m) => subject === 'All' || m.subject === subject);
  const weak = weakestSkills(student, 1)[0];

  async function makeCustom() {
    setBusy(true);
    setError(null);
    try {
      const subj = subject !== 'All' ? subject : (student.subjects?.[0] ?? 'Math');
      const skill = weak ?? (subj === 'Math' ? 'fractions' : `${subj.toLowerCase()} basics`);
      const r = await createMission(subj, skill, student.grade, newDiff);
      const next = [r.data, ...custom];
      setCustom(next);
      saveCustom(next);
      setMission(r.data);
      setPhase('brief');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (mission && phase !== 'pick') {
    return (
      <MissionRun
        key={`${mission.id}:${mode}`}
        uid={uid}
        student={student}
        mission={mission}
        mode={mode}
        setMode={setMode}
        phase={phase}
        setPhase={setPhase}
        best={stats.best[mission.id]}
        onAlerts={onAlerts}
        onExit={() => {
          stopSpeaking();
          setPhase('pick');
          setMission(null);
        }}
      />
    );
  }

  return (
    <section className="panel missions">
      <div className="row spread wrap">
        <div>
          <h2>Missions</h2>
          <p className="muted">
            Talk your way through real-life situations. Each character is played by Gemini Nano on this device, and
            your voice is turned into text in the browser.
          </p>
        </div>
        <div className="xp" title={`${stats.xp} XP in total`}>
          <span className="xp-level">Level {stats.level}</span>
          <div className="bar">
            <div className="fill high" style={{ width: `${(stats.intoLevel / LEVEL_XP) * 100}%` }} />
          </div>
          <span className="muted small">
            {stats.intoLevel}/{LEVEL_XP} XP{stats.streak > 0 ? ` · 🔥 ${stats.streak}-day streak` : ''}
          </span>
        </div>
      </div>

      <ModePicker mode={mode} setMode={setMode} />

      <div className="row wrap">
        {subjects.map((s) => (
          <button key={s} className={s === subject ? 'chip active' : 'chip'} onClick={() => setSubject(s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="mission-card make">
        <div>
          <strong>✨ Make a mission for my weak spot</strong>
          <p className="muted small">
            {weak
              ? `Nano writes a new scenario that practises "${weak}".`
              : 'Nano writes a new scenario for this subject. Mark some work first to target a weak skill.'}
          </p>
        </div>
        <div className="row">
          <select value={newDiff} onChange={(e) => setNewDiff(e.target.value as Difficulty)} aria-label="Difficulty">
            {DIFFICULTIES.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <button onClick={makeCustom} disabled={busy}>
            {busy ? 'Writing…' : 'Create'}
          </button>
        </div>
      </div>
      <ErrorNote error={error} />

      {DIFFICULTIES.map((d) => {
        const list = shown.filter((m) => m.difficulty === d);
        if (!list.length) return null;
        return (
          <div key={d}>
            <h3 className={`diff ${d.toLowerCase()}`}>{d}</h3>
            <div className="mission-grid">
              {list.map((m) => (
                <button
                  key={m.id}
                  className="mission-card"
                  onClick={() => {
                    setMission(m);
                    setPhase('brief');
                  }}
                >
                  <span className="mission-emoji">{m.emoji}</span>
                  <span className="mission-body">
                    <strong>{m.title}</strong>
                    <span className="muted small">
                      {m.subject} · {m.skill}
                      {m.custom ? ' · made for you' : ''}
                    </span>
                  </span>
                  {stats.best[m.id] !== undefined && (
                    <span className="mission-best" title="Best result">
                      {stats.best[m.id] >= 1 ? RANKS[stats.best[m.id]].stars : '✓'}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function ModePicker({ mode, setMode }: { mode: MissionMode; setMode: (m: MissionMode) => void }) {
  return (
    <div className="modes" role="radiogroup" aria-label="Mode">
      <button role="radio" aria-checked={mode === 'coach'} className={mode === 'coach' ? 'mode active' : 'mode'} onClick={() => setMode('coach')}>
        <strong>🧑‍🏫 Coach mode</strong>
        <span className="small">Hints, gentle corrections and quick checks as you go.</span>
      </button>
      <button
        role="radio"
        aria-checked={mode === 'challenge'}
        className={mode === 'challenge' ? 'mode active' : 'mode'}
        onClick={() => setMode('challenge')}
      >
        <strong>🎯 Challenge mode</strong>
        <span className="small">No free answers. Work it out yourself and earn a rank.</span>
      </button>
    </div>
  );
}

interface RunProps {
  uid: string;
  student: Student;
  mission: Mission;
  mode: MissionMode;
  setMode: (m: MissionMode) => void;
  phase: 'brief' | 'play' | 'debrief' | 'pick';
  setPhase: (p: 'pick' | 'brief' | 'play' | 'debrief') => void;
  best?: number;
  onAlerts: (a: string[]) => void;
  onExit: () => void;
}

function MissionRun({ uid, student, mission, mode, setMode, phase, setPhase, best, onAlerts, onExit }: RunProps) {
  const [lines, setLines] = useState<Line[]>([]);
  const [stage, setStage] = useState<StageState>('idle');
  const [draft, setDraft] = useState('');
  const [voice, setVoice] = useState(true);
  const [handsFree, setHandsFree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ completed: boolean; debrief: Debrief | null; source?: Source; xp: number } | null>(null);
  const linesRef = useRef<Line[]>([]);
  const stopListen = useRef<() => void>(() => {});
  const handsFreeRef = useRef(handsFree);
  const voiceRef = useRef(voice);

  const live = useRef(true);
  const speechToken = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    handsFreeRef.current = handsFree;
    voiceRef.current = voice;
  }, [handsFree, voice]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      stopListen.current();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [lines, stage]);

  function push(l: Line) {
    linesRef.current = [...linesRef.current, l];
    setLines(linesRef.current);
  }

  /**
   * Speaks a persona line. `then` runs when the line ends; with `always`, it also runs if
   * the student interrupts. If the browser never starts speaking (no voices installed),
   * it carries on after a short wait so the mission never gets stuck.
   */
  function say(text: string, then?: () => void, always = false) {
    const token = ++speechToken.current;
    setStage('idle');
    if (!voiceRef.current) {
      then?.();
      return;
    }
    let started = false;
    let ended = false;
    const end = (interrupted: boolean) => {
      if (ended || !live.current) return;
      ended = true;
      setStage((s) => (s === 'speaking' ? 'idle' : s));
      if (!interrupted || always) then?.();
    };
    speak(text, {
      voiceSeed: mission.persona,
      onStart: () => {
        started = true;
        if (live.current && token === speechToken.current) setStage('speaking');
      },
      onEnd: () => end(token !== speechToken.current),
    });
    setTimeout(() => {
      if (!started) end(token !== speechToken.current);
    }, 3000);
  }

  function begin() {
    sfx.start();
    setPhase('play');
    const opening: Line = { role: 'persona', text: mission.opening };
    linesRef.current = [opening];
    setLines([opening]);
    setTimeout(() => say(mission.opening, autoListen), 500);
  }

  function autoListen() {
    if (handsFreeRef.current && live.current && speechSupported()) talk();
  }

  function talk() {
    if (stage === 'listening') {
      stopListen.current();
      return;
    }
    speechToken.current += 1;
    stopSpeaking();
    sfx.listen();
    setStage('listening');
    stopListen.current = listen(
      (t) => void send(t),
      (err) => {
        setStage((s) => (s === 'listening' ? 'idle' : s));
        if (err && err !== 'no-speech' && err !== 'aborted') setError(`Microphone: ${err}`);
      },
    );
  }

  async function send(text: string) {
    if (!text.trim()) return;
    setDraft('');
    setError(null);
    push({ role: 'student', text: text.trim() });
    setStage('thinking');
    try {
      const r = await personaReply(mission, mode, student.grade, linesRef.current);
      if (!live.current) return;
      const tip = mode === 'coach' ? r.data.coachTip.trim() : '';
      push({ role: 'persona', text: r.data.reply.trim(), tip: tip || undefined, source: r.source });
      const studentTurns = linesRef.current.filter((l) => l.role === 'student').length;
      if (r.data.objectiveMet) {
        say(r.data.reply, () => void finish(true), true);
      } else if (studentTurns >= MAX_TURNS) {
        say(r.data.reply, () => void finish(false), true);
      } else {
        say(r.data.reply, autoListen);
      }
    } catch (e) {
      setStage('idle');
      setError(errorText(e));
    }
  }

  async function finish(completed: boolean) {
    speechToken.current += 1;
    stopListen.current();
    stopSpeaking();
    setPhase('debrief');
    setStage('thinking');
    if (completed) sfx.win();
    else sfx.end();
    const studentTurns = linesRef.current.filter((l) => l.role === 'student').length;
    let debrief: Debrief | null = null;
    let source: Source | undefined;
    if (studentTurns > 0) {
      try {
        const r = await debriefMission(mission, mode, student.grade, linesRef.current);
        debrief = { ...r.data, score: Math.min(3, Math.max(1, Math.round(r.data.score))) };
        source = r.source;
      } catch (e) {
        setError(errorText(e));
      }
    }
    if (!live.current) return;
    const score = completed && mode === 'challenge' && debrief ? debrief.score : 0;
    const xp = studentTurns > 0 ? xpFor(mission.difficulty, mode, completed, score) : 0;
    setResult({ completed, debrief, source, xp });
    setStage('idle');
    if (studentTurns === 0) return;
    saveMissionRecord(uid, {
      studentId: student.id,
      missionId: mission.id,
      title: mission.title,
      emoji: mission.emoji,
      subject: mission.subject,
      skill: mission.skill,
      difficulty: mission.difficulty,
      mode,
      completed,
      score,
      xp,
    });
    const ok = completed && (mode === 'coach' || score >= 2);
    const raised = await recordResults(uid, student, [
      {
        skill: mission.skill,
        isCorrect: ok,
        mistake: ok ? undefined : `${mission.skill}: needed help in the "${mission.title}" mission`,
      },
    ]);
    onAlerts(raised);
  }

  if (phase === 'brief') {
    return (
      <section className="panel mission-brief">
        <button className="secondary small" onClick={onExit}>
          ← All missions
        </button>
        <div className="brief-hero">
          <span className="brief-emoji">{mission.emoji}</span>
          <div>
            <span className={`diff-pill ${mission.difficulty.toLowerCase()}`}>{mission.difficulty}</span>
            <h2>{mission.title}</h2>
            <p className="muted">
              You'll talk to: <strong>{mission.persona}</strong>
            </p>
          </div>
        </div>
        <div className="objective">
          <span className="small muted">YOUR MISSION</span>
          <p>{mission.objective}</p>
        </div>
        <ModePicker mode={mode} setMode={setMode} />
        {best !== undefined && (
          <p className="muted small">Your best: {best >= 1 ? `${RANKS[best].stars} ${RANKS[best].name}` : 'completed in coach mode'}</p>
        )}
        <div className="row">
          <button className="big" onClick={begin}>
            Start mission
          </button>
          {!speechSupported() && <span className="muted small">Voice input isn't supported in this browser, so you'll type.</span>}
        </div>
      </section>
    );
  }

  const studentTurns = lines.filter((l) => l.role === 'student').length;

  return (
    <section className="panel mission-play">
      <div className="row spread wrap">
        <div className="row">
          <span className={`diff-pill ${mission.difficulty.toLowerCase()}`}>{mission.difficulty}</span>
          <strong>{mission.title}</strong>
          <span className="pill">{mode === 'coach' ? '🧑‍🏫 Coach' : '🎯 Challenge'}</span>
        </div>
        {phase === 'play' && (
          <button className="secondary small" onClick={() => void finish(false)}>
            End mission
          </button>
        )}
      </div>

      <div className="objective compact">
        <span className="small muted">MISSION</span> {mission.objective}
      </div>

      <PersonaStage emoji={mission.emoji} name={mission.persona} state={stage} />

      <div className="messages transcript" aria-live="polite">
        {lines.map((l, i) => (
          <div key={i} className="turn">
            <div className={`bubble ${l.role === 'student' ? 'student' : 'tutor'}`}>
              {l.role === 'persona' && <span className="speaker">{mission.emoji}</span>}
              <p>{l.text}</p>
              {l.source && <SourceBadge source={l.source} />}
            </div>
            {l.tip && (
              <div className="coach-tip">
                <span>🧑‍🏫 Coach:</span> {l.tip}
              </div>
            )}
          </div>
        ))}
        {stage === 'thinking' && phase === 'play' && <div className="bubble tutor muted typing">…</div>}
        <div ref={bottom} />
      </div>
      <ErrorNote error={error} />

      {phase === 'play' && (
        <>
          <div className="row spread wrap">
            <span className="muted small">
              Turn {studentTurns} of {MAX_TURNS}
            </span>
            <div className="row">
              <label className="toggle">
                <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Voices
              </label>
              {speechSupported() && (
                <label className="toggle" title="The mic opens automatically after the character speaks">
                  <input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} /> Hands-free
                </label>
              )}
            </div>
          </div>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            {speechSupported() && (
              <button
                type="button"
                className={stage === 'listening' ? 'mic on' : 'mic'}
                onClick={talk}
                disabled={stage === 'thinking'}
              >
                {stage === 'listening' ? 'Listening… tap to stop' : '🎙 Tap to talk'}
              </button>
            )}
            <MicLevel active={stage === 'listening'} />
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Or type your reply" />
            <button type="submit" disabled={stage === 'thinking' || !draft.trim()}>
              Send
            </button>
          </form>
        </>
      )}

      {phase === 'debrief' && (
        <Summary
          mission={mission}
          mode={mode}
          result={result}
          onRetry={() => {
            setResult(null);
            setLines([]);
            linesRef.current = [];
            setPhase('brief');
          }}
          onExit={onExit}
        />
      )}
    </section>
  );
}

function Summary({
  mission,
  mode,
  result,
  onRetry,
  onExit,
}: {
  mission: Mission;
  mode: MissionMode;
  result: { completed: boolean; debrief: Debrief | null; source?: Source; xp: number } | null;
  onRetry: () => void;
  onExit: () => void;
}) {
  if (!result) return <div className="summary muted">Reviewing your mission…</div>;
  const { completed, debrief, source, xp } = result;
  const rank = completed && mode === 'challenge' && debrief ? RANKS[debrief.score] : null;
  return (
    <div className={`summary ${completed ? 'won' : ''}`}>
      {completed && <Confetti />}
      <h2>{completed ? 'Mission complete!' : 'Mission ended'}</h2>
      {rank ? (
        <div className="rank">
          <span className="stars">{rank.stars}</span>
          <span>{rank.name}</span>
        </div>
      ) : completed ? (
        <p className="muted">Practice complete. Try Challenge mode to earn a rank.</p>
      ) : (
        <p className="muted">You didn't reach the objective this time, so there's no rank. Have another go!</p>
      )}
      {xp > 0 && <p className="xp-gain">+{xp} XP</p>}
      {debrief && (
        <div className="takeaways">
          <p>{debrief.summary}</p>
          <ol>
            {debrief.takeaways.slice(0, 3).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
          {source && <SourceBadge source={source} />}
        </div>
      )}
      {xp > 0 && <p className="muted small">Your "{mission.skill}" result was added to the skill profile.</p>}
      <div className="row center">
        <button onClick={onRetry}>Try again</button>
        <button className="secondary" onClick={onExit}>
          More missions
        </button>
      </div>
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        left: `${(i * 37) % 100}%`,
        delay: `${(i % 10) * 0.08}s`,
        hue: (i * 47) % 360,
        rot: (i * 53) % 360,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{ left: p.left, animationDelay: p.delay, background: `hsl(${p.hue} 80% 60%)`, rotate: `${p.rot}deg` }}
        />
      ))}
    </div>
  );
}
