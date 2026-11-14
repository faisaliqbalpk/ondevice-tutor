# Nano Tutor

A private, offline-capable tutor for students, built with **Firebase AI Logic hybrid inference**.

Nano Tutor marks photos of answer sheets, remembers each student's strengths and gaps, writes practice quizzes on their weakest skills, and talks through mistakes by voice. Students' work is read by **Gemini Nano on the device**. The cloud is used only for things the device can't do well, and every cloud request is shown in a privacy ledger.

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/).

## How it uses hybrid inference

Each task picks its inference mode on purpose:

| Task | Mode | Why |
| --- | --- | --- |
| Onboarding interview (adaptive, spoken) | `PREFER_ON_DEVICE` | A student's answers about themselves and their level stay on the device |
| Create an assessment / mark short answers | `PREFER_ON_DEVICE` | Teachers can build and mark tests offline |
| Mark an answer sheet photo | `ONLY_ON_DEVICE`, cloud only after explicit consent | Children's handwriting and names should not leave the device |
| Generate a practice quiz | `PREFER_ON_DEVICE` | Works offline in classrooms with no signal |
| Voice tutor conversation | `PREFER_ON_DEVICE` | Fast, private, free. Chat history and the student's skill profile are stitched into each prompt, because on-device generation is single-turn |
| "Why was I wrong?" deep explanation | `PREFER_IN_CLOUD` | Benefits from a larger model. Sends only the skill, question and answers, never names or photos |
| Study plan | `PREFER_IN_CLOUD` | Sends only an anonymous summary: grade, placement levels and skill scores |

Every response shows an **On-device** or **Cloud** badge, read from `response.inferenceSource`. The **Privacy** tab lists every request that ran in the cloud and the exact text that was sent.

The Firebase AI Logic calls live in [`src/lib/ai.ts`](src/lib/ai.ts) and [`src/lib/tutor.ts`](src/lib/tutor.ts). The on-device and cloud paths share one JSON Schema per task: it is passed to Nano as `responseConstraint` and to Gemini as `responseJsonSchema`.

## Features

- **Onboarding interview:** the student picks subjects and says what they find hard. Nano then runs a short spoken placement interview, adapting difficulty after each answer, and sets a level per subject (needs support, on track, ahead).
- **Study plan:** a 2-week plan written in the cloud from the anonymous placement summary.
- **Assessments:** Nano writes multiple-choice and short-answer tests for a subject, topics and level. Take them on screen (short answers are marked on-device), print them with or without an answer key, or mark the paper copies with a photo using the saved key.
- **Mark sheet:** photo of an answer sheet plus an answer key. Nano reads each answer, marks it, tags the skill, flags low-confidence readings, and gives short feedback.
- **Skill memory:** a per-student profile of recent mastery per skill, stored in Firestore with offline persistence. No photos are stored.
- **Practice:** a 5-question quiz targeting the two weakest skills and recent mistakes, with hints.
- **Tutor:** push-to-talk voice conversation using the browser's speech recognition (on-device where Chrome supports it) and speech synthesis.
- **Alerts:** raised when a skill drops below 50%, falls by 30 points, or is newly mastered.
- **Privacy ledger:** a local log of everything that left the device.

## Run it

Requirements: Node 20+, a Firebase project, and desktop Chrome 139+ for on-device inference.

1. In the [Firebase console](https://console.firebase.google.com/), create a project and a web app.
2. Enable **AI Logic** with the Gemini Developer API, **Authentication** with the Anonymous provider, and **Firestore**.
3. Enable **App Check** with reCAPTCHA Enterprise and enforce it for AI Logic.
4. Copy `.env.example` to `.env.local` and fill in your web app config and reCAPTCHA site key.
5. Install and run:

   ```sh
   npm install
   npm run dev
   ```

6. In local development, the console prints an App Check debug token. Add it under App Check > Manage debug tokens.

### Turn on Gemini Nano in Chrome

1. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, set it to **Enabled**, and restart Chrome.
2. In Nano Tutor, click **Prepare on-device AI**. The first download can take a few minutes.

Without the flag the app still works, using the cloud model. Marking a photo then asks for consent before sending it.

### Deploy

```sh
npm install -g firebase-tools
firebase login
firebase use --add
npm run deploy
```

## Tech stack

Vite, React, TypeScript, Firebase AI Logic (`firebase/ai`) with hybrid inference, Gemini Nano via Chrome's Prompt API, App Check, Anonymous Auth, Firestore with offline persistence, Firebase Hosting.

## Acknowledgements

Feature ideas were inspired by [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) (Apache-2.0). No code was copied; this project was written from scratch during the hackathon.

## License

[Apache 2.0](LICENSE)
