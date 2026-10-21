# Overload — handoff prompt for Claude

> **Don't upload the zip or the whole `src/App.jsx` to Claude** — App.jsx is ~170,000 tokens, too big for one chat. Upload just this file; paste parts of App.jsx when Claude asks for them. The zip is your backup copy of everything.
>
> **How to use this:** start a new chat (ideally a claude.ai Project so these files stay attached), paste everything below the line as your first message, and attach the files listed under "Files to attach". After that, talk to Claude exactly like before: "fix X", "add Y". Claude will give you the exact changes; you paste them in and run `bash ship.sh "what changed"`.

---

You're picking up as the developer on **Overload**, my AI fitness-coach web app, mid-way through a long working session. Before this I worked with Claude Code, which could edit files and run commands itself. You can't, so I'll do the hands-on part. Act like you're continuing that same conversation: I tell you what to change, you change it, and I apply it.

## About me and how to work with me

- I'm a solo founder and **not technical**. I'm building followers on Instagram/TikTok before launching. Keep answers short, plain and natural. No jargon unless you explain it in a few words.
- **Only change what I ask.** No side changes, no "while I was there" refactors. If you spot something else worth fixing, tell me in one line and wait.
- **Never lose anyone's data.** An update must never reset or shrink a user's weight log, food log, workouts, program or Coach chat. Any change to how state is saved or loaded needs extra care.
- **Keep AI costs down.** Every AI call costs real money (Claude Sonnet 5: $2 per million input tokens, $10 per million output). Prefer doing things in code over extra AI calls.
- **Never put secrets in code** (API keys, passwords, tokens). The tester passwords are stored only as SHA-256 hashes; the plain list is in my private `tester-passwords.txt`, which is never committed.
- If something "could really affect the app" (payments, data, sign-in), explain the risk in one or two sentences and ask before doing it.

## How to give me changes (important)

`src/App.jsx` is huge: about 10,100 lines (600 KB). Never send back the whole file. Instead:

