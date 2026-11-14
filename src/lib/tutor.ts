import { run, InferenceMode, type AiResult } from './ai';
import type { Part } from 'firebase/ai';

// ---------- Marking an answer sheet (on-device only, cloud only with consent) ----------

export interface MarkedQuestion {
  number: number;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  skill: string;
  confidence: number;
  feedback: string;
}

export interface MarkResult {
  questions: MarkedQuestion[];
}

const markSchema = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          studentAnswer: { type: 'string' },
          correctAnswer: { type: 'string' },
          isCorrect: { type: 'boolean' },
          skill: { type: 'string' },
          confidence: { type: 'number' },
          feedback: { type: 'string' },
        },
        required: ['number', 'studentAnswer', 'correctAnswer', 'isCorrect', 'skill', 'confidence', 'feedback'],
      },
    },
  },
  required: ['questions'],
};

const MARK_SYSTEM =
  'You mark student answer sheets. Read the handwritten or printed answers in the photo. ' +
  'Compare each one with the answer key. For each question give the student answer exactly as written, ' +
  'the correct answer, whether it is correct, a short skill tag (2-4 words, reuse a known skill when it fits), ' +
  'your confidence from 0 to 1 that you read the answer correctly, and one short, kind sentence of feedback. ' +
  'Never include the student name.';

export async function markSheet(
  image: Part,
  answerKey: string,
  knownSkills: string[],
  allowCloud: boolean,
): Promise<AiResult<MarkResult>> {
  const prompt: Array<string | Part> = [
    `Answer key:\n${answerKey}\n\nKnown skills: ${knownSkills.join(', ') || 'none yet'}\n\nMark this answer sheet.`,
    image,
  ];
  return run<MarkResult>(
    'Mark answer sheet',
    {
      mode: allowCloud ? InferenceMode.ONLY_IN_CLOUD : InferenceMode.ONLY_ON_DEVICE,
      system: MARK_SYSTEM,
      schema: markSchema,
    },
    prompt,
  );
}

// ---------- Practice quiz on the weakest skill (prefer on-device) ----------

export interface QuizQuestion {
  prompt: string;
  choices: string[];
  answerIndex: number;
  hint: string;
  skill: string;
}

export interface Quiz {
  title: string;
  questions: QuizQuestion[];
}

const quizSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
          answerIndex: { type: 'integer' },
          hint: { type: 'string' },
          skill: { type: 'string' },
        },
        required: ['prompt', 'choices', 'answerIndex', 'hint', 'skill'],
      },
    },
  },
  required: ['title', 'questions'],
};

export async function makeQuiz(
  skills: string[],
  gradeLevel: string,
  recentMistakes: string[],
  count = 5,
): Promise<AiResult<Quiz>> {
  const prompt =
    `Write a ${count}-question multiple-choice practice quiz for a ${gradeLevel} student.\n` +
    `Focus on these weak skills: ${skills.join(', ')}.\n` +
    (recentMistakes.length ? `Recent mistakes to target:\n- ${recentMistakes.join('\n- ')}\n` : '') +
    'Each question has exactly 4 choices, one correct answer (answerIndex 0-3), and a hint that does not give the answer away.';
  return run<Quiz>(
    'Generate practice quiz',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system: 'You are a patient tutor who writes clear, age-appropriate practice questions.',
      schema: quizSchema,
    },
    prompt,
  );
}

// ---------- Deep explanation (prefer cloud, anonymous: no names, no photos) ----------

export async function explainMistake(
  skill: string,
  question: string,
  studentAnswer: string,
  correctAnswer: string,
  gradeLevel: string,
): Promise<AiResult<string>> {
  const prompt =
    `A ${gradeLevel} student is working on "${skill}".\n` +
    `Question: ${question}\nStudent answered: ${studentAnswer}\nCorrect answer: ${correctAnswer}\n` +
    'Explain step by step why the correct answer is right, name the likely misconception, ' +
    'and give one similar example worked out. Keep it under 200 words.';
  return run<string>(
    'Explain a mistake',
    {
      mode: InferenceMode.PREFER_IN_CLOUD,
      system: 'You are an expert, encouraging tutor. Use simple language.',
    },
    prompt,
  );
}

// ---------- Conversational tutor (on-device, history stitched into one prompt) ----------

export interface Turn {
  role: 'student' | 'tutor';
  text: string;
}

/**
 * Gemini Nano on-device is single-turn, so the conversation and the student's
 * mastery summary are stitched into one prompt. This keeps the tutor on-device.
 */
export async function tutorReply(
  history: Turn[],
  message: string,
  masterySummary: string,
): Promise<AiResult<string>> {
  const recent = history.slice(-8);
  const prompt =
    `What you know about this student:\n${masterySummary}\n\n` +
    (recent.length
      ? `Conversation so far:\n${recent.map((t) => `${t.role === 'student' ? 'Student' : 'Tutor'}: ${t.text}`).join('\n')}\n\n`
      : '') +
    `Student: ${message}\nTutor:`;
  return run<string>(
    'Tutor conversation',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system:
        'You are a warm, Socratic tutor talking out loud with a student. Reply in 1-3 short sentences ' +
        'suitable for speech. Ask a guiding question rather than giving the answer straight away.',
    },
    prompt,
  );
}
