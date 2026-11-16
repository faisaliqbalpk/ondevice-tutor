import type { Part } from 'firebase/ai';
import { run, InferenceMode, type AiResult } from './ai';

/**
 * Prompts for the study tools: Solve, Guided Learning, Immersive Reading, flash cards and
 * the tutor's memory. All prefer Gemini Nano on the device. Photos are read only on the device
 * unless the student explicitly allows the cloud, like answer-sheet marking.
 *
 * Gemini Nano has a small context window, so long inputs are trimmed before they are sent.
 */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

const obj = (props: Record<string, unknown>) => ({ type: 'object', properties: props, required: Object.keys(props) });
const str = { type: 'string' };
const strArr = { type: 'array', items: str };

// ---------- Solve: step-by-step worked solutions ----------

export interface SolveStep {
  title: string;
  work: string;
  why: string;
}

export interface Solution {
  topic: string;
  skill: string;
  /** The problem restated in plain words (also the text read from a photo). */
  problem: string;
  understand: string;
  steps: SolveStep[];
  answer: string;
  check: string;
  practice: { prompt: string; answer: string };
}

const solutionSchema = obj({
  topic: str,
  skill: str,
  problem: str,
  understand: str,
  steps: { type: 'array', items: obj({ title: str, work: str, why: str }) },
  answer: str,
  check: str,
  practice: obj({ prompt: str, answer: str }),
});

const SOLVE_SYSTEM =
  'You are a patient tutor who writes worked solutions a student can follow. ' +
  'Restate the problem, say in one sentence what it is asking, then solve it in 2 to 6 small steps. ' +
  'Each step has a short title, the working (numbers or sentences), and why that step is done. ' +
  'Give the final answer, a quick way to check it, and one similar practice problem with its answer. ' +
  'The skill is a 2-4 word tag. Use plain text, no LaTeX.';

export async function solveProblem(opts: {
  text: string;
  image?: Part;
  grade: string;
  context: string;
  allowCloud: boolean;
}): Promise<AiResult<Solution>> {
  const intro =
    `Student: ${opts.grade}.\nWhat the tutor knows about them:\n${clip(opts.context, 600)}\n\n` +
    (opts.image
      ? `Solve the problem in this photo.${opts.text ? ` The student adds: ${opts.text}` : ''}`
      : `Solve this problem:\n${clip(opts.text, 1500)}`);
  return run<Solution>(
    opts.image ? 'Solve a photographed problem' : 'Solve a problem',
    {
      // Photos stay on the device unless the student opts in, like answer sheets.
      mode: opts.image
        ? opts.allowCloud
          ? InferenceMode.ONLY_IN_CLOUD
          : InferenceMode.ONLY_ON_DEVICE
        : InferenceMode.PREFER_ON_DEVICE,
      system: SOLVE_SYSTEM,
      schema: solutionSchema,
    },
    opts.image ? [intro, opts.image] : intro,
  );
}

/** Answers a follow-up about one step ("I don't get step 2"). */
export async function explainStep(solution: Solution, stepIndex: number, question: string, grade: string) {
  const step = solution.steps[stepIndex];
  return run<string>(
    'Explain a solution step',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system: 'You are a patient tutor. Answer in 2-4 short sentences a student can follow. Use plain text.',
    },
    `A ${grade} student is working on: ${solution.problem}\n` +
      `Step ${stepIndex + 1}, "${step.title}": ${step.work} (${step.why})\n` +
      `They ask: ${question || 'I do not understand this step. Explain it another way.'}`,
  );
}

// ---------- Guided Learning ----------

export interface PathDraft {
  topics: { title: string; goal: string }[];
}

export async function makePath(opts: {
  subject: string;
  focus: string;
  grade: string;
  level: string;
  context: string;
}): Promise<AiResult<PathDraft>> {
  return run<PathDraft>(
    'Plan a learning path',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system:
        'You design short learning paths. Each topic builds on the one before, from foundations to the goal. ' +
        'Titles are 2-6 words. Each goal is one sentence starting with "I can".',
      schema: obj({ topics: { type: 'array', items: obj({ title: str, goal: str }) } }),
    },
    `Plan 5 to 6 topics of ${opts.subject} for a ${opts.grade} student who is ${opts.level || 'on track'}.\n` +
      (opts.focus ? `They want to learn: ${opts.focus}.\n` : '') +
      `What the tutor knows about them:\n${clip(opts.context, 600)}\n` +
      'Start just below their level so the first topic builds confidence.',
  );
}

export interface LessonCheck {
  prompt: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
}

export interface Lesson {
  intro: string;
  keyIdeas: string[];
  example: { problem: string; solution: string };
  questions: LessonCheck[];
}