1. Tell me **which file** to open.
2. Give me an exact **"find this"** block: a few lines copied word-for-word from the current file, unique enough that Cmd+F finds exactly one match.
3. Give me the **"replace with"** block.
4. For a brand-new file, give the full contents.
5. If you need to see the current code first, ask me to paste a function by name (I'll Cmd+F it). Don't guess at code you haven't seen.
6. If a change needs a test, include it (tests live in `src/*.test.js(x)` and `api/*.test.js`, using Vitest + Testing Library).
7. Also give me one line to add to the "What happened in the last session" list at the bottom of `HANDOFF-FOR-CLAUDE.md` (and say if the "Where things are" list needs updating), so this file stays current for the next chat.
8. End with: `bash ship.sh "short description"`, and anything else I have to do by hand (e.g. a Supabase SQL step).

`ship.sh` (in the project folder) runs all the tests, builds, saves to GitHub, deploys to Vercel (with retries) and checks the live site. If tests fail, nothing deploys, and I'll paste you the failing lines.

I edit files in the project folder `~/Downloads/physique-coach-web 25` with a text editor (or VS Code), then run `ship.sh` in Terminal from that folder.

## What the app is

**Overload** is an installable web app (PWA) at **https://www.overload-app.com**: an AI personal trainer plus a nutrition tracker.

- **Quiz → program:** onboarding asks about goal, experience, equipment, days per week, session length, injuries, diet and favourite foods. The AI builds a personalized program (there's a rule-based fallback if the AI fails), plus calorie and macro targets. Quiz answers can be edited later without losing progress.
- **Train:** start a workout and log sets; checking off a set starts a rest timer with a chime/buzz. It shows last time's numbers and PRs, a History & PR line graph per exercise, exercise demo videos (WorkoutX GIFs), swaps/alternatives, and a share card when you finish. It keeps running in the background and resumes after the app is closed.
- **Fuel:** log meals by photo (AI estimate, with a "Not right? tell me what it is" fix box), by describing them ("2 eggs and toast"), or manually. "Suggest meals for what's left today" uses diet rules and favourite foods. Undo after a delete. Resets at local midnight.
- **Progress:** weigh-ins with a chart, lift charts, editable workout history, and AI weekly/monthly reviews.
- **Coach:** an AI chat that can answer questions or change the program (permanent change to one day, a whole new program, or a one-time change for the next session of a day). It also does nutrition targets, undo/restore, and reads all the user's logs. Replies stream in, typed out letter by letter.
- **You (Profile):** settings, review toggles, notification switches (workout reminders at 6pm local time, rest alerts with the app closed), subscription management, edit quiz answers, reset.
- **Paywall:** 7-day free trial, then Stripe subscription ($7.99/month or $59.99/year; promo codes allowed).
- **Under-18s** get a gentler plan by default (max 3 sets, no 1–5 rep work, higher calorie floor), and the AI tells them. They can ask for the standard plan.
- **Tester gate (pre-launch):** visitors see "Coming soon". Testers pick "Tester 1–15" and enter their own password. Each password works on up to 2 devices (browser plus the Home Screen app), then locks. My own password also still works. Set `DEV_GATE_ENABLED = false` in `src/DevGate.jsx` at launch.

## Tech stack

- **Frontend:** React 18 + Vite, built as a PWA with `vite-plugin-pwa` (service worker; `public/push-sw.js` handles push notifications). Nearly everything is in `src/App.jsx`. Charts use Recharts; icons use lucide-react.
- **Backend:** Vercel serverless functions in `/api` (Node). Vercel's Hobby plan allows at most **12 functions, and we're at 12**. A new endpoint means merging into an existing one or removing one. Test files `api/*.test.js` are excluded via `.vercelignore`.
- **Database and sign-in:** Supabase. Each user's whole app state (program, logs, chat, settings) is one JSON blob in table `app_state` (`user_id`, `state`, `updated_at`). Also: `profiles` (subscribed, trial_started_at, stripe_customer_id), `error_logs`, `exercise_gifs` (video cache), `exercise_alternatives` (cache), `ai_usage` (trial AI spending), `tester_devices`.
- **AI:** Anthropic `claude-sonnet-5` via `/api/claude` (the server holds the key, requires sign-in, and enforces model choice, a size cap, a per-account speed limit and the trial spending cap).
- **Payments:** Stripe Checkout plus a webhook (`/api/stripe-webhook`) that sets `profiles.subscribed`.
- **Push:** Web Push with VAPID keys (private key in the Vercel env `VAPID_PRIVATE_KEY`).
- **Vercel env vars:** ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_PRICE_ID_YEARLY, STRIPE_WEBHOOK_SECRET, WORKOUTX_API_KEY, ADMIN_SYNC_SECRET, VAPID_PRIVATE_KEY, CRON_SECRET.

## File map

- `src/App.jsx`: the whole app (see "Where things are" below).
- `src/main.jsx`: entry point; wraps the app in `<DevGate><ErrorBoundary><App/>`.
- `src/DevGate.jsx`: "Coming soon" gate plus the tester list.
- `src/push.js`: notification permission, subscription, rest-alert request, clearing old rest alerts.
- `src/restChime.js`: rest-timer sound and vibration. `src/shareCard.js`: the workout share image.
- `src/supabaseClient.js`: Supabase client.
- `api/claude.js`: AI proxy (sign-in, speed limit, size cap, trial cap, streaming pass-through).
- `api/exercise-gif.js`: demo-video lookup (cache, then fuzzy local match, then WorkoutX). Equipment must match (a machine exercise never shows a cable or barbell video).
- `api/gif-proxy.js`: streams GIFs with the WorkoutX key.
- `api/exercise-alternatives.js`: AI swap suggestions (cached; forced structured answer; the app also filters by injury and equipment).
- `api/rest-alert.js`: waits until a rest ends, then pushes "Rest's up" (up to 15 minutes, in 4½-minute legs; skipped if the user watched it finish in the app).
- `api/push-cron.js`: hourly; sends the 6pm local-time workout reminder. Triggered by GitHub Actions (`.github/workflows/push-cron.yml`, authenticated by GitHub's signed token) or by `CRON_SECRET`.
- `api/tester-unlock.js`: checks tester passwords and records devices.
- `api/create-checkout-session.js`, `api/create-portal-session.js`, `api/stripe-webhook.js`: Stripe (sign-in required).
- `api/admin-set-gif.js`, `api/sync-exercise-catalog.js`: admin tools behind `ADMIN_SYNC_SECRET`.
- `supabase-*.sql`: database setup and migrations (run in the Supabase SQL Editor).
- `evals/coach.eval.jsx` (47 live Coach scenarios), `evals/features.eval.jsx` (45 live checks of programs, meal estimates, suggestions, reviews and alternatives), `evals/run-all.sh`. They cost real API money; run them with my Anthropic key only when I ask.
- `ship.sh`: test, build, push, deploy, verify.

## Where things are in `src/App.jsx` (search by name; line numbers drift)

- **AI plumbing:** `claudeChat` (forced "respond" tool, streaming, 60s timeout, 402 → trial-limit message), `unwrapToolInput` (peels off a made-up wrapper key the model often adds), `parseJSONLoose`, `estimateCostCents`.
- **Coach:**
  - `sendCoachMessage` (inside `App`) is the whole send/apply flow. A plain "undo" message is handled without AI. `guardTextFor` merges a short follow-up with the original request.
  - `buildCoachStaticSystem` / `buildCoachStaticSystemFull` / `COACH_COMPACT_RULES`, plus the `COACH_*_RULES` constants. The rulebook is cached for 1 hour; the compact version is off (`COACH_PROMPT_VERSION = "full"`).
  - `buildCoachSystem` is the per-account context. Related: `coachDayContextText`, `coachLogSummary`, `foodPreferenceText` + `DIET_RULES`.
  - `sanitizeCoachResponse` contains the deterministic guards:
    - removes exercises that load a body part the message says hurts (`injuriesMentioned`, `withoutInjuryLoading`)
    - enforces "only dumbbells" / "bodyweight only", including Spanish (`equipmentAskedFor`, `usesOnly`)
    - rejects a program with the wrong number of days asked for (`daysAskedFor`)
    - applies the under-18 caps
    - finds a reply put in the wrong field (`coachReplyField`)
  - `resolveOverrideTarget` (+ `daysNamedIn`) decides which day a one-time change lands on: the named day, or the day whose muscles match.
  - `normalizeExerciseCount`, `padToMinimum`, `asksForShorter`, `programTrimNote` handle exercise counts. A one-time change keeps the day's length unless they ask for less, and program changes never cut below a day's current length.
  - `withUndoSnapshot` / `applyCoachUndo` / `isPlainUndoRequest`.
- **Programs:** `generateProgramWithRetry` (one retry if unusable), `acceptGeneratedProgram` (validates; removes injury-loading and wrong-equipment exercises), `buildProgramGenSystem`, `buildProgram` (rule-based fallback), `POOLS`, `INJURY_EXCLUDES`, `filterPool`, `loadsInjury`, `calcTargets`, `planSetsRest`, `isUnder18` / `gentlePlan`.
- **Food:**
  - `Fuel` component, `MEAL_TEXT_SYSTEM` / `MEAL_PHOTO_SYSTEM`, `cleanAiMeal`, `mealNameFromDescription`, `photoFixMessages`.
  - Suggestions: `buildMealSuggestionSystem`, `mealSuggestionUserMessage` (clamps negatives; "light options" once over target), `mealSuggestionsFrom` + `parseLooseList`.
  - `sanitizeMeal`, `mealNumber`, `UndoBar`.
- **Workout:** PR toast logic is in `toggleDone` inside `WorkoutSession` (uses `exercisePR` + `bestDoneSet`); `ExerciseDetailSheet` takes `todayLogged`. `startWorkout` (inside `App`; a saved workout untouched for 2+ hours asks "Did you forget to finish this one?" — `isStaleWorkout`, `finishStaleWorkout` saves it dated the day it was done), `resumeTiming` (the clock stops at the last action after 2 hours away), `WorkoutSession`, `RestTimer` (marks a rest "seen" when it finishes on screen), `ExerciseDetailSheet` (History & PR graph), `exerciseHistory`, `exercisePR`, `fetchExerciseGif`, `fetchSimilarExercises` (filters by injury and equipment), `GIF_CACHE_VERSION` / `withoutEquipmentGifs`.
- **Reviews:** `buildReviewSystem`, `summarizeReviewPeriod`, `reviewFromParsed`, `ReviewCard`.
- **Saving and sync:**
  - `persist` (inside `App`; logs any shrink of meals, weigh-ins or workouts to `error_logs`), `saveState` (queued writes; refreshes an expired sign-in and retries), `loadState`, `fetchNewerState` (picks up another device's saves when the app returns to the front, never over unsaved local changes).
  - Pending-sync flags, `writeLocalState`, `isAuthError`.
  - The yellow banner says "Offline" only when the phone really is offline; otherwise "still syncing".
- **Quiz:** `QUIZ_STEPS` (age 13–90 and weight 60–500 enforced via `quizNumberProblem`), `Onboarding`, `QuizEditor`.
- **Other:** `ProfileTab`, `NotificationSettings`, `Progress` (weigh-in validation 60–700 lb), `WorkoutHistoryEditor`, `ErrorBoundary`.

## Things I (the owner) still have to do

(Steps 1–3 were done on 2026-10-14; step 4 too — the reminders file is in GitHub and a manual run succeeded.)

1. **Supabase SQL Editor:** run `supabase-migration-ai-usage.sql` (turns on the server-side trial AI cap; make sure my own account has `subscribed = true` in `profiles`, or I'll hit the cap while testing).
2. **Supabase SQL Editor:** run `supabase-migration-tester-devices.sql` (turns on the tester device lock). To free a tester's devices: `delete from public.tester_devices where tester = 3;`.
3. **GitHub:** add `.github/workflows/push-cron.yml` through the website (Add file → Create new file; paste the contents). My saved GitHub login can't push workflow files. Without it, the 6pm workout reminders never send.
4. **Anthropic console:** delete the API key I pasted into the last chat.
5. **At launch:** set `DEV_GATE_ENABLED = false` in `src/DevGate.jsx`.

## Known limits / ideas not done

- The meal-photo AI wasn't tested against real photos (no test images); text descriptions were tested thoroughly.
- The compact Coach rulebook (about 15% cheaper) is built but switched off; it needs another live comparison before switching.
- iPhone push only works once the app is added to the Home Screen (iOS 16.4+). Real delivery hasn't been tested on a phone yet.
- At the 12-function Vercel limit.
- Possible future work: Apple Watch/Garmin sync, streak/PR badges, a server-side check before writes (true conflict-proof multi-device saving).

## What happened in the last session (most recent first)

- "Next day" everywhere (Home, Coach, reminders) is now the day after the one trained most recently (`nextDayIndexFor` in App.jsx, `nextDayIndex` in api/push-cron.js), not total-workouts-modulo-days (which drifted when days were done out of order).
- Reminders survive GitHub skipping runs (only ~40 of ~140 hourly runs happened in 6 days): with the `push_sent` table (supabase-migration-push-sent.sql), a reminder goes out on the first run anywhere in its window (workout 6–11pm, weigh-in hour +4) and is recorded so it's never sent twice; without the table, exact hour only. Workout reminders can be limited to chosen weekdays (`push.reminderDays`, day picker on the You page).
- Coach rule: it can't see which exercises have videos — it uses exactly the exercise/variation asked for ("Machine Seated Calf Raise") and never claims one has no video (real report: it renamed to "Calf Raise" and said there was no video).
- Coach model split (2026-10-20): `coachUsesLightModel(message, profile, chat)` sends plain questions/chat to `LIGHT_MODEL` (Haiku) and anything that could change the program, days, calories or targets, anything about pain/injury, food questions when they have a diet rule, and short answers to the Coach's own question to `claude-sonnet-5`. Safety net in `sendCoachMessage`: if the Haiku answer would make a change, it's discarded and Sonnet is asked. Live test: 23/24 for 23.6¢. Haiku alone on the Coach was tested and rejected (meat to a vegetarian, guessed days).
- Meal ideas are filtered against diet rules in code (`breaksDiet`, `DIET_BANS`, inside `mealSuggestionsFrom(parsed, profile)`), whichever model wrote them.
- Video swap picks the closest match (word overlap, minus a penalty for repeating a movement the day already has); "Reverse Flye" counts as a rear-delt fly.
- `usesOnly(name, "dumbbell")` treats barbell-by-default lifts (overhead press, bench press, deadlift, back/front squat, hip thrust…) as not dumbbell unless the name says dumbbell/goblet/kettlebell.
- AI cost cuts (2026-10-17): (1) meal estimates/photos/photo fixes, meal ideas, reviews and exercise alternatives use the cheaper `claude-haiku-5-5` (`LIGHT_MODEL`, ~1/20th the price); the server allows only `MODEL` or `LIGHT_MODEL` and retries a refused cheap call on `MODEL`. Coach and program building stay on `claude-sonnet-5`. (2) Subscribers have a fair-use limit of 25¢/day (`SUBSCRIBER_DAILY_CAP_CENTS` in api/claude.js; 402 `daily-ai-limit` → `DAILY_LIMIT_MESSAGE`); trial stays 15¢/day, 75¢/month; emails in the Vercel env `UNCAPPED_EMAILS` (the owner) are never capped. (3) Coach uses the compact rulebook (`COACH_PROMPT_VERSION = "compact"`; set "full" to go back) — kept in sync with the newest rules.
- iPhone: the tab bar and Resume bar no longer move when scrolling — on phones the page scrolls inside `.app-main` and `.app-shell` is fixed (CSS in `SHELL_CSS`; desktop unchanged).
- Workout screen: the X is now a down arrow ("Minimize workout") that saves and tucks the workout away (Resume bar brings it back); "Discard workout" sits under Finish (still a 2-step confirm). The old exit menu is gone.
- Tap the workout clock to set the time (`onAdjustTime` → `adjustWorkoutTime` in App).
- Notes per exercise ("Note for next time"), shown every time that exercise comes round until cleared: `state.exerciseNotes[normalizeGifKey(name)]`, props `notes`/`onSaveNote` on `WorkoutSession`.
- Progress: lift progress is grouped by workout day (day chips → exercise chips → graph); same exercise under different names merged: `exerciseGroupsByDay`, `ExerciseProgress`.
- PR toast also fires when a checked-off set is corrected to a new best (`checkForPR` in `WorkoutSession`, called from `toggleDone` and `updateSet`).
- Notifications: 4 kinds, each with its own switch on the You page (`NOTIFICATION_KINDS`): workout reminders (6pm), rest alerts, weigh-in reminder (hour picker, `push.weighInHour`, default 8am), and "Forgot to finish?" (a workout quiet for 40–100 min gets one nudge). Server: `weighInFor`, `idleWorkoutFor`, `notificationsFor` in api/push-cron.js. New last quiz step "Which notifications do you want?" (`profile.notifications`); after onboarding a Home card (`NotificationPrompt`) turns them on with one tap (phones need a tap for the permission prompt).
- In-workout PR toast now also has to beat sets done earlier in the same workout (40x10 then 40x7 both said "new PR"). `bestDoneSet`.
- History & PR: the graph always shows (it needed 2+ past sessions before), today's best checked-off set is added as "Today", and a rep tie goes to the bigger set (30x10/30x12 showed PR 30x10). History only counts checked-off sets.
- Every exercise the Coach adds must have a demo video: `ensureVideoExercises` (in `sanitizeCoachResponse`) swaps any new exercise that isn't on the video-confirmed list (`POOLS`), hasn't got a found video in `gifCache`, isn't already in their program, and wasn't asked for by name — for a same-muscle, right-equipment exercise, preferring a different movement than the day already has. The reply says what was swapped.
- "Chest-Supported Row" removed from the dumbbell pool (no video; same movement as Dumbbell Row) → "Dumbbell Shrug"; Coach rules now say one row variation per day.
- The swap picker uses the equipment the WORKOUT uses (`impliedEquipment`), not just the profile — a day switched to dumbbells no longer offers machine swaps; saved alternatives are filtered the same way.
- SETUP-GUIDE.md added (owner's plain-English setup and workflow).
- A workout left open for hours now asks: finish & save it (with its real time, dated the day it was done), keep going, or discard (two taps). Real report: left open a whole day, showed 45 min, and would have been filed under the wrong day.
- The 6pm reminders GitHub file is added and verified (manual run: Success). Owner steps 1–4 below are done except deleting the pasted API key.
- **Live AI test marathon** (about $5 of API credit). Found and fixed:
  - Half of AI-built programs were being thrown away for the generic fallback, because the AI wrapped them in an extra key (now unwrapped everywhere).
  - Programs ignored injuries.
  - Meal suggestions failed when over calories, or when the list arrived as text.
  - Exercise alternatives failed about a third of the time.
  - Coach program changes cut exercises nobody asked to remove.
  - A profile with "no injuries" plus a sore knee mentioned in chat skipped the injury filter.
  - Under-18 limits weren't enforced on Coach changes.
  - Spanish requests weren't understood; a short follow-up lost the original request.
  - Final results: Coach 47/47 scenarios after fixes; other AI features 42–45/45 (the rest were test strictness).
- 15 tester passwords with a device lock.
- False "Offline" banner fixed (it was an expired sign-in, not the connection).
- One rest notification at a time; no alert if you watched the rest finish; old alerts cleared when you check off the next set.
- Demo videos must match equipment (machine lateral raise was showing a cable one); old wrong links are re-checked.
- A one-time change goes on the day you name, or the day its exercises belong to (a dumbbell Pull change had landed on Push).
- History & PR is now a line graph.
- Photo estimates can be corrected ("greek yogurt, not sour cream"); meal names are editable.
- Checkout requires sign-in.
- Coach replies type out letter by letter.
- Server-side trial AI spending cap.
- Earlier: workout reminders and rest alerts via push; two-device data protection; undo for deleted meals and weigh-ins; quiz/weigh-in validation; midnight rollover; empty-workout confirm; message size and speed limits; diet rules spelled out (vegetarian was getting meat); plain "undo" without AI; sore-body-part guard; dumbbell-only guard.

When I next message you, just continue from here.
