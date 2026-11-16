import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';

/**
 * Study storage: question bank, flash cards, readings, guided paths and the daily log.
 * Everything lives under users/{uid}/... and uses Firestore's offline cache, so it works without a network.
 * Queries filter on studentId only (no composite indexes needed) and sort on the client.
 */

// ---------- Spaced repetition (Leitner boxes) ----------

const DAY = 24 * 60 * 60 * 1000;
/** Days until the next review for each box. Box 0 means "again soon". */
export const INTERVALS = [0, 1, 3, 7, 14, 30];
export type Grade = 'again' | 'hard' | 'good' | 'easy';

export interface Scheduled {
  box?: number;
  due?: number;
}

export function schedule(item: Scheduled, grade: Grade, now = Date.now()): { box: number; due: number } {
  const box = item.box ?? 0;
  const next =
    grade === 'again' ? 0 : grade === 'hard' ? Math.max(1, box) : grade === 'good' ? box + 1 : box + 2;
  const b = Math.min(next, INTERVALS.length - 1);
  const due = b === 0 ? now + 10 * 60 * 1000 : now + INTERVALS[b] * DAY;
  return { box: b, due };
}

export const isDue = (item: Scheduled, now = Date.now()) => (item.due ?? 0) <= now;

export function dueLabel(item: Scheduled, now = Date.now()): string {
  const d = (item.due ?? 0) - now;
  if (d <= 0) return 'due now';
  if (d < DAY) return 'later today';
  const days = Math.round(d / DAY);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** Stable short id from text, so saving the same question twice updates one document. */
export function textId(...parts: string[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (const c of parts.join('\u0001')) {
    h1 = Math.imul(h1 ^ c.charCodeAt(0), 16777619);
    h2 = (h2 * 31 + c.charCodeAt(0)) | 0;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

function watchFor<T>(uid: string, name: string, studentId: string, cb: (items: T[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'users', uid, name), where('studentId', '==', studentId)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)),
    (e) => console.error(`Firestore ${name}:`, e.message),
  );
}

// ---------- Question bank ----------

export type BankOrigin = 'quiz' | 'assessment' | 'solve' | 'lesson' | 'daily';

export interface BankItem extends Scheduled {
  id: string;
  studentId: string;
  prompt: string;
  /** Empty for short-answer questions. */
  choices: string[];
  /** Exact text of the correct choice, or a model answer. */
  answer: string;
  skill: string;
  hint?: string;
  origin: BankOrigin;
  attempts?: number;
  correct?: number;
  lastCorrect?: boolean;
  lastAt?: number;
  createdAt: number;
}

export type NewBankItem = Pick<BankItem, 'prompt' | 'choices' | 'answer' | 'skill' | 'origin'> & { hint?: string };

const bank = (uid: string) => collection(db, 'users', uid, 'bank');

export function watchBank(uid: string, studentId: string, cb: (items: BankItem[]) => void) {
  return watchFor<BankItem>(uid, 'bank', studentId, (items) => cb(items.sort((a, b) => b.createdAt - a.createdAt)));
}

/**
 * Saves questions to the bank. When a result is given, the attempt is recorded and the
 * question is scheduled for spaced review: wrong answers come back soon, right ones later.
 */
export async function saveToBank(
  uid: string,
  studentId: string,
  items: (NewBankItem & { result?: boolean })[],
): Promise<void> {
  const now = Date.now();
  await Promise.all(
    items.map(async ({ result, ...q }) => {
      const ref = doc(bank(uid), textId(studentId, q.prompt));
      const prev = (await getDoc(ref).catch(() => null))?.data() as BankItem | undefined;
      const base = { ...q, hint: q.hint ?? '', skill: q.skill.trim().toLowerCase(), studentId };
      if (!prev) {
        const sched = result === undefined ? { box: 0, due: now } : schedule({}, result ? 'good' : 'again', now);
        await setDoc(ref, {
          ...base,
          ...sched,
          createdAt: now,
          attempts: result === undefined ? 0 : 1,
          correct: result ? 1 : 0,
          ...(result === undefined ? {} : { lastCorrect: result, lastAt: now }),
        });
      } else if (result !== undefined) {
        await updateDoc(ref, {
          ...schedule(prev, result ? 'good' : 'again', now),
          attempts: (prev.attempts ?? 0) + 1,
          correct: (prev.correct ?? 0) + (result ? 1 : 0),
          lastCorrect: result,
          lastAt: now,
        });
      }
    }),
  );
}

export function recordBankAttempt(uid: string, item: BankItem, isCorrect: boolean) {
  const now = Date.now();
  void updateDoc(doc(bank(uid), item.id), {
    ...schedule(item, isCorrect ? 'good' : 'again', now),
    attempts: (item.attempts ?? 0) + 1,
    correct: (item.correct ?? 0) + (isCorrect ? 1 : 0),
    lastCorrect: isCorrect,
    lastAt: now,
  });
}

export function deleteBankItem(uid: string, id: string) {
  void deleteDoc(doc(bank(uid), id));
}

// ---------- Flash cards ----------

export type CardOrigin = 'mistake' | 'reading' | 'solve' | 'lesson' | 'manual';

export interface Card extends Scheduled {
  id: string;
  studentId: string;
  front: string;
  back: string;
  skill: string;
  origin: CardOrigin;
  reviews?: number;
  createdAt: number;
}

const cards = (uid: string) => collection(db, 'users', uid, 'cards');

export function watchCards(uid: string, studentId: string, cb: (c: Card[]) => void) {
  return watchFor<Card>(uid, 'cards', studentId, (c) => cb(c.sort((a, b) => (a.due ?? 0) - (b.due ?? 0))));
}

export function addCards(
  uid: string,
  studentId: string,
  items: { front: string; back: string; skill: string }[],
  origin: CardOrigin,
): number {
  const now = Date.now();
  for (const c of items) {
    // Same front for the same student overwrites, so regenerating never duplicates.
    void setDoc(doc(cards(uid), textId(studentId, c.front)), {
      ...c,
      skill: c.skill.trim().toLowerCase(),
      studentId,
      origin,
      box: 0,
      due: now,
      reviews: 0,
      createdAt: now,
    });
  }
  return items.length;
}

export function reviewCard(uid: string, card: Card, grade: Grade) {
  void updateDoc(doc(cards(uid), card.id), { ...schedule(card, grade), reviews: (card.reviews ?? 0) + 1 });
}

export function deleteCard(uid: string, id: string) {
  void deleteDoc(doc(cards(uid), id));
}

// ---------- Readings (Immersive Reading) ----------

export interface Reading {
  id: string;
  studentId: string;
  title: string;
  text: string;
  /** Exact snippets the student highlighted. */
  highlights: string[];
  notes: string;
  /** Saved explanations by paragraph index. */
  explanations: Record<string, string>;
  summary?: string;
  createdAt: number;
  updatedAt: number;
}

const readings = (uid: string) => collection(db, 'users', uid, 'readings');

export function watchReadings(uid: string, studentId: string, cb: (r: Reading[]) => void) {
  return watchFor<Reading>(uid, 'readings', studentId, (r) => cb(r.sort((a, b) => b.updatedAt - a.updatedAt)));
}

export function saveReading(uid: string, r: Omit<Reading, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): string {
  const ref = r.id ? doc(readings(uid), r.id) : doc(readings(uid));
  const now = Date.now();
  const { id: _id, ...rest } = r;
  void setDoc(ref, { ...rest, updatedAt: now, ...(r.id ? {} : { createdAt: now }) }, { merge: true });
  return ref.id;
}

export function updateReading(uid: string, id: string, fields: Partial<Omit<Reading, 'id'>>) {
  void updateDoc(doc(readings(uid), id), { ...fields, updatedAt: Date.now() });
}

export function deleteReading(uid: string, id: string) {
  void deleteDoc(doc(readings(uid), id));
}

// ---------- Guided Learning paths ----------

export type TopicStatus = 'locked' | 'open' | 'passed';

export interface PathTopic {
  title: string;
  goal: string;
  status: TopicStatus;
  /** Best check score, 0-1. */
  best: number;
  attempts: number;
}

export interface LearningPath {
  id: string;
  studentId: string;
  subject: string;
  focus: string;
  topics: PathTopic[];
  createdAt: number;
}

/** Share of check questions a student must get right to unlock the next topic. */
export const PASS_MARK = 0.8;

const paths = (uid: string) => collection(db, 'users', uid, 'paths');

export function watchPaths(uid: string, studentId: string, cb: (p: LearningPath[]) => void) {
  return watchFor<LearningPath>(uid, 'paths', studentId, (p) => cb(p.sort((a, b) => b.createdAt - a.createdAt)));
}

export function savePath(uid: string, p: Omit<LearningPath, 'id' | 'createdAt'>): string {
  const ref = doc(paths(uid));
  void setDoc(ref, { ...p, createdAt: Date.now() });
  return ref.id;
}

/** Records a check result; passing unlocks the next topic (the mastery gate). */
export function recordTopicCheck(uid: string, path: LearningPath, index: number, score: number): PathTopic[] {
  const topics = path.topics.map((t) => ({ ...t }));
  const t = topics[index];
  t.attempts += 1;
  t.best = Math.max(t.best, score);
  if (score >= PASS_MARK) {
    t.status = 'passed';
    if (topics[index + 1]?.status === 'locked') topics[index + 1].status = 'open';
  }
  void updateDoc(doc(paths(uid), path.id), { topics });
  return topics;
}

export function deletePath(uid: string, id: string) {
  void deleteDoc(doc(paths(uid), id));
}

// ---------- Daily practice log (streaks) ----------

export interface DailyLog {
  id: string;
  studentId: string;
  /** YYYY-MM-DD in local time. */
  date: string;
  done: number;
  correct: number;
}

export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const daily = (uid: string) => collection(db, 'users', uid, 'daily');

export function watchDaily(uid: string, studentId: string, cb: (d: DailyLog[]) => void) {
  return watchFor<DailyLog>(uid, 'daily', studentId, (d) => cb(d.sort((a, b) => b.date.localeCompare(a.date))));
}

export function logDaily(uid: string, studentId: string, prev: DailyLog | undefined, done: number, correct: number) {
  const date = today();
  const same = prev?.date === date ? prev : undefined;
  void setDoc(doc(daily(uid), `${studentId}_${date}`), {
    studentId,
    date,
    done: (same?.done ?? 0) + done,
    correct: (same?.correct ?? 0) + correct,
  });
}

/** Consecutive days (ending today or yesterday) with daily practice done. */
export function dailyStreak(logs: DailyLog[]): number {
  const days = new Set(logs.filter((l) => l.done > 0).map((l) => l.date));
  const d = new Date();
  if (!days.has(today(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(today(d))) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
