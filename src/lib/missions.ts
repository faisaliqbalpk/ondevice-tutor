import { addDoc, collection, limit, onSnapshot, orderBy, query, serverTimestamp, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import { run, InferenceMode, type AiResult } from './ai';

/**
 * Missions: spoken roleplay scenarios. The student talks to an in-character persona
 * (played by Gemini Nano on-device) and has to use a skill to reach an objective.
 * Gemini Nano is single-turn, so each turn stitches the mission, the mode rules and
 * the transcript so far into one prompt and asks for a JSON reply.
 */

export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Expert';
export const DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard', 'Expert'];

/** coach: hints, corrections and mini-checks. challenge: the persona never does the work for you. */
export type MissionMode = 'coach' | 'challenge';

export interface Mission {
  id: string;
  subject: string;
  title: string;
  difficulty: Difficulty;
  /** What the student has to achieve, shown on screen. */
  objective: string;
  /** Who the AI plays. */
  persona: string;
  emoji: string;
  /** The persona's first line. */
  opening: string;
  /** Skill tag that feeds the student's skill profile. */
  skill: string;
  custom?: boolean;
}

export const STARTER_MISSIONS: Mission[] = [
  {
    id: 'math-pizza',
    subject: 'Math',
    title: 'Split the pizza',
    difficulty: 'Easy',
    objective: 'Work out how many slices each of 3 friends gets from 2 pizzas cut into 6 slices each, and what fraction of a pizza that is.',
    persona: 'Hungry friend at a birthday party',
    emoji: '🍕',
    opening: "Two pizzas just arrived, six slices each, and there are three of us! How many slices do I get? I'm starving.",
    skill: 'fractions',
  },
  {
    id: 'math-change',
    subject: 'Math',
    title: 'Give the right change',
    difficulty: 'Medium',
    objective: 'Run a market stall: a customer buys items for $7.35 and pays with a $20 note. Give the correct change and explain how you worked it out.',
    persona: 'Impatient customer at a fruit stall',
    emoji: '🍎',
    opening: "Right, that's apples and a melon. Here's a twenty. Come on, how much change do I get? I've got a bus to catch!",
    skill: 'decimals and money',
  },
  {
    id: 'math-garden',
    subject: 'Math',
    title: 'Fence the garden',
    difficulty: 'Hard',
    objective: 'Help a gardener fence a rectangular plot 12 m by 7.5 m with a 1.5 m gate. Find how much fencing to buy.',
    persona: 'Grumpy gardener who hates wasting money',
    emoji: '🌻',
    opening: "I'm not buying a centimetre more fence than I need. Twelve metres by seven and a half, and there's a gate. How much do I buy?",
    skill: 'perimeter',
  },
  {
    id: 'math-phone-plan',
    subject: 'Math',
    title: 'Pick the cheaper phone plan',
    difficulty: 'Expert',
    objective: 'Plan A is $15 a month plus $0.10 per text. Plan B is $25 a month with free texts. Find when Plan B becomes cheaper and advise the shopper.',
    persona: 'Sales rep pushing the expensive plan',
    emoji: '📱',
    opening: 'Plan B is obviously the better deal for everyone! Twenty-five a month, unlimited texts. Shall I sign you up?',
    skill: 'linear equations',
  },
  {
    id: 'sci-alien-plants',
    subject: 'Science',
    title: 'Explain plants to an alien',
    difficulty: 'Easy',
    objective: 'Explain to a visiting alien what plants need to make their own food, and where that food-making happens.',
    persona: 'Curious alien visiting Earth',
    emoji: '👽',
    opening: 'Greetings, Earthling! Your green things do not eat. They just stand there. How do they not starve?',
    skill: 'photosynthesis',
  },
  {
    id: 'sci-ice-cream',
    subject: 'Science',
    title: 'Save the ice cream van',
    difficulty: 'Medium',
    objective: 'Explain to the driver why ice cream melts and suggest two ways to slow it down using what you know about heat transfer.',
    persona: 'Panicked ice cream van driver on a heatwave day',
    emoji: '🍦',
    opening: "My freezer broke and it's thirty-five degrees! Everything's melting! Why is this happening and what do I do?",
    skill: 'heat transfer',
  },
  {
    id: 'sci-detective',
    subject: 'Science',
    title: 'Solve the mystery powder',
    difficulty: 'Hard',
    objective: 'A white powder fizzes in vinegar but not in water. Help the detective decide if it is salt, sugar or baking soda, and explain the reaction.',
    persona: 'Detective who knows nothing about chemistry',
    emoji: '🕵️',
    opening: "We found this white powder at the scene. It fizzed like crazy in vinegar, but nothing in water. Salt, sugar, baking soda? I'm lost.",
    skill: 'chemical reactions',
  },
  {
    id: 'eng-pen-pal',
    subject: 'English',
    title: "Fix the pen pal's letter",
    difficulty: 'Easy',
    objective: 'Help your pen pal correct three mistakes in: "me and him goes to the park yesterday".',
    persona: 'Friendly pen pal learning English',
    emoji: '✉️',
    opening: 'Hello friend! I wrote "me and him goes to the park yesterday". My teacher says it has mistakes. Can you help me fix it?',
    skill: 'grammar',
  },
  {
    id: 'eng-persuade',
    subject: 'English',
    title: 'Persuade the principal',
    difficulty: 'Hard',
    objective: 'Persuade the principal to allow a longer lunch break using a clear claim, two reasons and a polite closing.',
    persona: 'Strict school principal',
    emoji: '🏫',
    opening: "You have two minutes. Why exactly should I make lunch longer? I've heard every excuse there is.",
    skill: 'persuasive writing',
  },
  {
    id: 'his-time-traveller',
    subject: 'History',
    title: 'Interview a time traveller',
    difficulty: 'Medium',
    objective: 'Ask good questions to find out which era the traveller comes from, then name it and give one piece of evidence.',
    persona: 'Mysterious time traveller who only answers questions',
    emoji: '⏳',
    opening: "Ah, you've noticed my odd clothes. I won't tell you where I'm from. But ask me anything about daily life and I'll answer honestly.",
    skill: 'historical evidence',
  },
  {
    id: 'geo-lost-tourist',
    subject: 'Geography',
    title: 'Guide the lost tourist',
    difficulty: 'Medium',
    objective: 'Using compass directions, guide a tourist from the station (centre of town) to the museum, two blocks north and three blocks east.',
    persona: 'Lost tourist with a broken phone',
    emoji: '🧭',
    opening: "Excuse me! My phone died and I'm at the station. The museum is two blocks north and three blocks east, but I have no idea which way north is!",
    skill: 'map reading',
  },
  {
    id: 'cs-robot',
    subject: 'Computer science',
    title: 'Debug the robot chef',
    difficulty: 'Medium',
    objective: 'The robot made toast by: butter bread, put bread in toaster, take bread out. Find the bug and give fixed step-by-step instructions.',
    persona: 'Confused robot chef',
    emoji: '🤖',
    opening: 'BEEP. I followed my instructions exactly. Butter. Toaster. Out. But now the kitchen smells of burning butter. What went wrong?',
    skill: 'algorithms',
  },
];

// ---------- One mission turn (on-device) ----------

export interface MissionTurn {
  role: 'student' | 'persona';
  text: string;
}

export interface PersonaReply {
  /** In-character spoken reply. */
  reply: string;
  /** Coach mode only: a correction, nudge or quick check, out of character. */
  coachTip: string;
  /** True only once the student has reached the objective themselves. */
  objectiveMet: boolean;
}

const replySchema = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    coachTip: { type: 'string' },
    objectiveMet: { type: 'boolean' },
  },
  required: ['reply', 'coachTip', 'objectiveMet'],
};

