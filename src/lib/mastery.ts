import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  limit,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { MarkResult } from './tutor';

export interface SkillStat {
  correct: number;
  total: number;
  /** Last 10 results, newest last. */
  recent: boolean[];
}

export interface Student {
  id: string;
  nickname: string;
  grade: string;
  skills: Record<string, SkillStat>;
  mistakes: string[];
  /** Set by the onboarding interview. */
  onboarded?: boolean;
  subjects?: string[];
  /** Placement level per subject, e.g. "needs support", "on track", "ahead". */
  levels?: Record<string, string>;
  /** Cloud-written study plan (from an anonymous summary). */
  plan?: string;
}

export interface Assessment {
  id: string;
  title: string;
  subject: string;
  grade: string;
  questions: import('./tutor').AssessmentQuestion[];
  createdAt?: { seconds: number };
}

export interface Alert {
  id: string;
  studentId: string;
  nickname: string;
  message: string;
  at?: { seconds: number };
}

const students = (uid: string) => collection(db, 'users', uid, 'students');
const alerts = (uid: string) => collection(db, 'users', uid, 'alerts');
const assessments = (uid: string) => collection(db, 'users', uid, 'assessments');

export function updateStudent(uid: string, id: string, fields: Partial<Omit<Student, 'id'>>) {
  void updateDoc(doc(students(uid), id), fields);
}

export function watchAssessments(uid: string, cb: (a: Assessment[]) => void): Unsubscribe {
  return onSnapshot(
    query(assessments(uid), orderBy('createdAt', 'desc'), limit(30)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Assessment, 'id'>) }))),
    logError('assessments'),
  );
}

export function saveAssessment(uid: string, a: Omit<Assessment, 'id' | 'createdAt'>): string {
  const ref = doc(assessments(uid));
  void setDoc(ref, { ...a, createdAt: serverTimestamp() });
  return ref.id;
}

/** Answer key text in the format the sheet marker expects. */
export function answerKeyText(a: Pick<Assessment, 'questions'>): string {
  return a.questions
    .map((q, i) => {
      const j = q.choices.indexOf(q.answer);
      return `${i + 1}. ${q.type === 'mcq' && j >= 0 ? `${'ABCD'[j]}) ` : ''}${q.answer}`;
    })
    .join('\n');
}

const logError = (what: string) => (e: Error) => console.error(`Firestore ${what}:`, e.message);

export function watchStudents(uid: string, cb: (s: Student[]) => void): Unsubscribe {
  return onSnapshot(
    students(uid),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Student, 'id'>) }))),
    logError('students'),
  );
}

export function watchAlerts(uid: string, cb: (a: Alert[]) => void): Unsubscribe {
  return onSnapshot(
    query(alerts(uid), orderBy('at', 'desc'), limit(20)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Alert, 'id'>) }))),
    logError('alerts'),
  );
}

export async function addStudent(uid: string, nickname: string, grade: string): Promise<string> {
  const ref = doc(students(uid));
  // Writes resolve immediately offline; Firestore syncs when back online.
  void setDoc(ref, { nickname, grade, skills: {}, mistakes: [], onboarded: false });
  return ref.id;
}

/** Mastery = share correct in the last 10 attempts (0-1). */
export function mastery(s: SkillStat): number {
  const r = s.recent.length ? s.recent : [];
  return r.length ? r.filter(Boolean).length / r.length : 0;
}

export function weakestSkills(student: Student, n = 2): string[] {
  return Object.entries(student.skills)
    .sort(([, a], [, b]) => mastery(a) - mastery(b))
    .slice(0, n)
    .map(([k]) => k);
}

export function masterySummary(student: Student): string {
  const entries = Object.entries(student.skills);
  const levels = Object.entries(student.levels ?? {});
  const header =
    `${student.grade} student.` +
    (levels.length ? ` Placement: ${levels.map(([s, l]) => `${s} ${l}`).join(', ')}.` : '') +
    '\n';
  if (!entries.length) return `${header}No marked work yet.`;
  return (
    header +
    entries
      .map(([k, s]) => `- ${k}: ${Math.round(mastery(s) * 100)}% recent mastery (${s.total} attempts)`)
      .join('\n') +
    (student.mistakes.length ? `\nRecent mistakes:\n- ${student.mistakes.slice(-5).join('\n- ')}` : '')
  );
}

/** Applies marked results (from a sheet or a quiz) to the profile and raises alerts. */
export async function recordResults(
  uid: string,
  student: Student,
  results: { skill: string; isCorrect: boolean; mistake?: string }[],
): Promise<string[]> {
  const skills: Record<string, SkillStat> = structuredClone(student.skills);
  const before: Record<string, number> = Object.fromEntries(
    Object.entries(skills).map(([k, s]) => [k, mastery(s)]),
  );
  const mistakes = [...student.mistakes];

  for (const r of results) {
    const key = r.skill.trim().toLowerCase();
    const s = (skills[key] ??= { correct: 0, total: 0, recent: [] });
    s.total += 1;
    if (r.isCorrect) s.correct += 1;
    s.recent = [...s.recent, r.isCorrect].slice(-10);
    if (!r.isCorrect && r.mistake) mistakes.push(r.mistake);
  }

  const raised: string[] = [];
  for (const [k, s] of Object.entries(skills)) {
    const now = mastery(s);
    const was = before[k];
    if (s.recent.length >= 3 && now < 0.5 && (was === undefined || was >= 0.5)) {
      raised.push(`${student.nickname} is struggling with ${k} (${Math.round(now * 100)}% recently).`);
    } else if (was !== undefined && was - now >= 0.3) {
      raised.push(`${student.nickname} dropped in ${k}: ${Math.round(was * 100)}% to ${Math.round(now * 100)}%.`);
    } else if (was !== undefined && was < 0.5 && now >= 0.8) {
      raised.push(`${student.nickname} has mastered ${k} (${Math.round(now * 100)}%).`);
    }
  }

  void updateDoc(doc(students(uid), student.id), { skills, mistakes: mistakes.slice(-20) });
  for (const message of raised) {
    void addDoc(alerts(uid), { studentId: student.id, nickname: student.nickname, message, at: serverTimestamp() });
  }
  return raised;
}

export function resultsFromSheet(m: MarkResult) {
  return m.questions.map((q) => ({
    skill: q.skill,
    isCorrect: q.isCorrect,
    mistake: q.isCorrect ? undefined : `${q.skill}: answered "${q.studentAnswer}", expected "${q.correctAnswer}"`,
  }));
}
