import { useState } from 'react';
import { signInWithGoogle, signOutToGuest, type Account as AccountT } from '../lib/auth';
import { errorText } from '../lib/errors';

const QUIET = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

/** Header control: guest sessions can sign in with Google (keeping progress); signed-in users can sign out. */
export function Account({ account, onToast }: { account: AccountT | null; onToast: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (!account) return null;

  async function signIn() {
    setBusy(true);
    try {
      const r = await signInWithGoogle();
      if (r.kind === 'linked') onToast('Signed in with Google. Your progress is saved to your account.');
      if (r.kind === 'merged') onToast(`Signed in. Copied this device's progress into your account (${r.copied} items).`);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (code === 'auth/operation-not-allowed') onToast('Google sign-in is not enabled for this Firebase project yet.');
      else if (code === 'auth/popup-blocked') onToast('The sign-in popup was blocked. Allow popups for this site and try again.');
      else if (!QUIET.has(code)) onToast(`Sign-in failed: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (account.anonymous) {
    return (
      <div className="account">
        <span className="muted small" title="Progress is stored for this browser only. Sign in to keep it across devices.">
          Guest
        </span>
        <button className="google" onClick={signIn} disabled={busy}>
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
            <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
          </svg>
          {busy ? 'Signing in…' : 'Sign in with Google'}
        </button>
      </div>
    );
  }
  return (
    <div className="account">
      {account.photo && <img className="avatar-img" src={account.photo} alt="" referrerPolicy="no-referrer" />}
      <span className="small">{account.name ?? account.email}</span>
      <button className="secondary small" onClick={() => void signOutToGuest()}>
        Sign out
      </button>
    </div>
  );
}
