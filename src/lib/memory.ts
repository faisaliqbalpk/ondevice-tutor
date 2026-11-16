import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { masterySummary, type Student } from './mastery';
import { updateMemory } from './studyAi';

/** Rewrite the memory note after this many new activities. */
const REFRESH_EVERY = 3;

const studentRef = (uid: string, id: string) => doc(db, 'users', uid, 'students', id);

/**
 * Logs what the student just did (e.g. "Solved: area of a triangle", "Lesson check 2/5 on fractions")
 * and, every few activities, has Nano rewrite the short memory note that personalises later prompts.
 */
export async function noteActivity(uid: string, student: Student, line: string): Promise<void> {
  const activity = [...(student.activity ?? []), `${new Date().toLocaleDateString()}: ${line}`].slice(-12);
  const since = (student.sinceMemory ?? 0) + 1;
  void updateDoc(studentRef(uid, student.id), { activity, sinceMemory: since });
  if (since >= REFRESH_EVERY) await refreshMemory(uid, { ...student, activity });
}

export async function refreshMemory(uid: string, student: Student): Promise<string> {
  const r = await updateMemory({
    previous: student.memory ?? '',
    profile: masterySummary(student),
    recent: student.activity ?? [],
  });
  const memory = r.data.memory.trim();
  void updateDoc(studentRef(uid, student.id), { memory, memoryAt: Date.now(), sinceMemory: 0 });
  return memory;
}

export function clearMemory(uid: string, student: Student) {
  void updateDoc(studentRef(uid, student.id), { memory: '', activity: [], sinceMemory: 0, memoryAt: Date.now() });
}

/** Fire-and-forget wrapper: memory updates must never break the feature that triggered them. */
export function noteActivitySoon(uid: string, student: Student, line: string) {
  noteActivity(uid, student, line).catch((e) => console.warn('Memory update skipped:', e));
}
