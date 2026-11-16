import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const configured = !!import.meta.env.VITE_FIREBASE_API_KEY;
const App = lazy(() => import('./App.tsx'));
const GuardianView = lazy(() => import('./components/GuardianView.tsx'));
const guardianToken = new URLSearchParams(location.search).get('guardian');

function Setup() {
  return (
    <div className="app">
      <div className="panel">
        <h1>Nano Tutor</h1>
        <p>Firebase isn't configured yet.</p>
        <p className="muted">
          Copy <code>.env.example</code> to <code>.env.local</code>, fill in your Firebase web app config, and restart
          the dev server. See the README for the full setup.
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {configured ? (
      <Suspense fallback={<p className="app muted">Loading…</p>}>
        {guardianToken ? <GuardianView token={guardianToken} /> : <App />}
      </Suspense>
    ) : (
      <Setup />
    )}
  </StrictMode>,
);
