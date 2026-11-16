import { useState } from 'react';
import {
  QUIET_AUTH_ERRORS,
  authErrorText,
  resetPassword,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '../lib/auth';
import { GoogleIcon } from './GoogleIcon';

type Mode = 'login' | 'signup' | 'reset';

const POINTS = [
  'Marks answer-sheet photos with Gemini Nano, on your device',
  'Remembers each student’s strengths and gaps',
  'Writes quizzes, lessons and missions for the weakest skills',
  'Works offline; every cloud request is shown in a privacy ledger',
];

/** Sign up / log in. The rest of the app is only shown once this succeeds. */
export function AuthPage({ hasGuestProgress }: { hasGuestProgress: boolean }) {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchTo(m: Mode) {
    setMode(m);
    setError(null);
    setNotice(null);
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (!QUIET_AUTH_ERRORS.has(code)) setError(authErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const em = email.trim();
    if (mode === 'signup') void run(() => signUpWithEmail(name.trim(), em, password));
    else if (mode === 'login') void run(() => signInWithEmail(em, password));
    else
      void run(async () => {
        await resetPassword(em);
        setNotice(`If an account exists for ${em}, a reset link is on its way. Check your inbox.`);
      });
  }

  const title = mode === 'signup' ? 'Create your account' : mode === 'login' ? 'Welcome back' : 'Reset your password';

  return (
    <div className="auth-page">
      <section className="auth-intro">
        <h1>Nano Tutor</h1>
        <p className="lead">A private tutor that marks, remembers and teaches on your device.</p>
        <ul>
          {POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>

      <section className="panel auth-card" aria-labelledby="auth-title">
        {mode !== 'reset' && (
          <div className="auth-switch" role="tablist">
            <button
              role="tab"
              aria-selected={mode === 'login'}
              className={mode === 'login' ? 'active' : ''}
              onClick={() => switchTo('login')}
            >
              Log in
            </button>
            <button
              role="tab"
              aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'active' : ''}
              onClick={() => switchTo('signup')}
            >
              Sign up
            </button>
          </div>
        )}
        <h2 id="auth-title">{title}</h2>
        {hasGuestProgress && mode !== 'reset' && (
          <p className="muted small">Progress already saved in this browser will be kept when you sign in.</p>
        )}

        {mode !== 'reset' && (
          <>
            <button type="button" className="google wide" onClick={() => void run(signInWithGoogle)} disabled={busy}>
              <GoogleIcon />
              Continue with Google
            </button>
            <div className="or">
              <span>or with email</span>
            </div>
          </>
        )}

        <form onSubmit={submit} className="auth-form">
          {mode === 'signup' && (
            <label className="field">
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Optional" />
            </label>
          )}
          <label className="field">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
            />
          </label>
          {mode !== 'reset' && (
            <label className="field">
              Password
              <input
                type="password"
                required
                minLength={mode === 'signup' ? 6 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
              {mode === 'signup' && <span className="muted small">At least 6 characters.</span>}
            </label>
          )}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && <p className="notice">{notice}</p>}

          <button type="submit" className="wide" disabled={busy}>
            {busy
              ? 'Please wait…'
              : mode === 'signup'
                ? 'Create account'
                : mode === 'login'
                  ? 'Log in'
                  : 'Send reset link'}
          </button>
        </form>

        <p className="small auth-links">
          {mode === 'login' && (
            <button type="button" className="link" onClick={() => switchTo('reset')}>
              Forgot password?
            </button>
          )}
          {mode === 'reset' && (
            <button type="button" className="link" onClick={() => switchTo('login')}>
              Back to log in
            </button>
          )}
        </p>
        <p className="muted small">
          Students' answers and photos stay on the device by default. Your account only keeps your progress in sync.
        </p>
      </section>
    </div>
  );
}
