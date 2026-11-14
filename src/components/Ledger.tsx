import { useEffect, useState } from 'react';
import { ledger, type LedgerEntry } from '../lib/ledger';

export function Ledger() {
  const [entries, setEntries] = useState<LedgerEntry[]>(ledger.all());
  useEffect(() => {
    const off = ledger.subscribe(setEntries);
    return () => {
      off();
    };
  }, []);
  return (
    <section className="panel">
      <div className="row spread">
        <h2>Privacy ledger</h2>
        {entries.length > 0 && (
          <button className="secondary" onClick={() => ledger.clear()}>
            Clear
          </button>
        )}
      </div>
      <p className="muted">
        Every request that ran in the cloud, and exactly what was sent. Anything not listed here never left this
        device.
      </p>
      {entries.length === 0 ? (
        <p className="empty">Nothing has left this device.</p>
      ) : (
        <ul className="ledger">
          {entries.map((e) => (
            <li key={e.at}>
              <div className="row spread">
                <strong>{e.task}</strong>
                <span className="muted">{new Date(e.at).toLocaleString()}</span>
              </div>
              <pre>{e.sent}</pre>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
