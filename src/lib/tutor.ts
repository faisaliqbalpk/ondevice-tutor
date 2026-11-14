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

// ---------- Onboarding interview (on-device, adaptive) ----------

export interface InterviewQuestion {
  question: string;
  skill: string;
  subject: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface InterviewStep extends InterviewQuestion {
  /** Evaluation of the student's previous answer. */
  isCorrect: boolean;
  feedback: string;
}

const questionProps = {
  question: { type: 'string' },
  skill: { type: 'string' },
  subject: { type: 'string' },
  difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
};

const INTERVIEW_SYSTEM =
  'You are a friendly tutor running a short placement interview with a student, out loud. ' +
  'Ask one short question at a time that can be answered in a sentence or a number. ' +
  'Adapt: after a correct answer ask something harder, after a wrong one ask something easier. ' +
  'Never ask for personal information.';

export async function firstInterviewQuestion(
  grade: string,
  subject: string,
  struggles: string,
): Promise<AiResult<InterviewQuestion>> {
  return run<InterviewQuestion>(
    'Interview question',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system: INTERVIEW_SYSTEM,
      schema: { type: 'object', properties: questionProps, required: Object.keys(questionProps) },
    },
    `Student: ${grade}. Subject: ${subject}.` +
      (struggles ? ` They said they find this hard: "${struggles}".` : '') +
      ' Ask a medium-difficulty opening question for this subject at their grade level.',
  );
}

export async function nextInterviewStep(
  grade: string,
  previous: InterviewQuestion,
  answer: string,
  nextSubject: string,
): Promise<AiResult<InterviewStep>> {
  const props = {
    isCorrect: { type: 'boolean' },
    feedback: { type: 'string' },
    ...questionProps,
  };
  return run<InterviewStep>(
    'Interview step',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system: INTERVIEW_SYSTEM,
      schema: { type: 'object', properties: props, required: Object.keys(props) },
    },
    `Student: ${grade}.\n` +
      `Previous question (${previous.subject}, ${previous.difficulty}, skill "${previous.skill}"): ${previous.question}\n` +
      `Student answered: ${answer || '(no answer)'}\n\n` +
      'First judge whether the answer is correct and give one short, encouraging sentence of feedback. ' +
      `Then ask the next question, about ${nextSubject}` +
      (nextSubject === previous.subject ? ', adapting the difficulty to how they did.' : ', at medium difficulty.'),
  );
}

// ---------- Study plan (prefer cloud, anonymous summary only) ----------

export async function studyPlan(grade: string, summary: string): Promise<AiResult<string>> {
  return run<string>(
    'Study plan',
    {
      mode: InferenceMode.PREFER_IN_CLOUD,
      system: 'You are an expert learning coach. Write practical, encouraging plans in plain language.',
    },
    `Write a 2-week study plan for a ${grade} student.\n` +
      `Their placement results:\n${summary}\n\n` +
      'Use short sections per week, 15-20 minutes a day, and focus on the weakest skills first. ' +
      'End with 3 signs that they are improving. Keep it under 250 words.',
  );
}

// ---------- Assessments (on-device question writing and marking) ----------

export interface AssessmentQuestion {
  type: 'mcq' | 'short';
  prompt: string;
  choices: string[];
  answer: string;
  skill: string;
}

export interface AssessmentDraft {
  title: string;
  questions: AssessmentQuestion[];
}

const assessmentSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['mcq', 'short'] },
          prompt: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
          answer: { type: 'string' },
          skill: { type: 'string' },
        },
        required: ['type', 'prompt', 'choices', 'answer', 'skill'],
      },
    },
  },
  required: ['title', 'questions'],
};

export async function makeAssessment(opts: {
  subject: string;
  topics: string;
  grade: string;
  level: string;
  count: number;
  mix: 'mcq' | 'short' | 'mixed';
}): Promise<AiResult<AssessmentDraft>> {
  const mix =
    opts.mix === 'mcq'
      ? 'all multiple choice'
      : opts.mix === 'short'
        ? 'all short answer'
        : 'about half multiple choice and half short answer';
  return run<AssessmentDraft>(
    'Create assessment',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system:
        'You write clear, fair school assessments. Multiple-choice questions have exactly 4 choices and ' +
        '"answer" is the exact text of the correct choice. Short-answer questions have an empty choices list and ' +
        'a short model answer. Every question has a 2-4 word skill tag.',
      schema: assessmentSchema,
    },
    `Write a ${opts.count}-question ${opts.subject} assessment for a ${opts.grade} student working ${opts.level}.\n` +
      (opts.topics ? `Topics: ${opts.topics}.\n` : '') +
      `Question types: ${mix}. Order the questions from easier to harder.`,
  );
}

export interface ShortAnswerMark {
  isCorrect: boolean;
  feedback: string;
}

export async function markShortAnswers(
  items: { prompt: string; expected: string; given: string }[],
): Promise<AiResult<{ marks: ShortAnswerMark[] }>> {
  return run<{ marks: ShortAnswerMark[] }>(
    'Mark short answers',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system:
        'You mark short answers fairly. Accept answers that mean the same as the model answer, ' +
        'including different wording or equivalent numbers. Give one short sentence of feedback each.',
      schema: {
        type: 'object',
        properties: {
          marks: {
            type: 'array',
            items: {
              type: 'object',
              properties: { isCorrect: { type: 'boolean' }, feedback: { type: 'string' } },
              required: ['isCorrect', 'feedback'],
            },
          },
        },
        required: ['marks'],
      },
    },
    `Mark these ${items.length} answers, in order:\n` +
      items.map((it, i) => `${i + 1}. Q: ${it.prompt}\n   Model answer: ${it.expected}\n   Student: ${it.given || '(blank)'}`).join('\n'),
  );
}
