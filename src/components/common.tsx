import type { Source } from '../lib/ai';

export function SourceBadge({ source }: { source: Source }) {
  return source === 'on_device' ? (
    <span className="badge device" title="Ran on this device with Gemini Nano. Nothing left the device.">
      On-device
    </span>
  ) : (
    <span className="badge cloud" title="Ran in the cloud with Gemini. See the privacy ledger for what was sent.">
      Cloud
    </span>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <p className="error">{error}</p> : null;
}
