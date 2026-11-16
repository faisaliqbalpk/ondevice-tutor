import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { mastery, type Student } from './mastery';

/**
 * Guardian view: a read-only progress snapshot a parent or carer can open from a link.
 * It holds scores and streaks only: no answers, photos, notes, mistakes or tutor memory.
 * Anyone with the unguessable link can read it; only the owner can change or delete it.
 */
export interface GuardianSnapshot {
  owner: string;
  nickname: string;
  grade: string;
  skills: { name: string; pct: number; attempts: number }[];
  levels: Record<string, string>;
  dailyStreak: number;
  practiceDays7: number;
  questionsAnswered7: number;
  missionLevel: number;
  missionsCompleted: number;
  paths: { subject: string; passed: number; total: number; current: string }[];
  cardsDue: number;
  updatedAt: number;
}

const ref = (token: string) => doc(db, 'guardians', token);

function newToken(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function skillsForGuardian(student: Student) {
  return Object.entries(student.skills)
    .map(([name, s]) => ({ name, pct: Math.round(mastery(s) * 100), attempts: s.total }))
    .sort((a, b) => a.pct - b.pct);
}

/** Publishes (or refreshes) the snapshot and returns the share token. */
export async function publishGuardian(
  uid: string,
  student: Student,
  data: Omit<GuardianSnapshot, 'owner' | 'updatedAt' | 'nickname' | 'grade' | 'skills' | 'levels'>,
): Promise<string> {
  const snapshot: GuardianSnapshot = {
    ...data,
    owner: uid,
    nickname: student.nickname,
    grade: student.grade,
    skills: skillsForGuardian(student),
    levels: student.levels ?? {},
    updatedAt: Date.now(),
  };
  let token = student.guardianToken ?? newToken();
  try {
    await setDoc(ref(token), snapshot);
  } catch {
    // The old link belongs to another account (e.g. a guest merged into Google): start a new one.
    token = newToken();
    await setDoc(ref(token), snapshot);
  }
  if (token !== student.guardianToken) await updateDoc(doc(db, 'users', uid, 'students', student.id), { guardianToken: token });
  return token;
}

export async function stopSharing(uid: string, student: Student) {
  if (student.guardianToken) await deleteDoc(ref(student.guardianToken)).catch(() => {});
  await updateDoc(doc(db, 'users', uid, 'students', student.id), { guardianToken: '' });
}

export async function loadGuardian(token: string): Promise<GuardianSnapshot | null> {
  const snap = await getDoc(ref(token));
  return snap.exists() ? (snap.data() as GuardianSnapshot) : null;
}

export const guardianUrl = (token: string) => `${location.origin}${location.pathname}?guardian=${token}`;
