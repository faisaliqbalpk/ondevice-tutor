import {
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  signInWithCredential,
  signOut as fbSignOut,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import { collection, doc, getDocs, writeBatch, type DocumentData } from 'firebase/firestore';
import { auth, db, resetAnonymousSession, waitForUser } from './firebase';

/** Every per-user collection under users/{uid}. Used to carry progress over when accounts merge. */
export const USER_COLLECTIONS = [
  'students',
  'alerts',
  'assessments',
  'missions',
  'bank',
  'cards',
  'readings',
  'paths',
  'daily',
] as const;

export interface Account {
  uid: string;
  anonymous: boolean;
  name: string | null;
  email: string | null;
  photo: string | null;
}

function toAccount(u: User): Account {
  return { uid: u.uid, anonymous: u.isAnonymous, name: u.displayName, email: u.email, photo: u.photoURL };
}

/**
 * Calls back with the current account. When nobody is signed in (first visit, or after
 * signing out) it starts an anonymous session, so the app always has a user to store progress under.
 */
export function watchAccount(cb: (a: Account | null) => void, onError: (e: unknown) => void): () => void {
  return onAuthStateChanged(auth, (u) => {
    if (u) cb(toAccount(u));
    else {
      cb(null);
      waitForUser().catch(onError);
    }
  });
}

const provider = () => {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
};

type Snapshot = Record<string, { id: string; data: DocumentData }[]>;

async function snapshotUserData(uid: string): Promise<Snapshot> {
  const out: Snapshot = {};
  for (const name of USER_COLLECTIONS) {
    const snap = await getDocs(collection(db, 'users', uid, name));
    out[name] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  }
  return out;
}

async function restoreUserData(uid: string, data: Snapshot): Promise<number> {
  let n = 0;
  let batch = writeBatch(db);
  let inBatch = 0;
  for (const [name, docs] of Object.entries(data)) {
    for (const d of docs) {
      batch.set(doc(db, 'users', uid, name, d.id), d.data, { merge: true });
      n += 1;
      if (++inBatch === 400) {
        await batch.commit();
        batch = writeBatch(db);
        inBatch = 0;
      }
    }
  }
  if (inBatch) await batch.commit();
  return n;
}

export type GoogleResult = { kind: 'linked' } | { kind: 'merged'; copied: number } | { kind: 'signed-in' };

/**
 * Signs in with Google.
 * - Guest session: the anonymous account is upgraded in place (same uid), so all progress is kept.
 * - The Google account already exists: we copy this guest's progress into it, then switch to it.
 */
export async function signInWithGoogle(): Promise<GoogleResult> {
  const current = auth.currentUser ?? (await waitForUser());
  if (!current.isAnonymous) return { kind: 'signed-in' };
  try {
    await linkWithPopup(current, provider());
    return { kind: 'linked' };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== 'auth/credential-already-in-use' && code !== 'auth/email-already-in-use') throw e;
    const credential: AuthCredential | null = GoogleAuthProvider.credentialFromError(e as never);
    if (!credential) throw e;
    // Read the guest's data while we still have its permissions, then switch accounts.
    const data = await snapshotUserData(current.uid);
    const { user } = await signInWithCredential(auth, credential);
    const copied = await restoreUserData(user.uid, data);
    return { kind: 'merged', copied };
  }
}

/** Signs out of Google. The app then starts a fresh guest session on this device. */
export async function signOutToGuest() {
  resetAnonymousSession();
  await fbSignOut(auth);
}
