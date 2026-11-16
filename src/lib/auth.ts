import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import { collection, doc, getDocs, writeBatch, type DocumentData } from 'firebase/firestore';
import { auth, db } from './firebase';

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
  /** Left over from the old guest mode. Such a session must sign in before using the app. */
  anonymous: boolean;
  name: string | null;
  email: string | null;
  photo: string | null;
}

function toAccount(u: User): Account {
  return { uid: u.uid, anonymous: u.isAnonymous, name: u.displayName, email: u.email, photo: u.photoURL };
}

const watchers = new Set<(a: Account | null) => void>();

/** Calls back with the current account, or null when nobody is signed in. */
export function watchAccount(cb: (a: Account | null) => void): () => void {
  watchers.add(cb);
  const off = onAuthStateChanged(auth, (u) => cb(u ? toAccount(u) : null));
  return () => {
    watchers.delete(cb);
    off();
  };
}

const provider = () => {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
};

/**
 * A browser may still hold a guest session from before sign-in was required.
 * Returns it so its progress can be kept when the student signs in.
 */
function leftoverGuest(): User | null {
  const u = auth.currentUser;
  return u?.isAnonymous ? u : null;
}

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

/** Signs in to an existing account, first copying any leftover guest progress into it. */
async function signInKeepingGuest(signIn: () => Promise<User>): Promise<number> {
  const guest = leftoverGuest();
  // Read the guest's data while we still have its permissions, then switch accounts.
  const data = guest ? await snapshotUserData(guest.uid) : null;
  const user = await signIn();
  return data ? restoreUserData(user.uid, data) : 0;
}

/** Creates an email/password account. A leftover guest session is upgraded in place, so its progress is kept. */
export async function signUpWithEmail(name: string, email: string, password: string): Promise<void> {
  const guest = leftoverGuest();
  const user = guest
    ? (await linkWithCredential(guest, EmailAuthProvider.credential(email, password))).user
    : (await createUserWithEmailAndPassword(auth, email, password)).user;
  if (name) {
    await updateProfile(user, { displayName: name });
    // updateProfile doesn't fire onAuthStateChanged, so tell watchers about the new name.
    for (const cb of watchers) cb(toAccount(user));
  }
}

/** Signs in with email and password. Returns how many guest items were copied into the account. */
export function signInWithEmail(email: string, password: string): Promise<number> {
  return signInKeepingGuest(async () => (await signInWithEmailAndPassword(auth, email, password)).user);
}

export function resetPassword(email: string): Promise<void> {
  return sendPasswordResetEmail(auth, email);
}

export type GoogleResult = { kind: 'signed-in' } | { kind: 'linked' } | { kind: 'merged'; copied: number };

/**
 * Signs in with Google.
 * - No session: a normal popup sign-in (creates the account on first use).
 * - Leftover guest session: upgraded in place (same uid); if the Google account already
 *   exists, the guest's progress is copied into it.
 */
export async function signInWithGoogle(): Promise<GoogleResult> {
  const guest = leftoverGuest();
  if (!guest) {
    await signInWithPopup(auth, provider());
    return { kind: 'signed-in' };
  }
  try {
    await linkWithPopup(guest, provider());
    return { kind: 'linked' };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== 'auth/credential-already-in-use' && code !== 'auth/email-already-in-use') throw e;
    const credential: AuthCredential | null = GoogleAuthProvider.credentialFromError(e as never);
    if (!credential) throw e;
    const copied = await signInKeepingGuest(async () => (await signInWithCredential(auth, credential)).user);
    return { kind: 'merged', copied };
  }
}

export function signOut(): Promise<void> {
  return fbSignOut(auth);
}

const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'That email and password don\'t match an account.',
  'auth/wrong-password': 'That email and password don\'t match an account.',
  'auth/user-not-found': 'That email and password don\'t match an account.',
  'auth/invalid-email': 'That doesn\'t look like an email address.',
  'auth/email-already-in-use': 'An account with this email already exists. Log in instead.',
  'auth/credential-already-in-use': 'An account with this email already exists. Log in instead.',
  'auth/weak-password': 'Use a password with at least 6 characters.',
  'auth/missing-password': 'Enter your password.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/network-request-failed': 'You\'re offline. Connect to the internet to sign in.',
  'auth/operation-not-allowed': 'This sign-in method isn\'t enabled for this app yet.',
  'auth/popup-blocked': 'The sign-in popup was blocked. Allow popups for this site and try again.',
  'auth/account-exists-with-different-credential':
    'This email is already registered with a different sign-in method. Use that method instead.',
};

/** Popup closures the user caused themselves; not worth an error message. */
export const QUIET_AUTH_ERRORS = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

export function authErrorText(e: unknown): string {
  const code = (e as { code?: string }).code ?? '';
  return AUTH_MESSAGES[code] ?? (e instanceof Error ? e.message : String(e));
}