function missionSystem(m: Mission, mode: MissionMode, grade: string): string {
  const common =
    `You are playing a character in a spoken learning roleplay with a ${grade} student. ` +
    `Your character: ${m.persona}. Stay in character, with their mood and way of talking. ` +
    `The student's mission: ${m.objective} ` +
    'Reply in 1 to 3 short sentences that sound natural when spoken aloud. Never ask for personal information. ' +
    'Set objectiveMet to true only when the student has reached the mission objective themselves with correct reasoning. ';
  return mode === 'coach'
    ? common +
        'COACH MODE: you are also a kind mentor. Put teaching in coachTip, out of character and addressed to the student: ' +
        'if they made a mistake, gently show the fix; if they seem stuck, give the first step or two options to choose from; ' +
        'every few turns, ask a quick check question. Leave coachTip empty when no help is needed. Keep the roleplay moving.'
    : common +
        'CHALLENGE MODE: never give the answer or do the working for the student. If they ask you to just tell them, ' +
        'refuse in character and push them to try, for example by asking what the first step would be. ' +
        'If their answer is wrong, react in character as if it caused a problem, so they notice. coachTip is always empty.';
}

export async function personaReply(
  m: Mission,
  mode: MissionMode,
  grade: string,
  transcript: MissionTurn[],
): Promise<AiResult<PersonaReply>> {
  const recent = transcript.slice(-10);
  const prompt =
    'Conversation so far:\n' +
    recent.map((t) => `${t.role === 'student' ? 'Student' : 'You'}: ${t.text}`).join('\n') +
    '\n\nWrite your next reply.';
  return run<PersonaReply>(
    'Mission roleplay turn',
    { mode: InferenceMode.PREFER_ON_DEVICE, system: missionSystem(m, mode, grade), schema: replySchema },
    prompt,
  );
}

// ---------- Debrief (on-device) ----------

export interface Debrief {
  /** 1 struggled, 2 got there with some errors, 3 confident and correct without help. */
  score: number;
  takeaways: string[];
  summary: string;
}

