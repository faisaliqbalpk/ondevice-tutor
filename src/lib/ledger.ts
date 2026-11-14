/**
 * Privacy ledger: an append-only, local-only list of every request that ran in the
 * cloud and exactly what text was sent. Shown in the UI so students, parents and
 * teachers can verify that answer-sheet photos never left the device.
 */
export interface LedgerEntry {
  at: number;
  task: string;
  sent: string;
}

type Listener = (entries: LedgerEntry[]) => void;

const KEY = 'tutor.ledger.v1';

function load(): LedgerEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as LedgerEntry[];
  } catch {
    return [];
  }
}

let entries = load();
const listeners = new Set<Listener>();

export const ledger = {
  record(task: string, sent: string) {
    entries = [{ at: Date.now(), task, sent }, ...entries].slice(0, 200);
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {
      /* storage unavailable: keep in memory */
    }
    listeners.forEach((l) => l(entries));
  },
  all: () => entries,
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  clear() {
    entries = [];
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l(entries));
  },
};
