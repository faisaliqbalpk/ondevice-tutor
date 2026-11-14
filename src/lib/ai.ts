import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  type GenerativeModel,
  type Part,
} from 'firebase/ai';
import { ai } from './firebase';
import { ledger } from './ledger';

export type Source = 'on_device' | 'in_cloud';
export type Mode = InferenceMode;
export { InferenceMode };

/** The cloud model used when Nano is unavailable or a task needs the cloud. */
const CLOUD_MODEL = 'gemini-3.5-flash-lite';

interface ModelSpec {
  mode: InferenceMode;
  system: string;
  /** Plain JSON Schema. Used on-device (responseConstraint) and in cloud (responseJsonSchema). */
  schema?: Record<string, unknown>;
}

const cache = new Map<string, GenerativeModel>();

function model(spec: ModelSpec): GenerativeModel {
  const key = JSON.stringify(spec);
  let m = cache.get(key);
  if (!m) {
    m = getGenerativeModel(ai, {
      mode: spec.mode,
      onDeviceParams: {
        createOptions: {
          initialPrompts: [{ role: 'system', content: [{ type: 'text', value: spec.system }] }],
        },
        promptOptions: spec.schema ? { responseConstraint: spec.schema } : undefined,
      },
      inCloudParams: {
        model: CLOUD_MODEL,
        systemInstruction: spec.system,
        generationConfig: spec.schema
          ? { responseMimeType: 'application/json', responseJsonSchema: spec.schema }
          : undefined,
      },
    });
    cache.set(key, m);
  }
  return m;
}

export interface AiResult<T> {
  data: T;
  text: string;
  source: Source;
}

/**
 * Runs one prompt through Firebase AI Logic hybrid inference.
 * Every request that actually ran in the cloud is written to the privacy ledger,
 * together with the exact text that left the device.
 */
export async function run<T = string>(
  task: string,
  spec: ModelSpec,
  prompt: string | Array<string | Part>,
): Promise<AiResult<T>> {
  const result = await model(spec).generateContent(prompt);
  const text = result.response.text();
  const source: Source =
    result.response.inferenceSource === InferenceSource.ON_DEVICE ? 'on_device' : 'in_cloud';
  if (source === 'in_cloud') {
    ledger.record(task, describe(prompt));
  }
  const data = (spec.schema ? JSON.parse(text) : text) as T;
  return { data, text, source };
}

function describe(prompt: string | Array<string | Part>): string {
  if (typeof prompt === 'string') return prompt;
  return prompt
    .map((p) => {
      if (typeof p === 'string') return p;
      if (p.type === 'text') return p.text;
      if (p.type === 'inlineData')
        return `[image: ${p.inlineData.mimeType}, ${Math.round((p.inlineData.data.length * 3) / 4 / 1024)} KB]`;
      return '[other part]';
    })
    .join('\n');
}

// ---------- On-device model status ----------

export type DeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

interface LanguageModelGlobal {
  availability(options?: unknown): Promise<Exclude<DeviceStatus, 'unsupported'>>;
}

export async function deviceStatus(): Promise<DeviceStatus> {
  const lm = (globalThis as unknown as { LanguageModel?: LanguageModelGlobal }).LanguageModel;
  if (!lm) return 'unsupported';
  try {
    return await lm.availability({
      expectedInputs: [{ type: 'text' }, { type: 'image' }],
    });
  } catch {
    return 'unavailable';
  }
}

/** Must be called from a user gesture (click). Downloads Gemini Nano if needed. */
export async function prepareDeviceModel(onProgress: (p: number) => void): Promise<void> {
  const m = model({ mode: InferenceMode.PREFER_ON_DEVICE, system: 'You are a helpful tutor.' });
  await m.initializeDeviceModel(onProgress);
}