export const RANKS: Record<number, { name: string; stars: string }> = {
  1: { name: 'Rookie', stars: '★☆☆' },
  2: { name: 'Skilled', stars: '★★☆' },
  3: { name: 'Master', stars: '★★★' },
};

export async function debriefMission(
  m: Mission,
  mode: MissionMode,
  grade: string,
  transcript: MissionTurn[],
): Promise<AiResult<Debrief>> {
  return run<Debrief>(
    'Mission debrief',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system:
        'You are a fair, encouraging teacher reviewing a learning roleplay. Score strictly: ' +
        '1 if the student struggled or needed the answer given to them, 2 if they got there with errors or hints, ' +
        '3 if they were correct and confident without help. Give exactly 3 short takeaways addressed to the student: ' +
        'what they did well and what to practise next. The summary is one sentence.',
      schema: {
        type: 'object',
        properties: {
          score: { type: 'integer', minimum: 1, maximum: 3 },
          takeaways: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
        required: ['score', 'takeaways', 'summary'],
      },
    },
    `${grade} student. Mode: ${mode}. Mission: ${m.objective} (skill: ${m.skill}).\n\nTranscript:\n` +
      transcript.map((t) => `${t.role === 'student' ? 'Student' : m.persona}: ${t.text}`).join('\n'),
  );
}

// ---------- Personalised mission for a weak skill (on-device) ----------

export async function createMission(
  subject: string,
  skill: string,
  grade: string,
  difficulty: Difficulty,
): Promise<AiResult<Mission>> {
  const props = {
    title: { type: 'string' },
    objective: { type: 'string' },
    persona: { type: 'string' },
    emoji: { type: 'string' },
    opening: { type: 'string' },
  };
  const r = await run<Omit<Mission, 'id' | 'subject' | 'difficulty' | 'skill'>>(
    'Create mission',
    {
      mode: InferenceMode.PREFER_ON_DEVICE,
      system:
        'You design short, fun roleplay missions where a student uses a school skill to help a character in a real-life situation. ' +
        'The objective is concrete and checkable, with any numbers needed included. The persona has a clear mood. ' +
        'The opening is the persona speaking first, in 1-2 sentences, presenting the problem. The emoji is one single emoji.',
      schema: { type: 'object', properties: props, required: Object.keys(props) },
    },
    `Design a ${difficulty.toLowerCase()} ${subject} mission for a ${grade} student that practises "${skill}".`,
  );
  return {
    ...r,
    data: { ...r.data, id: `custom-${Date.now()}`, subject, difficulty, skill, custom: true },
  };
}

// ---------- Mission log and XP (Firestore, per user) ----------

export interface MissionRecord {
  id: string;
  studentId: string;
  missionId: string;
  title: string;
  emoji: string;
  subject: string;
  skill: string;
  difficulty: Difficulty;
  mode: MissionMode;
  completed: boolean;
  /** 0 when not completed or in coach mode (practice). */
  score: number;
  xp: number;
  at?: { seconds: number };
}

const missionLog = (uid: string) => collection(db, 'users', uid, 'missions');

const DIFF_XP: Record<Difficulty, number> = { Easy: 10, Medium: 20, Hard: 30, Expert: 40 };

export function xpFor(difficulty: Difficulty, mode: MissionMode, completed: boolean, score: number): number {
  if (!completed) return 2;
  const base = DIFF_XP[difficulty];
  return mode === 'coach' ? Math.round(base / 2) : base * score;
}

export function saveMissionRecord(uid: string, r: Omit<MissionRecord, 'id' | 'at'>) {
  void addDoc(missionLog(uid), { ...r, at: serverTimestamp() });
}

export function watchMissionLog(uid: string, cb: (r: MissionRecord[]) => void): Unsubscribe {
  return onSnapshot(
    query(missionLog(uid), orderBy('at', 'desc'), limit(200)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MissionRecord, 'id'>) }))),
    (e) => console.error('Firestore missions:', e.message),
  );
}

export const LEVEL_XP = 100;

/** Total XP, level, and the best rank per mission for one student. */
export function missionStats(records: MissionRecord[], studentId: string) {
  const mine = records.filter((r) => r.studentId === studentId);
  const xp = mine.reduce((n, r) => n + (r.xp || 0), 0);
  const best: Record<string, number> = {};
  for (const r of mine) {
    if (r.completed) best[r.missionId] = Math.max(best[r.missionId] ?? 0, r.mode === 'challenge' ? r.score : 0.5);
  }
  return { xp, level: Math.floor(xp / LEVEL_XP) + 1, intoLevel: xp % LEVEL_XP, best, records: mine, streak: dayStreak(mine) };
}

/** Consecutive days (ending today or yesterday) with at least one mission. */
function dayStreak(records: MissionRecord[]): number {
  const days = new Set(records.filter((r) => r.at).map((r) => new Date(r.at!.seconds * 1000).toDateString()));
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(d.toDateString())) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