export async function makeLesson(opts: {
  subject: string;
  title: string;
  goal: string;
  grade: string;
  context: string;
  retry: boolean;
}): Promise<AiResult<Lesson>> {
  return run<Lesson>(
    'Write a lesson',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system:
        'You teach one small topic at a time. Write a friendly 3-5 sentence introduction, 3 key ideas, ' +
        'one worked example, and exactly 5 multiple-choice check questions with 4 choices each, ' +
        'answerIndex 0-3, and a one-sentence explanation. Plain text, no LaTeX.',
      schema: obj({
        intro: str,
        keyIdeas: strArr,
        example: obj({ problem: str, solution: str }),
        questions: {
          type: 'array',
          items: obj({ prompt: str, choices: strArr, answerIndex: { type: 'integer' }, explanation: str }),
        },
      }),
    },
    `Teach "${opts.title}" (${opts.subject}) to a ${opts.grade} student. Goal: ${opts.goal}\n` +
      `What the tutor knows about them:\n${clip(opts.context, 500)}\n` +
      (opts.retry ? 'They did not pass the check last time: explain it a different way and use new questions.' : ''),
  );
}

// ---------- Immersive Reading ----------

export async function readPagePhoto(image: Part, allowCloud: boolean): Promise<AiResult<{ title: string; text: string }>> {
  return run<{ title: string; text: string }>(
    'Read a textbook page',
    {
      mode: allowCloud ? InferenceMode.ONLY_IN_CLOUD : InferenceMode.ONLY_ON_DEVICE,
      system:
        'You transcribe textbook pages. Copy the main text exactly, keeping paragraphs separated by a blank line. ' +
        'Skip page numbers, headers and footers. Give a short title.',
      schema: obj({ title: str, text: str }),
    },
    ['Transcribe this page.', image],
  );
}

export interface ParagraphHelp {
  simple: string;
  terms: { term: string; meaning: string }[];
  question: string;
}

export async function explainParagraph(paragraph: string, title: string, grade: string): Promise<AiResult<ParagraphHelp>> {
  return run<ParagraphHelp>(
    'Explain a paragraph',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system:
        'You help students read hard texts. Rewrite the paragraph in simpler words (2-4 sentences), ' +
        'explain up to 3 hard words, and ask one question that checks understanding.',
      schema: obj({
        simple: str,
        terms: { type: 'array', items: obj({ term: str, meaning: str }) },
        question: str,
      }),
    },
    `Reader: ${grade} student. Text: "${clip(title, 120)}".\nParagraph:\n${clip(paragraph, 1800)}`,
  );
}

export async function explainSelection(selection: string, paragraph: string, grade: string): Promise<AiResult<string>> {
  return run<string>(
    'Explain a highlight',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system: 'You explain words and phrases from a text in 1-3 short sentences a student understands.',
    },
    `A ${grade} student highlighted "${clip(selection, 300)}" in this paragraph:\n${clip(paragraph, 1200)}\nWhat does it mean here?`,
  );
}

export async function summarizePage(text: string, grade: string): Promise<AiResult<{ summary: string; keyPoints: string[] }>> {
  return run<{ summary: string; keyPoints: string[] }>(
    'Summarize a page',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system: 'You summarize texts for students: a 2-3 sentence summary and 3-5 key points.',
      schema: obj({ summary: str, keyPoints: strArr }),
    },
    `Reader: ${grade} student.\n\n${clip(text, 4000)}`,
  );
}

// ---------- Flash cards ----------

export interface CardDraft {
  front: string;
  back: string;
  skill: string;
}

export async function makeCards(
  source: 'mistakes' | 'reading' | 'solution' | 'lesson',
  material: string,
  grade: string,
  count = 6,
): Promise<AiResult<{ cards: CardDraft[] }>> {
  const what = {
    mistakes: 'these mistakes a student made. Each card should target the misconception behind one mistake',
    reading: 'this reading and the parts the student highlighted',
    solution: 'this worked solution. Cover the method, not just the final answer',
    lesson: 'this lesson',
  }[source];
  return run<{ cards: CardDraft[] }>(
    'Make flash cards',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system:
        'You write flash cards. The front is a short question or prompt; the back is a short, complete answer. ' +
        'One idea per card. Skill is a 2-4 word tag.',
      schema: obj({ cards: { type: 'array', items: obj({ front: str, back: str, skill: str }) } }),
    },
    `Write up to ${count} flash cards for a ${grade} student from ${what}:\n${clip(material, 3000)}`,
  );
}

// ---------- Memory: a short on-device note about the student, fed into prompts ----------

export async function updateMemory(opts: {
  previous: string;
  profile: string;
  recent: string[];
}): Promise<AiResult<{ memory: string }>> {
  return run<{ memory: string }>(
    'Update tutor memory',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system:
        'You keep a private tutor\'s notebook about one student. Write at most 80 words: what they are good at, ' +
        'what they struggle with and the misconceptions behind it, and what helps them learn. ' +
        'Keep useful old notes, drop outdated ones. Never include names or personal details.',
      schema: obj({ memory: str }),
    },
    `Previous notes:\n${opts.previous || '(none yet)'}\n\nSkill profile:\n${clip(opts.profile, 1200)}\n\n` +
      `Recent activity:\n- ${opts.recent.slice(-8).join('\n- ') || '(none)'}`,
  );
}
