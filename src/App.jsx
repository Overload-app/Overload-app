import React, { useState, useEffect, useRef } from "react";
import {
  Dumbbell, Utensils, TrendingUp, User, Check, Plus, X, Flame,
  ChevronRight, ChevronLeft, Award, RotateCcw, Home as HomeIcon,
  Beef, Wheat, Droplet, Scale, Sparkles, Zap, MessageCircle,
  Send, Camera, Loader2, AlertCircle, SkipForward, PlusCircle, LogOut, Info, Repeat, Clock,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { supabase } from "./supabaseClient.js";

/* ============================================================
   DESIGN TOKENS
============================================================ */
// How many past program/target versions to keep for the Coach's undo/revert
// feature. Higher = less likely someone's true original ever gets evicted.
const PROGRAM_HISTORY_LIMIT = 30;

const T = {
  // Design refresh: background/sidebar/accent tokens moved to the requested
  // values (off-white background, near-black sidebar, vibrant-violet
  // accent). All three are close enough to the previous values that nothing
  // downstream needed re-tuning: paper got lighter (contrast against it can
  // only improve), ink is still near-black either way, and the new charge
  // still clears white-on-charge button contrast (5.7:1) and the new
  // chargeDeep still clears text-on-lavender contrast (7.2:1) — verified
  // with the same WCAG math used for steelDark below, not just eyeballed.
  ink: "#0D0E15",
  paper: "#F3F4F6",
  card: "#FFFFFF",
  steel: "#DADFE0",
  // Real contrast failure found from beta-tester feedback ("some grey text
  // can't actually be seen") — the old #AEB6B8 was only 2.06:1 against
  // white, less than half WCAG AA's 4.5:1 minimum for normal text. This is
  // used for secondary/label text all over the app (timestamps, sub-labels,
  // "how to do it" tips, etc.), so a single token fix covers it everywhere.
  steelDark: "#5B6470",
  charge: "#5B46F6",
  chargeDeep: "#4531C7",
  protein: "#E0483E",
  carb: "#E8A23D",
  fat: "#3E8FE0",
  good: "#1F9E6E",
  warn: "#D97706",
};

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');`;

const SHELL_CSS = `
  @keyframes pulseDot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.7); } }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .spin { animation: spin 1s linear infinite; }
  html, body, #root { height: 100%; margin: 0; }
  body { background: ${T.ink}; }
  * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
  @media (max-width: 639px) { input, select, textarea { font-size: 16px !important; } }

  .fullscreen-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; height: 100vh; height: 100dvh; }

  /* Auth-style screens (login, paywall, onboarding): always full-bleed,
     no card/frame, on every screen size — same on desktop as on mobile. */
  .auth-screen { min-height: 100vh; min-height: 100dvh; width: 100%; }
  .auth-screen-outer { min-height: 100vh; min-height: 100dvh; width: 100%; }

  /* Main app: bottom tab bar + full-bleed on phones, a real sidebar layout
     using the whole screen on anything roomier. */
  .app-shell { min-height: 100vh; min-height: 100dvh; width: 100%; background: ${T.paper}; }
  .app-main { padding-bottom: 90px; }
  .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; width: 100%; background: #fff; border-top: 1px solid ${T.steel}; display: flex; padding: 8px 4px calc(8px + env(safe-area-inset-bottom, 0px)) 4px; box-sizing: border-box; z-index: 40; }
  .sidebar-nav { display: none; }

  /* Coach tab: a fixed panel independent of any page content above it
     (banners, etc.) so the input box can never get pushed off-screen. */
  .coach-panel { position: fixed; top: 0; left: 0; right: 0; bottom: calc(64px + env(safe-area-inset-bottom, 0px)); background: ${T.paper}; z-index: 30; display: flex; flex-direction: column; }

  /* Resume-workout bar: pinned to the bottom of the screen, above the tab
     bar, visible on any tab — same idea as Hevy's persistent resume bar. */
  .resume-bar { position: fixed; right: 16px; bottom: calc(150px + env(safe-area-inset-bottom, 0px)); z-index: 45; }

  @media (min-width: 900px) and (min-height: 600px) {
    .app-shell { display: flex; }
    .sidebar-nav {
      display: flex; flex-direction: column; width: 240px; flex-shrink: 0;
      background: ${T.ink}; min-height: 100vh; min-height: 100dvh; padding: 28px 16px;
      position: sticky; top: 0;
    }
    .bottom-nav { display: none; }
    .app-main { flex: 1; padding-bottom: 40px; }
    .app-main-inner { max-width: 880px; margin: 0 auto; width: 100%; }
    .coach-panel { left: 240px; bottom: 0; }
    .resume-bar { right: 28px; bottom: 100px; }
  }
`;

/* ============================================================
   CLAUDE API HELPERS
============================================================ */
export const OFFLINE_MESSAGE = "No internet connection — try again once you're back online.";

function offlineError() {
  const err = new Error(OFFLINE_MESSAGE);
  err.offline = true;
  return err;
}

export async function claudeChat({ system, messages }) {
  // Deliberately NOT gated on navigator.onLine — it's a browser-reported
  // flag, not a real connectivity check, and real report: a user got "No
  // internet connection" while genuinely online (known flaky behavior,
  // especially on mobile/PWA after the tab was backgrounded). The actual
  // fetch() below is the real test; its catch block already produces the
  // identical offlineError() for a genuine connectivity failure, so gating
  // here first only added a way to be wrong, never a way to be right sooner.
  let res;
  try {
    res = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 6000, system, messages }),
    });
  } catch (networkErr) {
    // fetch() itself throws (rather than resolving with a bad status) for a
    // genuine connectivity failure — DNS, connection refused, offline —
    // as opposed to the server responding with an HTTP error.
    throw offlineError();
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch (e) {}
    throw new Error(detail || `API error ${res.status}`);
  }
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

export function parseJSONLoose(text) {
  let clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
  // The model is instructed to return only JSON, but sometimes adds a stray
  // sentence before or after it anyway — pull out just the {...} block
  // rather than requiring the entire response to be pure JSON.
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    clean = clean.slice(start, end + 1);
  }
  return JSON.parse(clean);
}

// If the full response got cut off (e.g. a very large program rewrite hit the
// length limit), the JSON won't parse — but "reply" is always written first
// and is almost always complete even when the tail of the response wasn't.
// Pull it out directly with a regex instead of showing the raw broken JSON.
export function extractReplyOnly(text) {
  const match = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch (e) {
    return match[1];
  }
}

// What the Coach's parsed JSON response actually DOES, independent of what its
// "reply" text claims — shared by the fallback-reply text below and by the
// persist logic that applies the change, so the two can never disagree about
// whether a given turn was a real, lasting change.
export function coachResponseFlags(parsed) {
  const hasOverride = Array.isArray(parsed.todayOverride) && parsed.todayOverride.length > 0;
  const t = parsed.targets;
  const hasValidTargets = !!t && [t.calories, t.protein, t.carbs, t.fat].every((n) => typeof n === "number" && n > 0);
  const hasNewProgram = !!(parsed.program && Array.isArray(parsed.program.days) && !hasOverride);
  const restoreIdx = typeof parsed.restoreIndex === "number" ? parsed.restoreIndex : null;
  const restoreOriginal = parsed.restoreOriginal === true;
  const madeChange = hasOverride || hasValidTargets || hasNewProgram || restoreOriginal || restoreIdx !== null;
  return { hasOverride, hasValidTargets, hasNewProgram, restoreIdx, restoreOriginal, madeChange };
}

// Falling back to a confident "Done!" whenever the model left "reply" blank
// used to be misleading on exactly the turn where it mattered most: if the
// response ALSO didn't set program/todayOverride/targets/restore, nothing
// actually changed, and "Done!" told the user otherwise anyway — a plausible
// root cause for a report like "the coach said done but the exercise I asked
// to remove is still there." Only claim success by default when a real
// change is actually present in this response.
export function coachReplyText(parsed, madeChange) {
  return (parsed.reply && parsed.reply.trim())
    || (madeChange ? "Done!" : "Hmm, I didn't quite catch that — mind rephrasing what you'd like changed?");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Downscales + re-encodes a captured photo as JPEG before it ever leaves the
// device — faster to upload/analyze on a normal connection, and small
// enough to safely sit in localStorage's limited quota while queued for
// offline analysis (a raw phone photo can be several MB; this keeps it to
// roughly 50-200KB).
function compressImageToBase64(file, maxDim = 1024, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
    };
    img.onerror = (e) => { URL.revokeObjectURL(objectUrl); reject(e); };
    img.src = objectUrl;
  });
}

const MEAL_PHOTO_SYSTEM = "You analyze photos of meals for a fitness app. Estimate the food and its nutrition. Respond ONLY with JSON, no markdown fences: {\"name\": \"<short meal name>\", \"cal\": <number>, \"protein\": <number>, \"carb\": <number>, \"fat\": <number>, \"note\": \"<one short caveat about the estimate, under 15 words>\"}";

// One-time smart backfill for the "Find alternative" swap picker, used only
// when an exercise doesn't already have AI-sourced alternatives baked in
// (e.g. a program saved before this existed) — new programs get these
// written directly into the program data, so this live call is the
// exception, not the normal path. Falls back to the coarser pool-based
// matching (alternativesFor) at the call site if this fails or is offline.
// One-time lookup for the mid-workout "How to do it" demo GIF, powered by
// WorkoutX's exercise database (free tier: 500 requests/month, so this is
// deliberately lazy — only called the first time someone actually opens
// the tips section for a given exercise, never eagerly at program-
// generation time, and the result gets cached onto the exercise itself so
// the same exercise never costs a second request). Returns null (not a
// thrown error) for "no GIF available" in every case — offline, not
// found, quota exhausted — so the UI can show one honest fallback message
// ("Instructional video unavailable") regardless of which of those it was.
// Returns { gifUrl, confirmed }. "confirmed" is the important part: only a
// genuine WorkoutX response (found or a real empty match) is confirmed —
// everything else (offline, a bad/missing key, quota, a network error) is
// NOT confirmed. The caller should only ever permanently cache a confirmed
// result; caching an unconfirmed failure would mean a transient problem
// (like a key that wasn't wired up correctly yet) becomes a PERMANENT
// "no GIF" for that exercise, with no way to ever retry once the real
// problem is fixed — which is exactly the bug this replaces.
// Cache key for the GLOBAL, account-wide GIF cache (state.gifCache) — real
// usage data showed "Barbell Bench Press" fetched 3 separate times because
// the cache lived on each individual exercise OBJECT, so the same exercise
// name appearing on more than one day of the program (extremely common —
// most splits repeat a muscle group at least once a week) each had their
// own independent, uncached slot. Keying by normalized name instead makes
// it truly "ask WorkoutX for this exercise at most once, ever."
export function normalizeGifKey(name) {
  return (name || "").trim().toLowerCase();
}

// A plain <img src> pointed straight at WorkoutX's own URL rendered as a
// broken image — their asset URLs need the same X-WorkoutX-Key auth as the
// search endpoint, which a browser-issued <img> request has no way to
// attach. This routes it through api/gif-proxy.js instead, which fetches
// the real bytes server-side (with the key) and streams them back.
export function gifProxyUrl(rawUrl) {
  return rawUrl ? `/api/gif-proxy?url=${encodeURIComponent(rawUrl)}` : rawUrl;
}

export async function fetchExerciseGif(name) {
  if (!navigator.onLine) return { gifUrl: null, confirmed: false };
  try {
    const res = await fetch(`/api/exercise-gif?name=${encodeURIComponent(name)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.warn(`Exercise GIF lookup failed for "${name}": ${res.status}`, data?.error, data?.detail);
      return { gifUrl: null, confirmed: false };
    }
    if (data?.matchCount === 0) {
      console.warn(`Exercise GIF lookup: no WorkoutX match for "${name}"`);
    }
    return { gifUrl: data?.gifUrl || null, confirmed: true };
  } catch (e) {
    console.warn(`Exercise GIF lookup threw for "${name}":`, e.message);
    return { gifUrl: null, confirmed: false };
  }
}

export async function fetchSimilarExercises(name, equipment, injuries) {
  const equipDesc = equipment === "full" ? "a fully-equipped gym (barbells, dumbbells, machines, cables)" : equipment === "dumbbell" ? "dumbbells only" : "bodyweight only, no equipment";
  const system = `You are a knowledgeable strength coach. Given a specific exercise, suggest exactly 3 genuinely similar alternative exercises — same primary muscle emphasis AND a comparable movement pattern (don't suggest an isolation exercise as an alternative to a compound lift, or vice versa, and don't suggest something just because it's "the same body part"). Respond ONLY with JSON, no markdown fences: {"alternatives": ["<exercise name>", "<exercise name>", "<exercise name>"]}`;
  const userMsg = `Exercise: ${name}. Available equipment: ${equipDesc}. Injuries/areas to avoid: ${(injuries || []).join(", ") || "none"}.`;
  const raw = await claudeChat({ system, messages: [{ role: "user", content: userMsg }] });
  const parsed = parseJSONLoose(raw);
  return Array.isArray(parsed.alternatives) ? parsed.alternatives : [];
}

/* ============================================================
   EXERCISE POOLS
============================================================ */
export const POOLS = {
  full: {
    chest: ["Barbell Bench Press", "Incline Dumbbell Press", "Cable Fly", "Weighted Dip"],
    back: ["Barbell Row", "Lat Pulldown", "Seated Cable Row", "Pull-Up"],
    shoulders: ["Overhead Press", "Dumbbell Lateral Raise", "Face Pull", "Rear Delt Fly"],
    // "Barbell Squat", not "Back Squat" — confirmed from WorkoutX's own docs
    // example response ("name": "barbell squat"). "Back Squat" is a common
    // gym term but not what WorkoutX's database actually calls it, so it
    // was a genuine synonym mismatch, not something the name-cleanup/
    // fallback-search logic in api/exercise-gif.js could ever fix on its
    // own (those only strip qualifiers/equipment prefixes, they don't
    // rewrite to a different word). Real report: "back squat should be
    // something that has an instructional vid."
    legs: ["Barbell Squat", "Romanian Deadlift", "Leg Press", "Walking Lunge", "Leg Curl", "Leg Extension", "Calf Raise"],
    biceps: ["Barbell Curl", "Hammer Curl", "Incline Dumbbell Curl"],
    triceps: ["Tricep Pushdown", "Skull Crusher", "Overhead Cable Extension"],
    core: ["Hanging Leg Raise", "Cable Crunch", "Ab Wheel Rollout", "Plank"],
  },
  dumbbell: {
    chest: ["Dumbbell Bench Press", "Dumbbell Incline Press", "Dumbbell Fly", "Dumbbell Floor Press"],
    back: ["Dumbbell Row", "Renegade Row", "Dumbbell Pullover", "Chest-Supported Row"],
    shoulders: ["Dumbbell Shoulder Press", "Dumbbell Lateral Raise", "Dumbbell Rear Delt Fly", "Arnold Press"],
    legs: ["Dumbbell Goblet Squat", "Dumbbell Romanian Deadlift", "Dumbbell Walking Lunge", "Bulgarian Split Squat", "Dumbbell Step-Up", "Dumbbell Calf Raise"],
    biceps: ["Dumbbell Curl", "Dumbbell Hammer Curl", "Incline Dumbbell Curl"],
    triceps: ["Dumbbell Overhead Extension", "Dumbbell Kickback", "Close-Grip Floor Press"],
    core: ["Dumbbell Russian Twist", "Dumbbell Side Bend", "Plank", "Reverse Crunch"],
  },
  bodyweight: {
    chest: ["Push-Up", "Incline Push-Up", "Decline Push-Up", "Wide Push-Up"],
    back: ["Pull-Up", "Inverted Row", "Superman Hold", "Towel Row"],
    shoulders: ["Pike Push-Up", "Wall Handstand Hold", "Y-Raise", "Plank Shoulder Tap"],
    legs: ["Bodyweight Squat", "Walking Lunge", "Bulgarian Split Squat", "Glute Bridge", "Wall Sit", "Calf Raise"],
    biceps: ["Chin-Up", "Towel Curl Hold", "Doorframe Row"],
    triceps: ["Diamond Push-Up", "Bench Dip", "Tricep Push-Up"],
    core: ["Plank", "Bicycle Crunch", "Leg Raise", "Mountain Climbers"],
  },
};

// A real, plain-name vocabulary to hand the AI as a preferred reference —
// reusing these exact spellings (rather than the AI inventing its own
// phrasing each time) both keeps naming consistent across a program and
// tends to match the exercise-demo database better, since these are
// already known-good, unqualified names.
export function exerciseVocabularyFor(equipment) {
  const pool = POOLS[equipment];
  if (!pool) return [];
  return [...new Set(Object.values(pool).flat())];
}

export const INJURY_EXCLUDES = {
  knees: ["Squat", "Lunge", "Leg Press", "Leg Extension", "Step-Up", "Split Squat", "Wall Sit"],
  shoulders: ["Overhead Press", "Lateral Raise", "Dip", "Push-Up", "Handstand", "Pike Push-Up", "Rear Delt Fly", "Y-Raise", "Arnold Press"],
  lower_back: ["Deadlift", "Row", "Good Morning"],
  wrists: ["Push-Up", "Plank", "Handstand"],
  elbows: ["Curl", "Extension", "Skull Crusher", "Kickback", "Tricep"],
};

export function filterPool(pool, injuries) {
  if (!injuries || injuries.length === 0 || injuries.includes("none")) return pool;
  const terms = injuries.flatMap((i) => INJURY_EXCLUDES[i] || []).map((t) => t.toLowerCase());
  const out = {};
  Object.keys(pool).forEach((group) => {
    let list = pool[group].filter((name) => !terms.some((t) => name.toLowerCase().includes(t)));
    if (list.length === 0) list = pool[group];
    out[group] = list;
  });
  return out;
}

/* ============================================================
   ALTERNATIVE EXERCISE LOOKUP

   Powers the "Find alternative" swap button during a workout — entirely
   offline, no AI call, since it's just picking another exercise from the
   same muscle group the person already has equipment for.
============================================================ */
// name -> muscle group, derived directly from POOLS so it can never drift
// out of sync with the actual exercise lists.
const EXERCISE_TO_GROUP = Object.fromEntries(
  Object.values(POOLS).flatMap((pool) =>
    Object.entries(pool).flatMap(([group, names]) => names.map((name) => [name, group]))
  )
);

// Fallback for exercise names that didn't come from POOLS (i.e. AI-written
// programs) — same conservative spirit as tipsForExercise: only guess when
// reasonably confident, never force a match.
export function inferMuscleGroup(name) {
  const n = name.toLowerCase();
  if (/squat|lunge|deadlift|leg press|leg curl|leg extension|calf|step-?up|glute|split squat|wall sit/.test(n)) return "legs";
  if (/curl/.test(n) && !/leg curl/.test(n)) return "biceps";
  if (/pushdown|skull crusher|tricep|overhead.*extension|kickback|dip|diamond push-?up/.test(n)) return "triceps";
  if (/press|fly|pec deck|push-?up/.test(n) && !/overhead press|shoulder press|leg press/.test(n)) return "chest";
  if (/overhead press|shoulder press|lateral raise|rear delt|face pull|y-raise|arnold|handstand|pike push-?up/.test(n)) return "shoulders";
  if (/row|pulldown|pull-?up|chin-?up|pullover/.test(n)) return "back";
  if (/crunch|plank|leg raise|sit-?up|russian twist|side bend|mountain climber|rollout|superman/.test(n)) return "core";
  return null;
}

export function alternativesFor(exerciseName, equipment, injuries) {
  const group = EXERCISE_TO_GROUP[exerciseName] || inferMuscleGroup(exerciseName);
  if (!group) return [];
  const pool = filterPool(POOLS[equipment] || POOLS.full, injuries);
  return (pool[group] || []).filter((name) => name !== exerciseName);
}

export function pick(arr, n, offset = 0) {
  const rotated = arr.slice(offset % arr.length).concat(arr.slice(0, offset % arr.length));
  return rotated.slice(0, Math.min(n, arr.length));
}

/* ============================================================
   EXERCISE FORM TIPS

   Baked into every exercise at program-generation time (both the AI-written
   program and the rule-based offline fallback) so "How to do it" in a
   workout never needs a live AI call — it just reads data that's already
   saved locally. Matched by keyword against the exercise name so a handful
   of rules cover every name variant across all three equipment pools,
   instead of needing one entry per exact exercise name.
============================================================ */
const TIP_RULES = [
  [/squat/i, [
    "Keep your chest up and core braced throughout the movement.",
    "Push your knees out in line with your toes as you descend.",
    "Drive through your whole foot, not just your toes.",
    "Common mistake: letting your knees cave inward under load.",
  ]],
  [/deadlift|good morning/i, [
    "Keep the bar (or weight) close to your body the entire lift.",
    "Brace your core and keep your back flat, not rounded.",
    "Push the floor away with your legs rather than yanking with your back.",
    "Common mistake: rounding the lower back to force the weight up.",
  ]],
  [/lunge|split squat|step-?up/i, [
    "Keep your front knee tracking over your foot, not caving in.",
    "Control the descent instead of dropping into the bottom position.",
    "Keep most of your weight on the front leg to target the right muscles.",
    "Common mistake: leaning too far forward and losing balance.",
  ]],
  [/bench press|floor press|chest press/i, [
    "Keep your shoulder blades pulled back and down on the bench.",
    "Lower the weight under control to roughly chest level.",
    "Keep a slight arch in your lower back, feet flat on the floor.",
    "Common mistake: flaring the elbows straight out to the sides.",
  ]],
  [/overhead press|shoulder press|arnold press|pike push-?up|handstand/i, [
    "Brace your core so you don't overarch your lower back.",
    "Press in a straight line, moving your head back slightly as the weight passes.",
    "Keep your ribs down rather than flaring them up as you press.",
    "Common mistake: turning it into a push press by dipping your knees.",
  ]],
  [/row|pulldown|pull-?up|chin-?up/i, [
    "Pull with your back, not just your arms — lead with your elbows.",
    "Squeeze your shoulder blades together at the top of the movement.",
    "Control the weight back down instead of letting it drop.",
    "Common mistake: using momentum or body swing to move the weight.",
  ]],
  [/fly|pec deck|pullover/i, [
    "Keep a slight bend in your elbows throughout the movement.",
    "Focus on squeezing your chest together rather than pressing.",
    "Don't let the weight stretch you past a comfortable range at the bottom.",
    "Common mistake: turning it into a press by bending the elbows more at the top.",
  ]],
  [/lateral raise|rear delt|y-raise|face pull/i, [
    "Use a lighter weight than you think — strict form matters most here.",
    "Raise with a slight bend in the elbows, leading with the elbows not the hands.",
    "Avoid shrugging your shoulders up toward your ears.",
    "Common mistake: swinging the weight up using momentum from the hips.",
  ]],
  [/curl/i, [
    "Keep your elbows pinned close to your sides.",
    "Control the lowering phase instead of letting the weight drop.",
    "Avoid swinging your torso or hips to help lift the weight.",
    "Common mistake: only doing a partial range of motion at the top.",
  ]],
  [/pushdown|skull crusher|overhead.*extension|kickback|tricep|diamond push-?up/i, [
    "Keep your elbows tucked in and stationary throughout.",
    "Fully extend at the bottom/end of the movement without locking out violently.",
    "Control the eccentric (lowering) portion of each rep.",
    "Common mistake: letting the elbows flare out or drift forward.",
  ]],
  [/leg curl|leg extension/i, [
    "Move through a full, controlled range of motion.",
    "Avoid using momentum to jerk the weight at the start of the rep.",
    "Keep your hips pressed into the pad/bench throughout.",
    "Common mistake: rushing the reps instead of controlling the tempo.",
  ]],
  [/leg press/i, [
    "Keep your lower back flat against the pad — don't let it round.",
    "Lower the sled until your knees reach about 90 degrees, no further.",
    "Push through your whole foot, not just your toes.",
    "Common mistake: locking the knees out hard at the top of each rep.",
  ]],
  [/calf raise/i, [
    "Rise onto your toes through a full range of motion.",
    "Pause briefly at the top for a real peak contraction.",
    "Lower under control instead of just dropping down.",
    "Common mistake: using tiny, bouncy partial reps instead of full range.",
  ]],
  [/dip/i, [
    "Lean slightly forward and keep your elbows from flaring too wide.",
    "Lower until your shoulders are about level with your elbows, no deeper.",
    "Keep your core braced instead of swinging your legs.",
    "Common mistake: going so deep it strains the front of the shoulder.",
  ]],
  [/plank|wall sit/i, [
    "Keep your body in a straight line — no sagging or piking at the hips.",
    "Brace your core like you're about to be poked in the stomach.",
    "Breathe normally instead of holding your breath.",
    "Common mistake: letting the hips drift out of line as fatigue sets in.",
  ]],
  [/crunch|sit-?up|leg raise|russian twist|side bend|mountain climber|rollout/i, [
    "Move slowly and with control rather than using momentum.",
    "Focus on bracing/curling through the core, not just swinging your limbs.",
    "Exhale as you crunch or curl inward.",
    "Common mistake: pulling on your neck instead of using your abs.",
  ]],
  [/glute bridge/i, [
    "Drive through your heels and squeeze your glutes at the top.",
    "Avoid overarching your lower back at the top of the rep.",
    "Keep your core braced throughout.",
    "Common mistake: using the lower back instead of the glutes to lift.",
  ]],
  [/push-?up/i, [
    "Keep your body in a straight line from head to heels.",
    "Lower until your chest nearly touches the floor.",
    "Keep your elbows at roughly a 45-degree angle to your torso.",
    "Common mistake: letting the hips sag or pike up.",
  ]],
];

const DEFAULT_TIPS = [
  "Warm up with a lighter set or two before your working sets.",
  "Move through a full, controlled range of motion.",
  "Keep your core braced throughout the movement.",
  "Prioritize good form over lifting heavier weight.",
];

export function tipsForExercise(name) {
  const rule = TIP_RULES.find(([pattern]) => pattern.test(name));
  return rule ? rule[1] : DEFAULT_TIPS;
}

// Fills in tips for any exercise that doesn't already have them (e.g. the AI
// omitted them, or this is a program saved before this feature existed) —
// never overwrites tips that are already there.
// Note: deliberately does NOT backfill missing "alternatives" with the
// coarser pool-based matching here — an absent/empty alternatives array is
// the signal WorkoutSession uses to know it should try a smarter live
// lookup first (falling back to the pool only if offline). Papering over it
// here would make every exercise look "already handled" and the AI-sourced
// upgrade would never get a chance to run.
export function withTips(exercises) {
  return (exercises || []).map((ex) => (
    Array.isArray(ex.tips) && ex.tips.length > 0 ? ex : { ...ex, tips: tipsForExercise(ex.name) }
  ));
}
export function normalizeProgramTips(program) {
  if (!program) return program;
  return { ...program, days: (program.days || []).map((d) => ({ ...d, exercises: withTips(d.exercises) })) };
}

// The AI writes each day's own name freely (e.g. "Push (Chest/Triceps/Shoulders)"
// or "Push A") AND used to write a separate free-text splitName describing the
// pattern as a whole — a second copy of the same fact, in the model's own words,
// that can quietly drift out of sync after a few back-and-forth chat edits (a
// user swapping/removing an exercise, renaming a day) even though the day list
// itself stayed correct the whole time. Deriving the label straight from the
// day names instead of trusting a second AI-written field means there's only
// one source of truth, so the label can never say something the schedule
// doesn't actually match. Mirrors the naming convention splitDisplayName()
// already uses for the offline path (e.g. "Push / Pull / Legs", not
// "Push A / Pull A / Legs A / Push B / Pull B / Legs B").
export function deriveSplitName(days) {
  const categories = (days || [])
    .map((d) => {
      let name = (d.name || "").split(/[\(\-–—]/)[0].trim();
      name = name.replace(/\s+[A-Za-z]$/, ""); // drop a trailing "A"/"B" day-letter suffix
      return name;
    })
    .filter(Boolean);
  return [...new Set(categories)].join(" / ");
}

const MUSCLE_GROUP_LABELS = { legs: "Leg", back: "Back", chest: "Chest", shoulders: "Shoulder", biceps: "Arm", triceps: "Arm", core: "Core" };

// todayOverride is just a flat exercise array with no name field of its
// own — the active workout screen's title came from the ORIGINAL scheduled
// day instead ("Push"), which has no way to know it's been swapped out for
// something else entirely. Real report: asking Coach for a leg session
// left the header still reading "Push" while every exercise listed was a
// leg exercise. Deriving the title from what the override actually
// contains — the same spirit as deriveSplitName() above — means the
// header can never disagree with what's actually in front of the person.
export function overrideDayName(exercises) {
  const groups = (exercises || []).map((e) => inferMuscleGroup(e.name)).filter(Boolean);
  const labels = [...new Set(groups.map((g) => MUSCLE_GROUP_LABELS[g] || g))];
  if (labels.length === 0) return "Today's Session";
  return `${labels.slice(0, 2).join("/")} Day`;
}

const DAY_TEMPLATES = {
  full: [["legs", 2], ["chest", 1], ["back", 1], ["shoulders", 1], ["core", 1]],
  upper: [["chest", 2], ["back", 2], ["shoulders", 1], ["biceps", 1], ["triceps", 1]],
  lower: [["legs", 4], ["core", 2]],
  push: [["chest", 2], ["shoulders", 2], ["triceps", 2]],
  pull: [["back", 3], ["biceps", 2], ["core", 1]],
  legs: [["legs", 5], ["core", 1]],
  chestDay: [["chest", 3], ["triceps", 2]],
  backDay: [["back", 3], ["biceps", 2]],
  shouldersDay: [["shoulders", 3], ["core", 2]],
  armsDay: [["biceps", 3], ["triceps", 3]],
  coreWeakPoint: [["core", 3], ["shoulders", 1], ["legs", 1]],
};

export const GOAL_SCHEME = {
  lose: { sets: 3, reps: "12-15", rest: 60, label: "Fat Loss" },
  build: { sets: 4, reps: "8-12", rest: 90, label: "Muscle Gain" },
  recomp: { sets: 3, reps: "10-12", rest: 75, label: "Lose Fat & Build Muscle" },
};

// Real time per exercise, not a guess: actual working time per set, plus the
// FULL rest period between sets ("build" alone means 4 sets x 90s rest = 6
// minutes of rest on ONE exercise before any lifting or transition time),
// plus realistic time to move to/set up the next exercise — then scaled by
// REALISTIC_OVERHEAD_MULTIPLIER below. That multiplier exists because a first
// pass at this formula (no multiplier, WORK=40s, TRANSITION=75s) still ran
// consistently short against real beta reports: a 30-min "build" session
// actually took ~50 min (67% over), and a 60-min "recomp" session actually
// took ~90 min (50% over) — both a similar, large margin, not just noise.
// That gap isn't explained by nudging one constant, since a fixed change to
// TRANSITION alone would have to differ wildly between the two goals to
// match both reports — it's warm-up sets before working sets on compound
// lifts, real equipment setup/walking time in an actual gym (not an empty
// one), and rest that runs a bit past what a timer prescribes, bundled into
// one honest overhead factor instead of pretending any single number here is
// precise.
const WORK_SECONDS_PER_SET = 45;
const TRANSITION_SECONDS_PER_EXERCISE = 100;
const REALISTIC_OVERHEAD_MULTIPLIER = 1.4;

export function rawSecondsPerExercise(sets, rest) {
  return Math.round((sets * (WORK_SECONDS_PER_SET + rest) + TRANSITION_SECONDS_PER_EXERCISE) * REALISTIC_OVERHEAD_MULTIPLIER);
}

export function secondsPerExercise(goal) {
  const scheme = GOAL_SCHEME[goal] || GOAL_SCHEME.recomp;
  return rawSecondsPerExercise(scheme.sets, scheme.rest);
}

function capFromSeconds(sessionLength, perExerciseSeconds, experience) {
  let cap = Math.floor((sessionLength * 60) / perExerciseSeconds);
  if (experience === "advanced") cap += 1;
  if (experience === "beginner") cap -= 1;
  // Absolute last resort, not the everyday answer — planSetsRest() below
  // trims sets/rest first specifically so a real session count (4+) fits
  // without ever reaching this. This only binds for genuinely extreme
  // combinations (a very short session) where even minimum sets/rest can't
  // fit 4 — and even then, 2 focused, fully-rested exercises beats forcing
  // a 3rd/4th that guarantees an overrun.
  return Math.max(2, cap);
}

// Minimum sensible values — below these, a "set" stops being real training
// volume and a "rest" stops being real recovery, regardless of how tight
// the time budget is.
const MIN_SETS = 2;
const MIN_REST_SECONDS = 45;
// Real report: a short session + a set/rest-heavy goal used to collapse to
// as few as 2 exercises — technically fits the time budget, but reads as a
// ridiculous "workout." The fix isn't to accept a near-empty session; it's
// to do what someone actually short on time does at the gym — cut rest
// first (the single biggest, lowest-cost lever), then sets if that's still
// not enough — to keep real exercise variety instead. This is a target,
// not a promise: a session so short even MIN_SETS/MIN_REST_SECONDS can't
// fit it will still honestly end up below this, rather than pretending.
const TARGET_MIN_EXERCISES = 4;

// Works backward from "how do I make ${TARGET_MIN_EXERCISES} exercises
// actually fit" instead of forward from "here's the ideal sets/rest, how
// many exercises does that leave room for" — the previous approach let
// exercise count collapse before ever questioning whether the textbook
// sets/rest was really non-negotiable for a time-constrained session.
export function planSetsRest(profile) {
  const scheme = GOAL_SCHEME[profile.goal] || GOAL_SCHEME.recomp;
  let sets = scheme.sets;
  let rest = scheme.rest;
  // Must mirror capFromSeconds' own experience adjustment exactly, not just
  // the raw floor-divide — otherwise this loop can stop as soon as the RAW
  // count hits 4, while capFor()'s subsequent beginner -1 then drops the
  // FINAL cap to 3. Real report: a beginner got a 3-exercise plan despite
  // this function's whole purpose being a guaranteed minimum of 4.
  const fits = () => {
    let adjusted = Math.floor((profile.sessionLength * 60) / rawSecondsPerExercise(sets, rest));
    if (profile.experience === "advanced") adjusted += 1;
    if (profile.experience === "beginner") adjusted -= 1;
    return adjusted >= TARGET_MIN_EXERCISES;
  };

  while (!fits() && rest > MIN_REST_SECONDS) rest = Math.max(MIN_REST_SECONDS, rest - 10);
  while (!fits() && sets > MIN_SETS) sets -= 1;

  return { sets, rest };
}

export function capFor(profile) {
  const { sets, rest } = planSetsRest(profile);
  return capFromSeconds(profile.sessionLength, rawSecondsPerExercise(sets, rest), profile.experience);
}

// Same ceiling math as capFor, but driven by whatever sets/rest a program
// ACTUALLY currently uses, not the profile's default goal scheme. Real
// report: a user asked Coach to cut sets/rest specifically to fit more
// exercises, but the Coach kept citing the same old ceiling — because
// capFor(profile) always reads GOAL_SCHEME[profile.goal]'s DEFAULT sets/
// rest, with no way to know the actual program had since diverged from
// that default. This derives the ceiling from the real, current program
// instead, so the number Coach is given can never be stale.
// A single-arm/single-leg exercise takes roughly TWICE as long as its own
// sets/rest numbers alone suggest — both sides need training, one at a
// time, not simultaneously — and the duration model otherwise has no way
// to know that, badly underestimating real time for a day built around
// unilateral work.
export function isUnilateral(name) {
  return /single[- ]arm|single[- ]leg|\b1[- ]arm|\b1[- ]leg|bulgarian split|split squat|pistol squat|step-?up|lunge/i.test(name || "");
}

export function capForProgram(program, sessionLength, experience) {
  const allExercises = (program?.days || []).flatMap((d) => d.exercises || []);
  if (allExercises.length === 0) return null;
  const perExerciseSeconds = allExercises.map((e) => {
    const raw = rawSecondsPerExercise(Number(e.sets) || 0, Number(e.rest) || 0);
    return isUnilateral(e.name) ? raw * 2 : raw;
  });
  const avgSeconds = perExerciseSeconds.reduce((a, s) => a + s, 0) / perExerciseSeconds.length;
  if (avgSeconds <= 0) return null;
  return capFromSeconds(sessionLength, avgSeconds, experience);
}

// sets/rest are optional overrides — when omitted, falls back to the
// goal's own textbook scheme (kept for buildDay's own existing tests);
// buildProgram() below always passes planSetsRest()'s adapted values
// explicitly, so a real generated program actually reflects whatever
// sets/rest it took to fit a real exercise count, not the un-adapted ideal.
export function buildDay(kind, pool, goal, cap, offset, sets, rest) {
  const scheme = GOAL_SCHEME[goal];
  const setsToUse = sets ?? scheme.sets;
  const restToUse = rest ?? scheme.rest;
  let exercises = [];
  DAY_TEMPLATES[kind].forEach(([group, n]) => {
    pick(pool[group], n, offset).forEach((name) => {
      exercises.push({ name, sets: setsToUse, reps: scheme.reps, rest: restToUse });
    });
  });
  return exercises.slice(0, cap);
}

// Split structure depends on BOTH day count and training experience — a beginner
// and an advanced lifter training the same number of days per week should not
// necessarily land on the same split. This mirrors the guidance given to the AI
// generator and is used as the offline fallback if that call ever fails.
export function splitForDays(days, experience) {
  if (days <= 3) return { key: "full3", labels: ["Full Body A", "Full Body B", "Full Body C"], kinds: ["full", "full", "full"] };
  if (days === 4) return { key: "ul4", labels: ["Upper A", "Lower A", "Upper B", "Lower B"], kinds: ["upper", "lower", "upper", "lower"] };
  if (days === 5) {
    if (experience === "advanced") {
      return { key: "bodypart5", labels: ["Chest", "Back", "Legs", "Shoulders", "Arms"], kinds: ["chestDay", "backDay", "legs", "shouldersDay", "armsDay"] };
    }
    return { key: "ppl_ul5", labels: ["Push", "Pull", "Legs", "Upper", "Lower"], kinds: ["push", "pull", "legs", "upper", "lower"] };
  }
  if (experience === "advanced") {
    return { key: "bodypart6", labels: ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core & Weak Points"], kinds: ["chestDay", "backDay", "legs", "shouldersDay", "armsDay", "coreWeakPoint"] };
  }
  return { key: "ppl6", labels: ["Push A", "Pull A", "Legs A", "Push B", "Pull B", "Legs B"], kinds: ["push", "pull", "legs", "push", "pull", "legs"] };
}

export function splitDisplayName(key) {
  return {
    full3: "Full Body",
    ul4: "Upper / Lower",
    ppl_ul5: "Push / Pull / Legs / Upper / Lower",
    ppl6: "Push / Pull / Legs",
    bodypart5: "Body-Part Split",
    bodypart6: "Body-Part Split",
  }[key];
}

export function buildProgram(profile) {
  const basePool = POOLS[profile.equipment];
  const pool = filterPool(basePool, profile.injuries);
  const cap = capFor(profile);
  const { sets, rest } = planSetsRest(profile);
  const split = splitForDays(profile.daysPerWeek, profile.experience);
  // Two days sharing the same "kind" (two "full" days, two "push" days in a
  // PPL x2 split, etc.) need to draw from different points in the pool, or
  // they come out completely identical — real report: a 3-day Full Body
  // split's "Full Body A" and "Full Body B" had the exact same exercises.
  // The old offset (a flat "first half of the days get 0, second half get
  // 2") only ever produced two buckets — for an ODD day count like 3, days 0
  // and 1 both rounded into the same bucket. Tracking how many days have
  // already used each kind and rotating one step further per repeat fixes
  // this for any day count, not just even ones.
  const kindOccurrence = {};
  const days = split.labels.map((label, i) => {
    const kind = split.kinds[i];
    const occurrence = kindOccurrence[kind] || 0;
    kindOccurrence[kind] = occurrence + 1;
    return { name: label, exercises: buildDay(kind, pool, profile.goal, cap, occurrence, sets, rest) };
  });
  return { splitName: splitDisplayName(split.key), days };
}

function splitGuidanceFor(days) {
  const map = {
    3: "Full Body (every session trains all major muscle groups) is the standard, most time-efficient choice for 3 days/week.",
    4: "Multiple valid options: Upper/Lower (2 upper + 2 lower), a 4-day Full Body rotation, or an Upper/Lower/Push/Pull hybrid. Pick whichever best fits this person's experience and desired physique — do not default to Upper/Lower automatically.",
    5: "Multiple valid options: Push/Pull/Legs/Upper/Lower, a body-part split (e.g. chest, back, legs, shoulders, arms), or Upper/Lower/Push/Pull/Legs. More advanced lifters or those wanting to prioritize specific areas often do better with more day-specific splits than a generic Upper/Lower.",
    6: "Push/Pull/Legs performed twice (PPL x2) is standard, but a 6-day body-part split (e.g. chest, back, shoulders, legs, arms, weak-point/core) is equally valid, especially for intermediate/advanced lifters or a specific physique goal.",
  };
  return map[days] || "Choose a split structure appropriate to this many training days.";
}

// Combines the preset injury checkboxes with the free-text "other injuries"
// field into one description for the AI — "none" only shows up if there's
// truly nothing on either side.
export function injuryDescription(profile) {
  const preset = (profile.injuries || []).filter((i) => i && i !== "none");
  const parts = [...preset.map((i) => i.replace(/_/g, " "))];
  if (profile.otherInjuries && profile.otherInjuries.trim()) parts.push(profile.otherInjuries.trim());
  return parts.length > 0 ? parts.join(", ") : "none";
}

export function buildProgramGenSystem(profile) {
  const { sets: recSets, rest: recRest } = planSetsRest(profile);
  return `You are a world-class evidence-based strength & physique coach designing a brand-new, fully personalized training program from scratch for a new client. Apply mainstream exercise-science consensus: progressive overload, sensible per-muscle volume landmarks, rep ranges matched to the goal, and adequate recovery between sessions hitting the same muscles.

Client details:
- Sex: ${profile.sex}, Age: ${profile.age}, Height: ${Math.floor(profile.heightIn / 12)}'${profile.heightIn % 12}", Weight: ${profile.weightLb} lb
- Goal: ${profile.goal} (${GOAL_SCHEME[profile.goal]?.label})
- Current build: ${(profile.currentPhysique || "").replace(/_/g, " ")}
- Desired physique: "${profile.desiredPhysique}"
- Specific strength/performance goals: ${profile.specificGoals ? `"${profile.specificGoals}"` : "none stated"}
- Training experience: ${profile.experience}
- Equipment available: ${profile.equipment}
- Days per week available: ${profile.daysPerWeek}
- Target session length: ~${profile.sessionLength} minutes
- Injuries / areas to train around: ${injuryDescription(profile)}
- Daily activity level outside training: ${profile.activity}
${profile.notes ? `- Additional notes from the client, in their own words — treat this as a real constraint/preference, not a nice-to-have: "${profile.notes}"` : ""}

Split structure guidance for ${profile.daysPerWeek} days/week: ${splitGuidanceFor(profile.daysPerWeek)}
IMPORTANT: Do not default to an Upper/Lower split out of habit. Actually weigh which valid structure for this day count best serves THIS person's experience level and desired physique, and choose that one — different clients with the same day count should be able to land on different splits if their goals differ. If their desired physique calls out specific areas (e.g. "bigger arms", "glutes", "wider back"), prefer a split structure that lets you dedicate real, undiluted volume to that area rather than folding it into a generic day.

Design a training split and day-by-day program tailored specifically to this person — not a generic template. Weight exercise selection and volume toward their stated desired physique while staying balanced, joint-friendly, and appropriate for their experience level. Choose sets/reps/rest per exercise suited to their goal.

TIME BUDGET, worked out for you already — use these numbers as-is, don't recompute your own: for a "${profile.sessionLength}-minute" session, ${recSets} sets x ${recRest}s rest per exercise is what actually fits real exercise variety in the time available (their goal's textbook scheme is ${GOAL_SCHEME[profile.goal]?.sets ?? 3} sets x ${GOAL_SCHEME[profile.goal]?.rest ?? 75}s rest, but that's too much volume-per-exercise for this session length to also cover real variety — rest between SETS is the dominant real-world time cost, so it gets trimmed first, sets only if rest alone isn't enough). Use ${recSets} sets and ${recRest}s rest for every exercise in this program.
MINIMUM 4 exercises on every day — do not go below this by defaulting back to the textbook sets/rest above; the whole point of the trimmed scheme is to make a real, varied session actually fit. HARD CEILING (not a suggestion) of ${capFor(profile)} exercises on any day, computed from those same numbers — going over is the single most common way a "${profile.sessionLength}-minute" program actually runs way longer than that. If you're tempted to add "just one more" exercise, cut a less important one instead.
A single-arm or single-leg ("unilateral") exercise — a Bulgarian split squat, a single-arm row, a walking lunge, a step-up — takes roughly TWICE as long as the same sets/rest would for a bilateral exercise, since both sides need training one at a time. If you include one, treat it as costing about two "slots" against the ceiling above, not one, or cut something else to compensate.
${profile.specificGoals ? `If they've stated specific performance goals (e.g. a target bench/squat/deadlift number, a bodyweight-strength milestone like a pull-up, a running goal), make sure the relevant lift or movement is programmed directly — include it with a rep/set scheme that actually builds toward that outcome (lower-rep strength work for a numeric lift goal, progressive skill/strength work for a bodyweight milestone), not just buried as one of several accessory options.` : ""}

Respond ONLY with a JSON object, no markdown fences, no prose outside the JSON, in exactly this shape:
{"splitName": "<short split name, e.g. 'Push / Pull / Legs'>", "days": [{"name": "<day name, e.g. 'Push Day'>", "exercises": [{"name": "<exercise name>", "sets": <number>, "reps": "<string like 8-12>", "rest": <number, seconds>, "tips": ["<tip>", "<tip>", "<tip>", "<tip>"], "alternatives": ["<exercise name>", "<exercise name>", "<exercise name>"]}]}]}

Rules:
- "days" must have exactly ${profile.daysPerWeek} entries.
- Only include exercises doable with this equipment: ${profile.equipment === "full" ? "a fully-equipped gym (barbells, dumbbells, machines, cables)" : profile.equipment === "dumbbell" ? "dumbbells only" : "bodyweight only, no equipment"}.
- Spell equipment out in exercise names ("Dumbbell Bench Press," "Barbell Row") rather than gym-jargon abbreviations like "DB" or "BB" — plenty of people using this app are new to lifting and won't know the shorthand.
- Exercise names must be JUST the plain, standard movement name — nothing else attached, ever. No parentheses, no dash-suffix, and no trailing descriptor word or phrase tacked on either (not "Leg Press (Low)," not "Leg Press - Wide Stance," not "Leg Press Moderate Depth," not "Controlled Leg Press" — just "Leg Press"). These names get looked up against a real exercise-demo database afterward, and ANY extra word beyond the bare movement name is a common reason a lookup for an exercise that's obviously in the database still fails to match. Depth, tempo, stance width, range of motion — all of that belongs in that exercise's "tips," never in the name.
- Use the EXACT SAME spelling for an exercise every time it appears in this program — if "Leg Press" shows up on more than one day, it must be spelled identically both times, not "Leg Press" one day and "Leg Press Machine" or "Machine Leg Press" the next. These are meant to be the same reference name throughout, not restated in different words each time.
- Where one of these fits what you're trying to program, prefer it exactly as written — real, plain names already known to work well: ${exerciseVocabularyFor(profile.equipment).join(", ")}. Use something else if none of these fit, but don't rename or rephrase one of these if it does fit.
- Never include exercises that would aggravate: ${injuryDescription(profile)}.
${profile.notes ? `- Actually honor the client's own additional notes above ("${profile.notes}") — a stated split preference, a disliked/avoided exercise, equipment their specific gym doesn't have, or anything else in there. If something in it conflicts with another rule (e.g. asks for equipment outside what's available), prioritize what's actually usable and briefly note the conflict isn't a way to silently ignore it.` : ""}
- Every exercise needs ${recSets} sets, a rep range string, ${recRest}s rest, exactly as given in the TIME BUDGET above — don't independently pick a different sets/rest per exercise, that's what already made the exercise count fit.
- Every exercise's "tips" must be exactly 4 short (under 18 words each), practical form cues covering setup, execution, and one common mistake to avoid — the person will rely on these mid-workout with no internet connection, so they must be self-contained and specific to that exact exercise, not generic filler.
- Every exercise's "alternatives" must be exactly 3 genuinely similar substitute exercises — same primary muscle emphasis AND a comparable movement pattern (don't suggest an isolation machine exercise as an alternative to a compound barbell lift, or vice versa), doable with the same equipment, and appropriate for their experience level. These are real swap options a person could drop in mid-workout, not just "same body part" — e.g. for "Leg Curl," suggest other hamstring-focused exercises, not an unrelated quad-dominant squat variation just because both are "legs."`;
}

/* ============================================================
   NUTRITION CALC
============================================================ */
export function calcTargets(profile) {
  const { sex, age, heightIn, weightLb, activity, goal } = profile;
  const kg = weightLb * 0.453592;
  const cm = heightIn * 2.54;
  let bmr = 10 * kg + 6.25 * cm - 5 * age + (sex === "male" ? 5 : -161);
  const actMult = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 }[activity];
  let tdee = bmr * actMult;
  let calories = tdee;
  if (goal === "lose") calories = tdee * 0.8;
  if (goal === "build") calories = tdee * 1.1;
  if (goal === "recomp") calories = tdee * 0.97;
  calories = Math.round(calories / 5) * 5;
  const protein = Math.round(weightLb * 1.0);
  const fat = Math.round((calories * 0.25) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat, tdee: Math.round(tdee) };
}

/* ============================================================
   STORAGE (Supabase — real accounts + real database)

   Also mirrors state to localStorage on every write and read, so the app
   keeps working — reading and logging workouts — with zero connectivity
   (e.g. mid-workout at the gym), then syncs to Supabase once back online.
============================================================ */
function localStateKey(userId) { return `overload_state_${userId}`; }
function pendingSyncKey(userId) { return `overload_pending_sync_${userId}`; }

export function readLocalState(userId) {
  try {
    const raw = localStorage.getItem(localStateKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    // Corrupt JSON or localStorage unavailable (e.g. private browsing) —
    // treat it the same as "no local copy" rather than throwing.
    return null;
  }
}
export function writeLocalState(userId, state) {
  try {
    localStorage.setItem(localStateKey(userId), JSON.stringify(state));
  } catch (e) {
    console.error("writeLocalState failed", e);
  }
}
export function hasPendingSync(userId) {
  try { return localStorage.getItem(pendingSyncKey(userId)) === "1"; } catch (e) { return false; }
}
export function setPendingSync(userId, pending) {
  try {
    if (pending) localStorage.setItem(pendingSyncKey(userId), "1");
    else localStorage.removeItem(pendingSyncKey(userId));
  } catch (e) { /* best-effort only */ }
}

// A cold start (fresh tab/relaunch, not just backgrounding) has to ask
// Supabase for a session before anything else can happen — and that ask
// has no timeout. Real report: the app was a permanent blank white screen
// on first open with no connection, but "worked fine without wifi" once
// already open — because ONLY that very first gate had nothing to fall
// back to. This remembers who was last signed in on this device so a cold
// start with no connectivity can skip straight to their already-cached
// local state instead of hanging forever waiting on a network call that's
// never going to complete.
const LAST_ACCOUNT_KEY = "overload_last_account";
export function readLastAccount() {
  try {
    const raw = localStorage.getItem(LAST_ACCOUNT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
export function writeLastAccount(account) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify(account));
  } catch (e) { /* best-effort only */ }
}

// Meal photos captured with no connection (e.g. offline at the gym) — kept
// separate from the main app_state blob (rather than riding along in
// saveState/loadState) so queued photos never bloat the JSON that gets
// synced to Supabase; they're purely a local, transient queue.
function pendingPhotosKey(userId) { return `overload_pending_photos_${userId}`; }
function readPendingPhotos(userId) {
  try { return JSON.parse(localStorage.getItem(pendingPhotosKey(userId)) || "[]"); } catch (e) { return []; }
}
function writePendingPhotos(userId, list) {
  try { localStorage.setItem(pendingPhotosKey(userId), JSON.stringify(list)); } catch (e) { console.error("writePendingPhotos failed", e); }
}

export async function loadState(userId, attempt = 0) {
  // If the last save on this device never got confirmed as pushed (saveState
  // sets this flag before the upsert, clears it only on success), the local
  // cache is known to be AHEAD of whatever's on the server right now — the
  // write could still be in flight, or could have failed outright. Real
  // reports: finishing a set (or getting a Coach reply) then immediately
  // reloading/backgrounding lost the change, because a plain reload always
  // trusted a successful server read over local, even when that read just
  // won a race against a save that hadn't landed yet. Fall back to local in
  // that case instead of unconditionally trusting a fresh — but stale —
  // server read.
  if (hasPendingSync(userId)) {
    const local = readLocalState(userId);
    if (local) return { state: local, fromCache: true };
  }
  const { data, error } = await supabase.from("app_state").select("state").eq("user_id", userId).maybeSingle();
  if (error) {
    // A fresh session (e.g. right after a password reset) can occasionally
    // hit an RLS/auth timing hiccup on the very first request — retry a
    // couple times before concluding this is genuinely offline/unreachable.
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 500));
      return loadState(userId, attempt + 1);
    }
    console.error("loadState failed, falling back to local cache", error);
    return { state: readLocalState(userId), fromCache: true };
  }
  const state = data ? data.state : null;
  if (state) writeLocalState(userId, state); // keep the local cache fresh whenever the server has a real answer
  return { state, fromCache: false };
}

// Always saves locally first (instant, works with zero connectivity), then
// tries to push to Supabase. Returns whether the server push succeeded so
// the UI can show a "saved locally, will sync" indicator when it doesn't.
export async function saveState(userId, state) {
  writeLocalState(userId, state);
  // Set BEFORE the upsert starts, not just on failure — the flag needs to
  // cover the whole window while this write is in flight, not only the
  // aftermath of a confirmed failure. Real report: progress (a finished
  // set, a Coach change) got lost on reload/exit even though the upsert
  // would have eventually succeeded — the reload just won the race and
  // happened before it landed, and loadState() had no way to know a newer
  // local write existed to prefer over the still-stale server read.
  setPendingSync(userId, true);
  try {
    const { error } = await supabase.from("app_state").upsert({ user_id: userId, state, updated_at: new Date().toISOString() });
    if (error) throw error;
    setPendingSync(userId, false);
    return true;
  } catch (e) {
    console.error("saveState failed, will retry once back online", e);
    return false;
  }
}
async function loadProfile(userId, attempt = 0) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 500));
      return loadProfile(userId, attempt + 1);
    }
    console.error("loadProfile failed", error);
    return null;
  }
  return data;
}

const TRIAL_DAYS = 30;
export function isTrialActive(startedAt) {
  if (!startedAt) return false;
  const elapsed = Date.now() - new Date(startedAt).getTime();
  return elapsed < TRIAL_DAYS * 24 * 60 * 60 * 1000;
}
export function trialDaysLeft(startedAt) {
  if (!startedAt) return 0;
  const elapsed = Date.now() - new Date(startedAt).getTime();
  return Math.max(0, Math.ceil((TRIAL_DAYS * 24 * 60 * 60 * 1000 - elapsed) / (24 * 60 * 60 * 1000)));
}

// Local calendar date as "YYYY-MM-DD" — deliberately NOT toISOString()
// (which is UTC), since that shifts the day boundary by several hours for
// anyone not near UTC. A meal logged at 11pm Pacific time should land on
// that Pacific calendar day, not roll over to "tomorrow" because it's
// already past midnight UTC.
export function dateToISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function todayISO() {
  return dateToISO(new Date());
}
// The inverse of dateToISO — parses one of our own stored "YYYY-MM-DD"
// strings back into a Date representing LOCAL midnight of that day.
// Deliberately not `new Date(dateString)`: per spec, a bare date-only ISO
// string parses as UTC midnight, which silently shifts to the wrong local
// calendar day (and even the wrong month, near a month boundary) for
// anyone not near UTC.
export function parseISODate(s) {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
}

/* ============================================================
   SMALL UI PRIMITIVES
============================================================ */
function Ring({ value, max, size = 76, stroke = 8, color, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={T.steel} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}

function TickRule({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "22px 0 10px" }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: 1, color: T.steelDark, textTransform: "uppercase", fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: `repeating-linear-gradient(90deg, ${T.steelDark} 0 2px, transparent 2px 6px)` }} />
    </div>
  );
}

function Card({ children, style, onClick }) {
  // Optional onClick makes the whole card a real interactive control (not
  // just decorative), so it needs the keyboard/role handling a <button>
  // would give for free — a beta-review flagged that only a small arrow
  // inside a card was clickable, which is an easy miss target on mobile.
  const interactiveProps = onClick ? {
    onClick,
    role: "button",
    tabIndex: 0,
    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } },
  } : {};
  return (
    <div
      {...interactiveProps}
      style={{ background: T.card, borderRadius: 14, padding: 16, boxShadow: "0 1px 2px rgba(18,22,28,0.06)", border: `1px solid ${T.steel}`, ...(onClick ? { cursor: "pointer" } : {}), ...style }}
    >
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", style, disabled }) {
  // boxSizing explicit (not just relying on the global `*` rule) so every
  // variant renders the exact same height/padding regardless of whether it
  // adds a border — ghost's 1px border is subtracted from its content box
  // rather than adding to the button's outer size, so e.g. Fuel's "+ Add
  // meal" (primary) and "Photo" (ghost) buttons stay pixel-identical.
  const base = {
    boxSizing: "border-box",
    border: "none", borderRadius: 10, padding: "12px 16px", fontFamily: "'Inter', sans-serif",
    fontWeight: 600, fontSize: 14, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "transform 0.1s",
  };
  const variants = {
    primary: { background: T.ink, color: "#fff" },
    accent: { background: T.charge, color: "#fff" },
    ghost: { background: "transparent", color: T.ink, border: `1px solid ${T.steel}` },
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.97)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {children}
    </button>
  );
}

/* ============================================================
   LOGIN
============================================================ */
export function ConfirmEmailScreen({ email, onResend, onBackToLogin }) {
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState("");

  async function resend() {
    setResending(true);
    setError("");
    setResent(false);
    const result = await onResend(email);
    setResending(false);
    if (result.ok) setResent(true);
    else setError(result.error);
  }

  return (
    <div className="auth-screen" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "calc(28px + env(safe-area-inset-top, 0px)) 28px 28px", background: T.ink, color: "#fff" }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 30 }}>
          <Zap size={20} color={T.charge} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 2, color: T.charge, fontWeight: 600 }}>OVERLOAD</span>
        </div>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(78,74,242,0.15)", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 30 }}>
          <MessageCircle size={26} color={T.charge} />
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 30, lineHeight: 1.15, margin: "18px 0 10px", fontWeight: 700 }}>
          Check your email
        </h1>
        <p style={{ fontFamily: "'Inter', sans-serif", color: "#B9BEC6", fontSize: 14, lineHeight: 1.6, maxWidth: 360 }}>
          We sent a confirmation link to <strong style={{ color: "#fff" }}>{email}</strong>. Click it to activate your account, then come back and sign in.
        </p>
        <p style={{ fontFamily: "'Inter', sans-serif", color: "#7C838F", fontSize: 12, lineHeight: 1.6, marginTop: 14, maxWidth: 360 }}>
          Don't see it? Check your spam or junk folder — confirmation emails sometimes end up there.
        </p>
        {resent && <p style={{ color: T.good, fontSize: 13, marginTop: 14 }}>Confirmation email resent.</p>}
        {error && <p style={{ color: "#FF8A80", fontSize: 13, marginTop: 14 }}>{error}</p>}
      </div>
      <div>
        <Btn variant="accent" onClick={resend} disabled={resending} style={{ width: "100%", padding: 16 }}>
          {resending ? "Sending…" : "Resend confirmation email"}
        </Btn>
        <button
          onClick={onBackToLogin}
          style={{ width: "100%", background: "none", border: "none", color: "#B9BEC6", fontSize: 13, padding: "14px 0 4px", cursor: "pointer" }}
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
}

export function EmailConfirmedScreen({ onContinue }) {
  return (
    <div className="auth-screen" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "calc(28px + env(safe-area-inset-top, 0px)) 28px 28px", background: T.ink, color: "#fff" }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 30 }}>
          <Zap size={20} color={T.charge} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 2, color: T.charge, fontWeight: 600 }}>OVERLOAD</span>
        </div>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(31,158,110,0.15)", display: "flex", alignItems: "center", justifyContent: "center", marginTop: 30 }}>
          <Check size={26} color={T.good} />
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 30, lineHeight: 1.15, margin: "18px 0 10px", fontWeight: 700 }}>
          Email confirmed
        </h1>
        <p style={{ fontFamily: "'Inter', sans-serif", color: "#B9BEC6", fontSize: 14, lineHeight: 1.6, maxWidth: 360 }}>
          Your account is active. If you started signing up on another tab or the home screen, you can just go back there — it'll sign you in on its own.
        </p>
      </div>
      <div>
        <Btn variant="accent" onClick={onContinue} style={{ width: "100%", padding: 16 }}>
          Continue to Overload <ChevronRight size={18} />
        </Btn>
      </div>
    </div>
  );
}

export function Login({ onSignUp, onSignIn, onForgotPassword, initialMode }) {
  const [mode, setMode] = useState(initialMode || "signup"); // "signup" | "signin" | "forgot"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const inputStyle = { width: "100%", padding: "14px 16px", fontSize: 15, borderRadius: 10, border: "none", marginTop: 4, boxSizing: "border-box", fontFamily: "'Inter', sans-serif", color: T.ink, background: "#fff" };

  async function submit() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) return setError("Enter a valid email.");

    if (mode === "forgot") {
      setError("");
      setInfo("");
      setBusy(true);
      const result = await onForgotPassword(trimmedEmail);
      setBusy(false);
      if (result.ok) setInfo("Check your email for a password reset link.");
      else setError(result.error);
      return;
    }

    if (password.length < 6) return setError("Password must be at least 6 characters.");

    setError("");
    setBusy(true);
    let result;
    if (mode === "signup") {
      const trimmedName = name.trim();
      if (!trimmedName) { setBusy(false); return setError("Enter your name."); }
      if (password !== confirm) { setBusy(false); return setError("Passwords don't match."); }
      result = await onSignUp({ name: trimmedName, email: trimmedEmail, password });
    } else {
      result = await onSignIn({ email: trimmedEmail, password });
    }
    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="auth-screen" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "calc(28px + env(safe-area-inset-top, 0px)) 28px 28px", background: T.ink, color: "#fff" }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 30 }}>
          <Zap size={20} color={T.charge} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 2, color: T.charge, fontWeight: 600 }}>OVERLOAD</span>
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 34, lineHeight: 1.1, margin: "18px 0 8px", fontWeight: 700 }}>
          {mode === "signup" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Welcome back"}
        </h1>
        <p style={{ fontFamily: "'Inter', sans-serif", color: "#B9BEC6", fontSize: 14, lineHeight: 1.5, marginBottom: 26, maxWidth: 340 }}>
          {mode === "forgot" ? "Enter your email and we'll send you a link to set a new password." : "Your program, logs, and chats are saved to this account so they're here next time you open the app."}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "signup" && (
            <div>
              <label style={{ fontSize: 12, color: "#B9BEC6", fontWeight: 600 }}>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" style={inputStyle} />
            </div>
          )}
          <div>
            <label style={{ fontSize: 12, color: "#B9BEC6", fontWeight: 600 }}>Email</label>
            <input
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email"
              onKeyDown={(e) => e.key === "Enter" && mode === "forgot" && submit()}
              style={inputStyle}
            />
          </div>
          {mode !== "forgot" && (
            <div>
              <label style={{ fontSize: 12, color: "#B9BEC6", fontWeight: 600 }}>Password</label>
              <input
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" type="password"
                onKeyDown={(e) => e.key === "Enter" && mode === "signin" && submit()}
                style={inputStyle}
              />
            </div>
          )}
          {mode === "signup" && (
            <div>
              <label style={{ fontSize: 12, color: "#B9BEC6", fontWeight: 600 }}>Confirm password</label>
              <input
                value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" type="password"
                onKeyDown={(e) => e.key === "Enter" && submit()}
                style={inputStyle}
              />
            </div>
          )}
          {mode === "signin" && (
            <button
              onClick={() => { setMode("forgot"); setError(""); setInfo(""); }}
              style={{ background: "none", border: "none", color: "#B9BEC6", fontSize: 12, cursor: "pointer", textAlign: "left", padding: 0, textDecoration: "underline" }}
            >
              Forgot password?
            </button>
          )}
          {error && <span style={{ color: "#FF8A80", fontSize: 13 }}>{error}</span>}
          {info && <span style={{ color: T.good, fontSize: 13 }}>{info}</span>}
          <button
            onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setInfo(""); }}
            style={{ background: "none", border: "none", color: T.charge, fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left", padding: 0 }}
          >
            {mode === "forgot" ? "Back to sign in" : mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </div>
      </div>
      <Btn variant="accent" onClick={submit} disabled={busy} style={{ width: "100%", padding: "16px" }}>
        {busy ? "One sec…" : mode === "forgot" ? "Send reset link" : mode === "signup" ? "Create account" : "Sign in"} <ChevronRight size={18} />
      </Btn>
      {mode === "signup" && (
        <p style={{ textAlign: "center", fontSize: 11, color: "#9CA3AF", marginTop: 12 }}>
          By creating an account, you agree to our{" "}
          <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: "#9CA3AF" }}>Terms</a>
          {" "}and{" "}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: "#9CA3AF" }}>Privacy Policy</a>.
        </p>
      )}
    </div>
  );
}

/* ============================================================
   PAYWALL
============================================================ */
function SetNewPasswordScreen({ onSetPassword }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const inputStyle = { width: "100%", padding: "14px 16px", fontSize: 15, borderRadius: 10, border: "none", marginTop: 4, boxSizing: "border-box", fontFamily: "'Inter', sans-serif", color: T.ink, background: "#fff" };

  async function submit() {
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setError("");
    setBusy(true);
    const result = await onSetPassword(password);
    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="auth-screen" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "calc(28px + env(safe-area-inset-top, 0px)) 28px 28px", background: T.ink, color: "#fff" }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 30 }}>
          <Zap size={20} color={T.charge} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 2, color: T.charge, fontWeight: 600 }}>OVERLOAD</span>
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 34, lineHeight: 1.1, margin: "18px 0 8px", fontWeight: 700 }}>Set a new password</h1>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
          <div>
            <label style={{ fontSize: 12, color: "#B9BEC6", fontWeight: 600 }}>New password</label>
            <input
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" type="password"
              onKeyDown={(e) => e.key === "Enter" && submit()}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#B9BEC6", fontWeight: 600 }}>Confirm password</label>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" type="password" onKeyDown={(e) => e.key === "Enter" && submit()} style={inputStyle} />
          </div>
          {error && <span style={{ color: "#FF8A80", fontSize: 13 }}>{error}</span>}
        </div>
      </div>
      <Btn variant="accent" onClick={submit} disabled={busy} style={{ width: "100%", padding: "16px" }}>
        {busy ? "One sec…" : "Save new password"} <ChevronRight size={18} />
      </Btn>
    </div>
  );
}

function Paywall({ account, trialUsed, onStartTrial, onRefresh, onLogout }) {
  const [plan, setPlan] = useState("monthly");
  const [loading, setLoading] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Update these to match whatever you actually set as your Stripe prices —
  // this is just display text, Stripe is the source of truth for what's charged.
  const MONTHLY_PRICE = "$7.99";
  const YEARLY_PRICE = "$59.99";
  const YEARLY_SAVE_PCT = "37%";

  async function startCheckout() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email, userId: account.id, plan }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Couldn't start checkout. Try again.");
        setLoading(false);
      }
    } catch (e) {
      setError("Couldn't start checkout. Try again.");
      setLoading(false);
    }
  }

  async function handleStartTrial() {
    setTrialLoading(true);
    await onStartTrial();
    setTrialLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  const FEATURES = [
    "Training program built by AI for your exact goals",
    "Personalized calorie & macro targets",
    "Workout logging with rest timers & progress charts",
    "On-demand AI coach chat, anytime you need it",
  ];

  return (
    <div className="auth-screen" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "calc(28px + env(safe-area-inset-top, 0px)) 28px 28px", background: T.ink, color: "#fff" }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 30 }}>
          <Zap size={20} color={T.charge} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 2, color: T.charge, fontWeight: 600 }}>OVERLOAD</span>
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 32, lineHeight: 1.1, margin: "18px 0 14px", fontWeight: 700 }}>
          {trialUsed ? "Your trial has ended" : "Unlock your plan"}
        </h1>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
          {FEATURES.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <Check size={16} color={T.charge} style={{ marginTop: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: "#D6D9DE", lineHeight: 1.4 }}>{f}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button
            onClick={() => setPlan("monthly")}
            style={{ flex: 1, padding: "10px 0", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, border: `2px solid ${plan === "monthly" ? T.charge : "rgba(255,255,255,0.15)"}`, background: plan === "monthly" ? "rgba(78,74,242,0.15)" : "transparent", color: "#fff" }}
          >
            Monthly
          </button>
          <button
            onClick={() => setPlan("yearly")}
            style={{ flex: 1, padding: "10px 0", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, border: `2px solid ${plan === "yearly" ? T.charge : "rgba(255,255,255,0.15)"}`, background: plan === "yearly" ? "rgba(78,74,242,0.15)" : "transparent", color: "#fff", position: "relative" }}
          >
            Yearly
            <span style={{ position: "absolute", top: -10, right: -6, background: T.good, color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6 }}>SAVE {YEARLY_SAVE_PCT}</span>
          </button>
        </div>

        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 16, padding: 20, marginBottom: 14 }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 28, fontWeight: 700 }}>
            {plan === "monthly" ? MONTHLY_PRICE : YEARLY_PRICE}
            <span style={{ fontSize: 14, color: "#B9BEC6", fontWeight: 500 }}> / {plan === "monthly" ? "month" : "year"}</span>
          </div>
          <div style={{ fontSize: 13, color: "#B9BEC6", marginTop: 6 }}>Cancel anytime.</div>
        </div>
        {error && <p style={{ color: "#FF8A80", fontSize: 13 }}>{error}</p>}
      </div>
      <div>
        <Btn variant="accent" onClick={startCheckout} disabled={loading} style={{ width: "100%", padding: 16 }}>
          {loading ? "Redirecting…" : "Subscribe now"} <ChevronRight size={18} />
        </Btn>
        {!trialUsed && (
          <Btn variant="ghost" onClick={handleStartTrial} disabled={trialLoading} style={{ width: "100%", padding: 14, marginTop: 8, color: "#fff", borderColor: "rgba(255,255,255,0.2)" }}>
            {trialLoading ? "Starting…" : "Start 30-day free trial instead"}
          </Btn>
        )}
        <div style={{ textAlign: "center", fontSize: 11, color: "#9CA3AF", marginTop: 10 }}>
          {trialUsed ? "🔒 Payment secured by Stripe" : "🔒 No card needed for the trial — it just ends after 30 days"}
        </div>
        <div style={{ textAlign: "center", fontSize: 11, color: "#9CA3AF", marginTop: 6 }}>
          By subscribing, you agree to our{" "}
          <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: "#9CA3AF" }}>Terms</a>
          {" "}and{" "}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: "#9CA3AF" }}>Privacy Policy</a>.
        </div>
        <button onClick={refresh} disabled={refreshing} style={{ width: "100%", background: "none", border: "none", color: "#B9BEC6", fontSize: 13, padding: "14px 0 4px", cursor: "pointer" }}>
          {refreshing ? "Checking…" : "Already subscribed? Refresh status"}
        </button>
        <button onClick={onLogout} style={{ width: "100%", background: "none", border: "none", color: "#9CA3AF", fontSize: 12, padding: "4px 0", cursor: "pointer" }}>
          Log out
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   SUBSCRIBE OVERLAY (in-app upgrade page, same offer as the paywall,
   but dismissible — reached from the Profile tab once already inside the app)
============================================================ */
function SubscribeOverlay({ account, onClose }) {
  const [plan, setPlan] = useState("monthly");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const MONTHLY_PRICE = "$7.99";
  const YEARLY_PRICE = "$59.99";
  const YEARLY_SAVE_PCT = "37%";

  async function startCheckout() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email, userId: account.id, plan }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Couldn't start checkout. Try again.");
        setLoading(false);
      }
    } catch (e) {
      setError("Couldn't start checkout. Try again.");
      setLoading(false);
    }
  }

  const FEATURES = [
    "Training program built by AI for your exact goals",
    "Personalized calorie & macro targets",
    "Workout logging with rest timers & progress charts",
    "On-demand AI coach chat, anytime you need it",
  ];

  return (
    <div className="fullscreen-overlay" style={{ background: T.ink, color: "#fff", zIndex: 65, overflowY: "auto" }}>
      <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "calc(28px + env(safe-area-inset-top, 0px)) 28px 28px", maxWidth: 560, margin: "0 auto" }}>
        <div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#B9BEC6", cursor: "pointer", padding: 0, marginBottom: 20 }}><X size={24} /></button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={20} color={T.charge} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 2, color: T.charge, fontWeight: 600 }}>OVERLOAD</span>
          </div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 32, lineHeight: 1.1, margin: "18px 0 14px", fontWeight: 700 }}>
            Upgrade to Overload
          </h1>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
            {FEATURES.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <Check size={16} color={T.charge} style={{ marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 14, color: "#D6D9DE", lineHeight: 1.4 }}>{f}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button
              onClick={() => setPlan("monthly")}
              style={{ flex: 1, padding: "10px 0", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, border: `2px solid ${plan === "monthly" ? T.charge : "rgba(255,255,255,0.15)"}`, background: plan === "monthly" ? "rgba(78,74,242,0.15)" : "transparent", color: "#fff" }}
            >
              Monthly
            </button>
            <button
              onClick={() => setPlan("yearly")}
              style={{ flex: 1, padding: "10px 0", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, border: `2px solid ${plan === "yearly" ? T.charge : "rgba(255,255,255,0.15)"}`, background: plan === "yearly" ? "rgba(78,74,242,0.15)" : "transparent", color: "#fff", position: "relative" }}
            >
              Yearly
              <span style={{ position: "absolute", top: -10, right: -6, background: T.good, color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6 }}>SAVE {YEARLY_SAVE_PCT}</span>
            </button>
          </div>

          <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 16, padding: 20, marginBottom: 14 }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 28, fontWeight: 700 }}>
              {plan === "monthly" ? MONTHLY_PRICE : YEARLY_PRICE}
              <span style={{ fontSize: 14, color: "#B9BEC6", fontWeight: 500 }}> / {plan === "monthly" ? "month" : "year"}</span>
            </div>
            <div style={{ fontSize: 13, color: "#B9BEC6", marginTop: 6 }}>Cancel anytime.</div>
          </div>
          {error && <p style={{ color: "#FF8A80", fontSize: 13 }}>{error}</p>}
        </div>
        <div>
          <Btn variant="accent" onClick={startCheckout} disabled={loading} style={{ width: "100%", padding: 16 }}>
            {loading ? "Redirecting…" : "Subscribe now"} <ChevronRight size={18} />
          </Btn>
          <div style={{ textAlign: "center", fontSize: 11, color: "#9CA3AF", marginTop: 10 }}>🔒 Payment secured by Stripe</div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ONBOARDING QUIZ
============================================================ */
const QUIZ_STEPS = [
  { key: "sex", q: "What's your sex?", sub: "Used for an accurate energy-need calculation.", type: "choice", options: [["male", "Male"], ["female", "Female"]] },
  { key: "age", q: "How old are you?", type: "number", placeholder: "e.g. 28", min: 13, max: 90 },
  { key: "heightIn", q: "How tall are you?", type: "height" },
  { key: "weightLb", q: "What's your current weight?", sub: "In pounds.", type: "number", placeholder: "e.g. 165", min: 60, max: 500 },
  { key: "goal", q: "What's your main goal?", type: "choice", options: [["lose", "Lose Fat"], ["build", "Build Muscle"], ["recomp", "Both — Lose Fat & Build Muscle"]] },
  { key: "currentPhysique", q: "How would you describe your build right now?", type: "choice", options: [["higher_bf", "Just starting, higher body fat"], ["average", "Average build, some muscle"], ["athletic", "Athletic, fairly lean already"], ["lean_low_muscle", "Lean but low muscle mass"]] },
  { key: "desiredPhysique", q: "Describe the physique you're working toward.", sub: "A sentence is plenty — e.g. \"lean and athletic\" or \"bigger arms and chest.\" This helps your coach fine-tune things later.", type: "text", placeholder: "e.g. Lean, athletic, defined abs" },
  { key: "specificGoals", q: "Any specific strength or performance goals?", sub: "Optional — list anything concrete, e.g. \"bench 315\", \"do a strict pull-up\", \"squat 2x bodyweight.\" Leave blank if none.", type: "text", placeholder: "e.g. Bench 315 lb, do 10 strict pull-ups" },
  { key: "experience", q: "Training experience?", type: "choice", options: [["beginner", "Beginner (0-1 yr)"], ["intermediate", "Intermediate (1-3 yr)"], ["advanced", "Advanced (3+ yr)"]] },
  { key: "equipment", q: "What equipment do you have?", type: "choice", options: [["full", "Full Gym"], ["dumbbell", "Dumbbells Only"], ["bodyweight", "Bodyweight Only"]] },
  { key: "daysPerWeek", q: "How many days a week can you train?", type: "choice", options: [[3, "3 days"], [4, "4 days"], [5, "5 days"], [6, "6 days"]] },
  { key: "sessionLength", q: "How long do you want each workout to be?", type: "choice", options: [[30, "~30 min"], [45, "~45 min"], [60, "~60 min"], [75, "75+ min"]] },
  { key: "activity", q: "How active is your day-to-day (outside training)?", type: "choice", options: [["sedentary", "Desk job, little walking"], ["light", "On my feet sometimes"], ["moderate", "Active job / lots of walking"], ["active", "Physically demanding day"]] },
  // "Other" lives as a checkbox right in this step (revealing an inline text
  // box when picked) rather than as its own separate quiz question — no
  // reason to make someone click Next just to say "nothing else" when they
  // could just leave a checkbox unchecked.
  { key: "injuries", q: "Any injuries or areas we should train around?", sub: "Select all that apply — we'll avoid exercises that stress these.", type: "multi", options: [["none", "None"], ["knees", "Knees"], ["shoulders", "Shoulders"], ["lower_back", "Lower back"], ["wrists", "Wrists"], ["elbows", "Elbows"], ["other", "Other"]] },
  {
    key: "notes",
    q: "Anything else your coach should know?",
    sub: "Optional, but genuinely read and used — a preferred split, exercises you just don't enjoy, equipment your gym doesn't actually have, anything that doesn't fit the questions above.",
    type: "text",
    placeholder: "e.g. \"Prefer an upper/lower split\", \"no cable machine at my gym\", \"please no burpees or box jumps\"",
  },
  {
    key: "reviewCadence",
    q: "Want periodic AI check-ins on your progress?",
    sub: "Optional — a short written review of your training and nutrition, generated automatically once a period's worth of data is in. Pick either, both, or neither; change this anytime in Settings.",
    type: "multi",
    optional: true,
    options: [["weekly", "Weekly review"], ["monthly", "Monthly review"]],
  },
];

export function Onboarding({ onComplete }) {
  const [step, setStep] = useState(-1);
  const [answers, setAnswers] = useState({});
  const [feet, setFeet] = useState(5);
  const [inches, setInches] = useState(8);
  const [building, setBuilding] = useState(false);
  const [buildNote, setBuildNote] = useState("Designing your program…");
  // Holds the finished { profile, program, targets } once built, so a short
  // summary screen can show what was made before actually entering the app
  // — onComplete() itself doesn't fire until they confirm from there.
  const [summary, setSummary] = useState(null);

  const cur = QUIZ_STEPS[step];
  const canNext = !cur ? true
    : cur.optional ? true
    : cur.type === "height" ? true
    : cur.type === "multi" ? (answers[cur.key]?.length > 0)
    : cur.type === "text" ? true
    : answers[cur.key] !== undefined && answers[cur.key] !== "";

  function setAns(key, val) {
    setAnswers((a) => ({ ...a, [key]: val }));
  }

  function toggleMulti(key, val) {
    setAnswers((a) => {
      const arr = a[key] || [];
      let next;
      if (val === "none") next = ["none"];
      else if (arr.includes(val)) next = arr.filter((v) => v !== val);
      else next = [...arr.filter((v) => v !== "none"), val];
      const result = { ...a, [key]: next };
      // Unchecking "Other" clears whatever was typed into its inline box —
      // otherwise leftover text could still show up in the injury summary
      // even though the checkbox that revealed it is now off.
      if (key === "injuries" && val === "other" && !next.includes("other")) {
        result.otherInjuries = "";
      }
      return result;
    });
  }

  function next() {
    if (cur.type === "height") setAns("heightIn", (Number(feet) || 5) * 12 + (Number(inches) || 0));
    if (step === QUIZ_STEPS.length - 1) finish();
    else setStep((s) => s + 1);
  }

  async function finish() {
    const profile = {
      ...answers,
      heightIn: answers.heightIn || (Number(feet) || 5) * 12 + (Number(inches) || 0),
      desiredPhysique: answers.desiredPhysique || "balanced, athletic build",
      specificGoals: answers.specificGoals || "",
      injuries: answers.injuries || ["none"],
      otherInjuries: answers.otherInjuries || "",
      weeklyReviewEnabled: (answers.reviewCadence || []).includes("weekly"),
      monthlyReviewEnabled: (answers.reviewCadence || []).includes("monthly"),
      name: "",
    };
    const targets = calcTargets(profile);
    setBuilding(true);
    // Instant, reliable fallback in case the AI call fails or is slow.
    let program = buildProgram(profile);
    try {
      setBuildNote("Analyzing your goals and building your split…");
      const raw = await claudeChat({
        system: buildProgramGenSystem(profile),
        messages: [{ role: "user", content: "Design my personalized training program now." }],
      });
      const parsed = parseJSONLoose(raw);
      if (parsed && Array.isArray(parsed.days) && parsed.days.length > 0) {
        program = { splitName: deriveSplitName(parsed.days) || program.splitName, days: parsed.days };
      }
    } catch (e) {
      // Fall back silently to the rule-based program below.
    }
    // Guarantees every exercise has form tips baked in — whether they came
    // from the AI (normal case) or the offline rule-based fallback above —
    // so "How to do it" during a workout never needs a live AI call.
    setBuilding(false);
    setSummary({ profile, program: normalizeProgramTips(program), targets });
  }

  if (summary) {
    return <OnboardingSummary profile={summary.profile} program={summary.program} targets={summary.targets} onContinue={() => onComplete(summary)} />;
  }

  if (building) {
    return (
      <div className="auth-screen" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "calc(28px + env(safe-area-inset-top, 0px)) 28px 28px", background: T.ink, color: "#fff", textAlign: "center" }}>
        <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
        <Loader2 size={36} color={T.charge} className="spin" />
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: "18px 0 6px" }}>{buildNote}</h2>
        <p style={{ color: "#B9BEC6", fontSize: 13, maxWidth: 280 }}>Weighing your goal, experience, equipment, injuries, and desired physique to build a program made for you.</p>
        {/* Real gap: a person watching a spinner with no sense of whether
            it's stuck or almost done tends to assume the worst. Frames the
            wait as deliberate (a real, personalized build, not a stalled
            request) and gives it an actual expectation to hold against. */}
        <p style={{ color: "#B9BEC6", fontSize: 13, maxWidth: 280, marginTop: 10 }}>
          This takes a little longer than picking from a template — we're building something specific to you. Usually ready in under a minute.
        </p>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 20, padding: "12px 14px", background: "rgba(255,255,255,0.06)", borderRadius: 10, maxWidth: 300, textAlign: "left" }}>
          <AlertCircle size={15} color="#B9BEC6" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ color: "#B9BEC6", fontSize: 11.5, lineHeight: 1.5 }}>
            Overload uses AI to build your plan. Like any AI, it can occasionally get something wrong — use your judgment, and check with a doctor or trainer for anything medical.
          </span>
        </div>
        <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (step === -1) {
    return (
      <div className="auth-screen" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "calc(28px + env(safe-area-inset-top, 0px)) 28px 28px", background: T.ink, color: "#fff" }}>
        <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 30 }}>
            <Zap size={20} color={T.charge} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 2, color: T.charge, fontWeight: 600 }}>EVIDENCE-BASED COACHING</span>
          </div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 42, lineHeight: 1.05, margin: "18px 0 0", fontWeight: 700 }}>

            Your plan,<br />built from<br /><span style={{ color: T.charge }}>your numbers.</span>
          </h1>
          <p style={{ fontFamily: "'Inter', sans-serif", color: "#B9BEC6", fontSize: 15, lineHeight: 1.5, marginTop: 18, maxWidth: 320 }}>
            A {QUIZ_STEPS.length}-question quiz covers your goals, injuries, physique targets, and schedule. You'll get a full program, calorie & macro targets — and an AI coach on call to fine-tune it any time.
          </p>
        </div>
        <Btn variant="accent" onClick={() => setStep(0)} style={{ width: "100%", padding: "16px" }}>
          Start the quiz <ChevronRight size={18} />
        </Btn>
      </div>
    );
  }

  return (
    <div className="auth-screen" style={{ display: "flex", flexDirection: "column", padding: "calc(24px + env(safe-area-inset-top, 0px)) 24px 24px", background: T.paper }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <div style={{ display: "flex", gap: 3, marginBottom: 24, flexWrap: "wrap" }}>
        {QUIZ_STEPS.map((_, i) => (
          <div key={i} style={{ flex: 1, minWidth: 12, height: 4, borderRadius: 2, background: i <= step ? T.charge : T.steel }} />
        ))}
      </div>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, fontWeight: 600 }}>
        {String(step + 1).padStart(2, "0")} / {String(QUIZ_STEPS.length).padStart(2, "0")}
      </span>
      <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 700, color: T.ink, margin: "8px 0 4px" }}>{cur.q}</h2>
      {cur.sub && <p style={{ color: T.steelDark, fontSize: 13, marginBottom: 10 }}>{cur.sub}</p>}

      <div style={{ marginTop: 14, flex: 1, overflowY: "auto" }}>
        {cur.type === "choice" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {cur.options.map(([val, label]) => (
              <button
                key={val}
                onClick={() => setAns(cur.key, val)}
                style={{
                  textAlign: "left", padding: "16px 18px", borderRadius: 12, cursor: "pointer",
                  border: `2px solid ${answers[cur.key] === val ? T.charge : T.steel}`,
                  background: answers[cur.key] === val ? "#EEEDFF" : T.card,
                  fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 15, color: T.ink,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {cur.type === "multi" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {cur.options.map(([val, label]) => {
              const active = (answers[cur.key] || []).includes(val);
              return (
                <button
                  key={val}
                  onClick={() => toggleMulti(cur.key, val)}
                  style={{
                    padding: "12px 16px", borderRadius: 20, cursor: "pointer",
                    border: `2px solid ${active ? T.charge : T.steel}`,
                    background: active ? "#EEEDFF" : T.card,
                    fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 14, color: T.ink,
                  }}
                >
                  {label}
                </button>
              );
            })}
            {cur.key === "injuries" && (answers.injuries || []).includes("other") && (
              <textarea
                autoFocus
                placeholder="Describe in your own words — e.g. torn labrum in right shoulder, sciatica"
                value={answers.otherInjuries ?? ""}
                onChange={(e) => setAns("otherInjuries", e.target.value)}
                style={{ width: "100%", marginTop: 4, padding: "14px 16px", fontSize: 15, borderRadius: 12, border: `2px solid ${T.steel}`, fontFamily: "'Inter', sans-serif", minHeight: 80, boxSizing: "border-box", resize: "vertical" }}
              />
            )}
          </div>
        )}
        {cur.type === "number" && (
          <input
            autoFocus type="number" placeholder={cur.placeholder} value={answers[cur.key] ?? ""}
            onChange={(e) => setAns(cur.key, e.target.value === "" ? "" : Number(e.target.value))}
            style={{ width: "100%", padding: "16px 18px", fontSize: 20, borderRadius: 12, border: `2px solid ${T.steel}`, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, boxSizing: "border-box" }}
          />
        )}
        {cur.type === "text" && (
          <textarea
            autoFocus placeholder={cur.placeholder} value={answers[cur.key] ?? ""}
            onChange={(e) => setAns(cur.key, e.target.value)}
            rows={3}
            style={{ width: "100%", padding: "16px 18px", fontSize: 16, borderRadius: 12, border: `2px solid ${T.steel}`, fontFamily: "'Inter', sans-serif", boxSizing: "border-box", resize: "none" }}
          />
        )}
        {cur.type === "height" && (
          <div style={{ display: "flex", gap: 12 }}>
            {[["ft", feet, setFeet, 3, 8], ["in", inches, setInches, 0, 11]].map(([lab, v, setV, min, max]) => (
              <div key={lab} style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: T.steelDark, fontWeight: 600 }}>{lab}</label>
                <input
                  type="number" value={v} min={min} max={max}
                  onChange={(e) => setV(e.target.value === "" ? "" : Number(e.target.value))}
                  onBlur={(e) => setV(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
                  style={{ width: "100%", padding: "16px", fontSize: 20, borderRadius: 12, border: `2px solid ${T.steel}`, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, boxSizing: "border-box", marginTop: 4 }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        {step > 0 && <Btn variant="ghost" onClick={() => setStep((s) => s - 1)}><ChevronLeft size={18} /></Btn>}
        <Btn variant="accent" onClick={next} disabled={!canNext} style={{ flex: 1 }}>
          {step === QUIZ_STEPS.length - 1 ? "Build my plan" : "Next"} <ChevronRight size={18} />
        </Btn>
      </div>
    </div>
  );
}

// Shown once, right after the quiz builds a program and before the person
// ever lands in the app itself — a beta report flagged that people didn't
// realize their split (or anything else) could be changed by just asking
// the Coach, so this is also the first place that gets said explicitly,
// before they've even seen the app.
export function OnboardingSummary({ profile, program, targets, onContinue }) {
  const goalLabel = (GOAL_SCHEME[profile.goal] || GOAL_SCHEME.recomp).label;
  return (
    <div className="auth-screen" style={{ display: "flex", flexDirection: "column", background: T.paper, padding: "calc(24px + env(safe-area-inset-top, 0px)) 20px calc(20px + env(safe-area-inset-bottom, 0px))", boxSizing: "border-box" }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={18} color={T.charge} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: 1.5, color: T.charge, fontWeight: 600 }}>YOUR PLAN IS READY</span>
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "8px 0 4px", color: T.ink }}>Here's what we built you.</h1>
        <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 14, color: T.steelDark, lineHeight: 1.5, margin: "0 0 20px" }}>
          Built around {goalLabel.toLowerCase()}, {profile.daysPerWeek} days a week, ~{profile.sessionLength} min sessions.
        </p>

        <TickRule label="Your split" />
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 700, color: T.ink }}>{program.splitName}</span>
            <Dumbbell size={20} color={T.charge} />
          </div>
          <div>
            {program.days.map((d, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: i > 0 ? `1px solid ${T.steel}` : "none" }}>
                <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600, color: T.ink }}>{d.name}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark }}>{d.exercises.length} exercises</span>
              </div>
            ))}
          </div>
        </Card>

        <TickRule label="Food goals" />
        <Card style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 700, color: T.ink }}>
              {targets.calories}<span style={{ fontSize: 13, color: T.steelDark }}> cal / day</span>
            </div>
            <Flame size={24} color={T.charge} />
          </div>
        </Card>
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <StatChip label="Protein" val={`${targets.protein}g`} color={T.protein} icon={<Beef size={16} color={T.protein} />} />
          <StatChip label="Carbs" val={`${targets.carbs}g`} color={T.carb} icon={<Wheat size={16} color={T.carb} />} />
          <StatChip label="Fat" val={`${targets.fat}g`} color={T.fat} icon={<Droplet size={16} color={T.fat} />} />
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#fff", border: `1px solid ${T.steel}`, borderRadius: 12, padding: 14 }}>
          <MessageCircle size={18} color={T.charge} style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: T.ink, lineHeight: 1.5, margin: 0 }}>
            None of this is locked in — want a different split, different exercises, or your numbers adjusted? Just tell your Coach any time.
          </p>
        </div>
      </div>

      <Btn variant="accent" onClick={onContinue} style={{ width: "100%", padding: "16px", marginTop: 16, flexShrink: 0 }}>
        Let's go <ChevronRight size={18} />
      </Btn>
    </div>
  );
}

/* ============================================================
   REST TIMER
============================================================ */
function RestTimer({ seconds, total, onAdd, onSkip }) {
  const pct = Math.max(0, seconds / total);
  const done = seconds <= 0;
  return (
    <div className="fullscreen-overlay" style={{ background: "rgba(18,22,28,0.92)", zIndex: 60, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff" }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 2, color: done ? T.good : T.charge, fontWeight: 700 }}>
        {done ? "REST COMPLETE" : "RESTING"}
      </span>
      <div style={{ position: "relative", margin: "24px 0" }}>
        <Ring value={pct} max={1} size={200} stroke={10} color={done ? T.good : T.charge}>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 52, fontWeight: 700 }}>{Math.max(0, seconds)}</span>
        </Ring>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        {!done && <Btn variant="ghost" onClick={onAdd} style={{ color: "#fff", borderColor: "#3A4048" }}><PlusCircle size={16} /> 15s</Btn>}
        <Btn variant="accent" onClick={onSkip}>{done ? "Continue" : <>Skip <SkipForward size={16} /></>}</Btn>
      </div>
    </div>
  );
}

/* ============================================================
   WORKOUT SESSION
============================================================ */
// Resuming a saved-and-exited workout used to restore the OLD saved sets
// wholesale, completely replacing whatever the current exercise list
// actually is — so any Coach change made while the workout sat saved (a
// todayOverride swap, a permanent program edit) was silently discarded on
// resume. Real report: "Legs still has trap bar deadlift" no matter how
// many times Coach resent the override, because resuming always restored
// the pre-override snapshot regardless. Fresh exercises (added/swapped
// since saving) get blank logged sets; exercises that are still there by
// name keep whatever was already logged for them — so real progress
// survives a save/resume cycle AND a Coach-driven change actually takes.
export function mergeResumedSets(freshExercises, savedSets, logs) {
  if (!savedSets) return null;
  const savedByName = new Map(savedSets.map((s) => [s.name, s]));
  return freshExercises.map((ex) => savedByName.get(ex.name) || {
    name: ex.name, reps: ex.reps, rest: ex.rest, tips: ex.tips,
    logged: seedLoggedSets(ex, logs),
  });
}

// Pre-fills a fresh exercise's weight/reps from the last time it was
// actually logged, instead of starting every set blank — the app already
// computed and showed this as a "Last time: Xlb x Y" text hint, but still
// made a person retype it into every single set field. Falls back to blank
// (exactly the old behavior) when there's no history yet for this exercise.
export function seedLoggedSets(ex, logs) {
  const last = logs ? exerciseLastSession(logs, ex.name) : null;
  return Array.from({ length: ex.sets }, (_, i) => {
    const prior = last?.sets?.[i];
    return prior ? { weight: String(prior.weight), reps: String(prior.reps), done: false } : { weight: "", reps: "", done: false };
  });
}

export function WorkoutSession({ day, isOverride, lastLog, logs, initialSets, onFinish, onCancel, onSaveExit, equipment, injuries, onSwapExercise, onCacheAlternatives, gifCache: propGifCache, onCacheGif, resumedAt, priorActiveSeconds }) {
  const [sets, setSets] = useState(() =>
    mergeResumedSets(day.exercises, initialSets, logs) || day.exercises.map((ex) => ({
      name: ex.name, reps: ex.reps, rest: ex.rest, tips: ex.tips,
      logged: seedLoggedSets(ex, logs),
    }))
  );
  // {endAt: <absolute ms timestamp>, total: <seconds>} — NOT a countdown
  // decremented once per tick. A real report: backgrounding the app (or the
  // phone locking) paused the rest timer, which then resumed counting down
  // from wherever it left off instead of reflecting real elapsed time —
  // because a tick-based countdown has no idea how much real time actually
  // passed while its setInterval was throttled/suspended in the background.
  // Storing a fixed absolute end time and recomputing "seconds left" from
  // Date.now() every render means the very first tick after returning to
  // the app immediately shows the true remaining time, background gap and
  // all — the timer effectively keeps running the whole time, it just isn't
  // drawn while backgrounded.
  const [rest, setRest] = useState(null);
  const [restTick, setRestTick] = useState(0); // bumped to force a re-render; the real value always comes from Date.now() vs rest.endAt, never from this counter
  const restSecondsLeft = rest ? Math.max(0, Math.round((rest.endAt - Date.now()) / 1000)) : null;
  // Live "how long have I been at this" display in the header — same
  // absolute-timestamp technique as the rest timer above (immune to
  // background throttling), reusing the exact accumulateActiveSeconds()
  // math the app already uses to save real duration once the workout is
  // finished, so the live number and the saved one can never disagree.
  const [elapsedTick, setElapsedTick] = useState(0);
  useEffect(() => {
    const tick = () => setElapsedTick((t) => t + 1);
    const interval = setInterval(tick, 1000);
    // visibilitychange alone has historically been inconsistent on iOS
    // Safari standalone PWAs specifically around a screen lock/unlock
    // (as opposed to switching apps) — pageshow and window focus are
    // cheap, harmless extra triggers for the same recompute, so a lock
    // screen is covered even if one event doesn't fire reliably.
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("pageshow", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("pageshow", tick);
      window.removeEventListener("focus", tick);
    };
  }, []);
  const elapsedSeconds = resumedAt ? accumulateActiveSeconds(priorActiveSeconds, resumedAt, Date.now()) : 0;
  const [confirmExit, setConfirmExit] = useState(false);
  const [exerciseInfoIdx, setExerciseInfoIdx] = useState(null); // index of the exercise showing its full-screen info page, or null
  const [gifLoading, setGifLoading] = useState({}); // exercise name -> true while the one-time WorkoutX lookup is in flight
  const [swapPickerIdx, setSwapPickerIdx] = useState(null); // index of the exercise currently picking an alternative for
  const [selectedAlt, setSelectedAlt] = useState(null); // alternative exercise name chosen, awaiting today/permanent choice
  const [showCustomAlt, setShowCustomAlt] = useState(false); // "none of these" typed-in-your-own mode
  const [customAlt, setCustomAlt] = useState("");
  const [pickerAlts, setPickerAlts] = useState([]); // resolved alternatives list for the open picker
  const [pickerLoading, setPickerLoading] = useState(false);
  const [detailFor, setDetailFor] = useState(null); // exercise name currently showing history/PR detail, or null
  const [prCelebration, setPrCelebration] = useState(null); // {name, weight, reps} just beaten, or null
  const intervalRef = useRef(null);

  // Auto-dismiss the PR toast — it's a celebratory nudge, not something that
  // should need a tap to clear mid-set.
  useEffect(() => {
    if (!prCelebration) return;
    const t = setTimeout(() => setPrCelebration(null), 4000);
    return () => clearTimeout(t);
  }, [prCelebration]);

  // Resolves the alternatives list whenever the picker opens for a new
  // exercise: use what's already baked into the program if present, else
  // try a one-time live "similar exercises" lookup (caching the result so
  // it never has to run twice), and only fall back to the coarser
  // pool-based matching if that's not possible (offline, or the call fails).
  useEffect(() => {
    if (swapPickerIdx === null) return;
    const current = sets[swapPickerIdx];
    if (Array.isArray(current.alternatives) && current.alternatives.length > 0) {
      setPickerAlts(current.alternatives);
      return;
    }
    let cancelled = false;
    setPickerLoading(true);
    fetchSimilarExercises(current.name, equipment, injuries)
      .then((alts) => {
        if (cancelled) return;
        if (alts.length > 0) {
          setPickerAlts(alts);
          onCacheAlternatives(swapPickerIdx, alts);
        } else {
          setPickerAlts(alternativesFor(current.name, equipment, injuries));
        }
      })
      .catch(() => {
        if (!cancelled) setPickerAlts(alternativesFor(current.name, equipment, injuries));
      })
      .finally(() => {
        if (!cancelled) setPickerLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapPickerIdx]);

  // Applies the swap immediately to this in-progress session (so it's
  // reflected right away, mid-workout, without waiting on a re-render from
  // the parent) and separately persists it — "today" only or permanently —
  // via the callback the parent provides.
  function applySwap(exIdx, newName, scope) {
    setSets((s) => {
      const copy = [...s];
      const old = copy[exIdx];
      copy[exIdx] = {
        name: newName,
        reps: old.reps,
        rest: old.rest,
        tips: tipsForExercise(newName),
        // A different exercise means previously logged weight/reps for the
        // OLD one don't carry over — but if the NEW one has its own
        // history, pre-fill from that instead of starting blank.
        logged: seedLoggedSets({ name: newName, sets: old.logged.length }, logs),
      };
      return copy;
    });
    onSwapExercise(exIdx, newName, scope);
    setSwapPickerIdx(null);
    setSelectedAlt(null);
  }

  // Tips are baked into the exercise data at program-generation time (see
  // normalizeProgramTips/tipsForExercise), so this is just a local toggle —
  // no AI call, no loading state, works with zero signal at the gym.
  // Demo GIF lookup is lazy and one-time per exercise NAME, ever — only
  // fires the first time someone opens "How to do it" for a name that
  // isn't in gifCache yet (never at program-generation time), since the
  // free WorkoutX tier is a shared 500 requests/month, not per-user.
  // gifCache[key]: absent = never checked, null = checked and confirmed
  // none found, a string = the real URL.
  // Local, in-session mirror of the GLOBAL gifCache prop — lets a fresh
  // lookup show up immediately without waiting on the parent's persist
  // round-trip (same reasoning as the two-write pattern used elsewhere:
  // the parent's gifCache prop won't reflect a change until after persist()
  // resolves and a re-render happens, which is too slow for "tap and see
  // the GIF appear").
  const [localGifCache, setLocalGifCache] = useState({});
  const gifCache = { ...(propGifCache || {}), ...localGifCache };
  // Distinct from "confirmed unavailable" (which lives in gifCache as
  // null) — this is "we tried just now and couldn't tell," so the UI can
  // be honest about the difference instead of implying WorkoutX was
  // actually checked and came back empty.
  const [gifTransientError, setGifTransientError] = useState({});

  function loadGif(name) {
    const key = normalizeGifKey(name);
    setGifLoading((g) => ({ ...g, [key]: true }));
    setGifTransientError((g) => ({ ...g, [key]: false }));
    fetchExerciseGif(name).then(({ gifUrl, confirmed }) => {
      // Only a CONFIRMED result gets permanently cached. Caching an
      // unconfirmed failure (offline, a key that wasn't set up yet, quota,
      // a network hiccup) would mean a transient problem becomes a
      // PERMANENT "no GIF," with no way to ever retry once the real
      // problem's fixed — that was the actual bug behind "nothing shows up
      // in the console," since the fetch was never even firing again after
      // the first, uncached-away failure.
      if (confirmed) {
        setLocalGifCache((c) => ({ ...c, [key]: gifUrl }));
        onCacheGif?.(key, gifUrl);
      } else {
        setGifTransientError((g) => ({ ...g, [key]: true }));
      }
      setGifLoading((g) => ({ ...g, [key]: false }));
    });
  }

  // Opens the full-screen exercise info page (demo GIF + tips) — tapping
  // either the exercise's own name or "How to do it" leads here now,
  // instead of a small inline expand.
  function openExerciseInfo(exIdx, name) {
    setExerciseInfoIdx(exIdx);
    const key = normalizeGifKey(name);
    // Real usage data: the same exercise appearing on more than one day of
    // a program (very common) used to trigger a separate fetch for each
    // occurrence, because the cache lived per exercise-object instead of
    // per exercise NAME. Checking the shared gifCache here — instead of
    // some per-exercise field — is what actually makes "ask WorkoutX for
    // this exercise at most once, ever" true.
    if (!(key in gifCache) && !gifLoading[key]) {
      loadGif(name);
    }
  }

  useEffect(() => {
    if (rest === null) return;
    const tick = () => setRestTick((t) => t + 1);
    intervalRef.current = setInterval(tick, 1000);
    // Forces an immediate recompute the moment the tab/app comes back to
    // the foreground, rather than waiting up to a full second for the next
    // natural tick — the number should already be correct either way, this
    // just makes it visibly catch up instantly instead of lagging.
    // visibilitychange alone has historically been inconsistent on iOS
    // Safari standalone PWAs around a screen lock/unlock specifically (as
    // opposed to switching apps) — pageshow and window focus are cheap,
    // harmless extra triggers for the same recompute.
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("pageshow", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("pageshow", tick);
      window.removeEventListener("focus", tick);
    };
  }, [rest === null]);

  function updateSet(exIdx, setIdx, field, val) {
    setSets((s) => {
      const copy = s.map((e) => ({ ...e, logged: e.logged.map((l) => ({ ...l })) }));
      copy[exIdx].logged[setIdx][field] = val;
      return copy;
    });
  }

  // Real bug found from beta-tester feedback ("skip turns the timer off for
  // the rest of the workout"): this used to read a "should I start a rest
  // timer" flag from a variable set inside the setSets() updater, right
  // after calling setSets() — React doesn't guarantee that updater runs
  // synchronously, so the flag could still read as stale/false, silently
  // skipping the new timer. Same root cause as the earlier persist() bug —
  // fixed the same way, by triggering the side effect from inside the
  // updater itself, where the computed value is always current.
  function toggleDone(exIdx, setIdx) {
    setSets((s) => {
      const copy = s.map((e) => ({ ...e, logged: e.logged.map((l) => ({ ...l })) }));
      const newVal = !copy[exIdx].logged[setIdx].done;
      copy[exIdx].logged[setIdx].done = newVal;
      if (newVal) {
        const restSeconds = copy[exIdx].rest;
        setRest({ endAt: Date.now() + restSeconds * 1000, total: restSeconds });

        // Real PR check, computed from the same copy the rest-timer read
        // above (the established safe pattern here — never read a value
        // back out after setSets instead of inside the updater itself).
        // exercisePR only sees logs from BEFORE this workout was saved, so
        // this only fires for a genuine new best, not just "heavier than
        // an earlier set tonight." Requires an actual PRIOR value to beat —
        // "no history found" used to celebrate too (nothing to lose to),
        // but that fires just as easily when a name simply doesn't match
        // old history (a rename, a regenerated program) as it does for a
        // real first-ever log, and either way it's not a genuine beaten
        // record. Real report: it read as "tying a PR shouldn't count as a
        // PR" — no prior match at all is the same case, just with no
        // number to visibly tie.
        const justLogged = copy[exIdx].logged[setIdx];
        const weight = Number(justLogged.weight);
        const reps = Number(justLogged.reps);
        if (logs && weight > 0 && reps > 0) {
          const priorPR = exercisePR(logs, copy[exIdx].name);
          if (priorPR && (weight > priorPR.weight || (weight === priorPR.weight && reps > priorPR.reps))) {
            setPrCelebration({ name: copy[exIdx].name, weight, reps });
          }
        }
      }
      return copy;
    });
  }

  function lastFor(name) {
    if (!lastLog) return null;
    const found = lastLog.exercises.find((e) => e.name === name);
    if (!found) return null;
    const withWeight = found.logged.filter((l) => l.weight);
    if (withWeight.length === 0) return null;
    // Show the heaviest set from last time — that's the real benchmark to
    // beat for progressive overload, not just whichever set was logged last.
    const best = withWeight.reduce((max, l) => (Number(l.weight) > Number(max.weight) ? l : max), withWeight[0]);
    return `${best.weight}lb x ${best.reps}`;
  }

  const totalSets = sets.reduce((a, e) => a + e.logged.length, 0);
  const doneSets = sets.reduce((a, e) => a + e.logged.filter((l) => l.done).length, 0);
  const elapsedMin = Math.floor(elapsedSeconds / 60);
  const elapsedSec = elapsedSeconds % 60;
  const elapsedLabel = `${elapsedMin}:${String(elapsedSec).padStart(2, "0")}`;

  return (
    <div className="fullscreen-overlay" style={{ background: T.paper, zIndex: 50, display: "flex", flexDirection: "column" }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <div style={{ background: T.ink, padding: "calc(18px + env(safe-area-inset-top, 0px)) 20px 22px", color: "#fff", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => setConfirmExit(true)} style={{ background: "none", border: "none", color: "#B9BEC6", cursor: "pointer" }}><X size={22} /></button>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {resumedAt && (
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#B9BEC6", fontWeight: 600 }}>
                <Clock size={12} /> {elapsedLabel}
              </span>
            )}
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: T.charge, fontWeight: 700 }}>{doneSets}/{totalSets} SETS</span>
          </div>
        </div>
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 700, margin: "10px 0 0" }}>{day.name}</h2>
        {isOverride && (
          <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(78,74,242,0.2)", color: T.charge, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20 }}>
            <Sparkles size={12} /> SWAPPED BY COACH FOR TODAY ONLY
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {/* Direct answer to real beta-tester confusion: she didn't realize
            the checkmark both logs the set AND starts a rest timer. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: T.card, border: `1px solid ${T.steel}`, borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: T.steel, color: "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Check size={14} />
          </div>
          <span style={{ fontSize: 12, color: T.steelDark, lineHeight: 1.4 }}>
            Enter your weight and reps, then tap the checkmark to log that set and start your rest timer.
          </span>
        </div>
        {sets.map((ex, exIdx) => (
          <Card key={exIdx} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h3
                onClick={() => openExerciseInfo(exIdx, ex.name)}
                style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 700, margin: 0, cursor: "pointer", textDecoration: "underline", textDecorationColor: T.steel, textUnderlineOffset: 3 }}
              >
                {ex.name}
              </h3>
              <span style={{ fontSize: 12, color: T.steelDark, fontFamily: "'JetBrains Mono', monospace" }}>{ex.reps} reps · {ex.rest}s rest</span>
            </div>
            {lastFor(ex.name) && (
              <div style={{ fontSize: 12, color: T.charge, marginTop: 4, fontWeight: 600 }}>Last time: {lastFor(ex.name)}</div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                onClick={() => openExerciseInfo(exIdx, ex.name)}
                style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: T.steelDark, fontSize: 12, fontWeight: 600, padding: "8px 0 0", cursor: "pointer" }}
              >
                <Info size={13} /> How to do it
                <ChevronRight size={13} />
              </button>
              <button
                onClick={() => { setSelectedAlt(null); setShowCustomAlt(false); setCustomAlt(""); setSwapPickerIdx(exIdx); }}
                style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: T.steelDark, fontSize: 12, fontWeight: 600, padding: "8px 0 0", cursor: "pointer" }}
              >
                <Repeat size={13} /> Find alternative
              </button>
              <button
                onClick={() => setDetailFor(ex.name)}
                style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: T.steelDark, fontSize: 12, fontWeight: 600, padding: "8px 0 0", cursor: "pointer" }}
              >
                <TrendingUp size={13} /> History & PR
              </button>
            </div>
            <div style={{ marginTop: 10 }}>
              {ex.logged.map((l, setIdx) => (
                <div key={setIdx} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ width: 16, flexShrink: 0, fontSize: 12, color: T.steelDark, fontFamily: "'JetBrains Mono', monospace" }}>{setIdx + 1}</span>
                  <input
                    type="number" placeholder="lb" value={l.weight}
                    onChange={(e) => updateSet(exIdx, setIdx, "weight", e.target.value)}
                    // Fields are now often pre-filled from last time — select
                    // the whole value on focus so tapping in and typing
                    // immediately overwrites it, instead of appending after
                    // whatever's already there.
                    onFocus={(e) => e.target.select()}
                    style={{ flex: 1, minWidth: 0, padding: "10px 6px", borderRadius: 8, border: `1.5px solid ${T.steel}`, fontFamily: "'JetBrains Mono', monospace", fontSize: 16, boxSizing: "border-box" }}
                  />
                  {/* Quick bump instead of retyping the whole number — the
                      common case mid-workout is "same as last time, plus a
                      bit," not a fresh value. */}
                  <button
                    onClick={() => updateSet(exIdx, setIdx, "weight", String((Number(l.weight) || 0) + 5))}
                    aria-label={`Add 5 pounds to set ${setIdx + 1}`}
                    style={{ flexShrink: 0, width: 30, height: 34, borderRadius: 8, border: `1.5px solid ${T.steel}`, background: "#fff", color: T.steelDark, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                  >
                    +5
                  </button>
                  <input
                    type="number" placeholder="reps" value={l.reps}
                    onChange={(e) => updateSet(exIdx, setIdx, "reps", e.target.value)}
                    onFocus={(e) => e.target.select()}
                    style={{ flex: 1, minWidth: 0, padding: "10px 6px", borderRadius: 8, border: `1.5px solid ${T.steel}`, fontFamily: "'JetBrains Mono', monospace", fontSize: 16, boxSizing: "border-box" }}
                  />
                  <button
                    onClick={() => toggleDone(exIdx, setIdx)}
                    aria-label={l.done ? `Set ${setIdx + 1} done, tap to undo` : `Mark set ${setIdx + 1} done and start rest timer`}
                    style={{
                      width: 34, height: 34, borderRadius: 8, border: "none", flexShrink: 0,
                      background: l.done ? T.good : T.steel, color: "#fff", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Check size={18} />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <div style={{ padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))", background: T.paper, borderTop: `1px solid ${T.steel}`, flexShrink: 0 }}>
        <Btn variant="accent" style={{ width: "100%", padding: 16 }} onClick={() => onFinish(sets)}>
          Finish workout <Check size={18} />
        </Btn>
      </div>

      {rest !== null && (
        <RestTimer
          seconds={restSecondsLeft} total={rest.total}
          onAdd={() => setRest((r) => ({ ...r, endAt: r.endAt + 15000, total: r.total + 15 }))}
          onSkip={() => setRest(null)}
        />
      )}

      {confirmExit && (
        <div className="fullscreen-overlay" style={{ background: "rgba(18,22,28,0.92)", zIndex: 70, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", padding: 28, textAlign: "center" }}>
          <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>Exit this workout?</h3>
          <p style={{ color: "#B9BEC6", fontSize: 14, maxWidth: 320, marginBottom: 24 }}>Save your progress to pick it back up later, or discard it completely.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 320 }}>
            <Btn variant="accent" onClick={() => onSaveExit(sets)} style={{ width: "100%" }}>Save & exit</Btn>
            <Btn variant="ghost" onClick={onCancel} style={{ width: "100%", color: "#fff", borderColor: "rgba(255,255,255,0.25)" }}>Discard workout</Btn>
            <button onClick={() => setConfirmExit(false)} style={{ background: "none", border: "none", color: "#B9BEC6", fontSize: 13, cursor: "pointer", padding: "8px 0" }}>Keep training</button>
          </div>
        </div>
      )}

      {swapPickerIdx !== null && (() => {
        const current = sets[swapPickerIdx];
        const alternatives = pickerAlts;
        function close() { setSwapPickerIdx(null); setSelectedAlt(null); setShowCustomAlt(false); setCustomAlt(""); }
        return (
          <div className="fullscreen-overlay" style={{ background: T.paper, zIndex: 70, display: "flex", flexDirection: "column" }}>
            <div style={{ background: T.ink, padding: "calc(18px + env(safe-area-inset-top, 0px)) 20px 18px", color: "#fff", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#B9BEC6", letterSpacing: 1, fontWeight: 600 }}>REPLACING</span>
                <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: "2px 0 0" }}>{current.name}</h2>
              </div>
              <button onClick={close} style={{ background: "none", border: "none", color: "#B9BEC6", cursor: "pointer" }}><X size={22} /></button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {pickerLoading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 30, fontSize: 13, color: T.steelDark }}>
                  <Loader2 size={16} className="spin" /> Finding similar exercises…
                </div>
              ) : selectedAlt ? (
                <div>
                  <Card style={{ marginBottom: 16 }}>
                    <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 700, margin: 0 }}>{selectedAlt}</h3>
                    <ul style={{ margin: "8px 0 0", paddingLeft: 16 }}>
                      {tipsForExercise(selectedAlt).map((tip, i) => (
                        <li key={i} style={{ fontSize: 12, color: T.ink, lineHeight: 1.5, marginBottom: 4 }}>{tip}</li>
                      ))}
                    </ul>
                  </Card>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <Btn variant="accent" style={{ width: "100%" }} onClick={() => applySwap(swapPickerIdx, selectedAlt, "today")}>
                      Just for today
                    </Btn>
                    <Btn variant="ghost" style={{ width: "100%" }} onClick={() => applySwap(swapPickerIdx, selectedAlt, "permanent")}>
                      Permanently, going forward
                    </Btn>
                    <button onClick={() => setSelectedAlt(null)} style={{ background: "none", border: "none", color: T.steelDark, fontSize: 13, cursor: "pointer", padding: "8px 0" }}>
                      Choose a different exercise
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {alternatives.length === 0 && (
                    <p style={{ color: T.steelDark, fontSize: 13, textAlign: "center", margin: "10px 0" }}>No alternatives available for this exercise with your current equipment.</p>
                  )}
                  {alternatives.map((name) => (
                    <button
                      key={name}
                      onClick={() => setSelectedAlt(name)}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "#fff", border: `1px solid ${T.steel}`, borderRadius: 10, cursor: "pointer", textAlign: "left", fontFamily: "'Inter', sans-serif", fontSize: 14, fontWeight: 600, color: T.ink }}
                    >
                      {name}
                      <ChevronRight size={16} color={T.steelDark} />
                    </button>
                  ))}
                  {/* Real gap: the picker used to just dead-end here with
                      "no alternatives available" and nothing else to do.
                      Whether the list is empty or just doesn't have what
                      they want, they can always type their own. */}
                  {showCustomAlt ? (
                    <div style={{ padding: 14, background: "#fff", border: `1px solid ${T.steel}`, borderRadius: 10 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: T.steelDark, display: "block", marginBottom: 6 }}>
                        Enter the exercise you'd like instead
                      </label>
                      <input
                        value={customAlt} onChange={(e) => setCustomAlt(e.target.value)}
                        placeholder="e.g. Cable Fly" autoFocus
                        style={{ width: "100%", padding: "12px 14px", borderRadius: 8, border: `1.5px solid ${T.steel}`, fontFamily: "'Inter', sans-serif", fontSize: 15, boxSizing: "border-box", marginBottom: 10 }}
                      />
                      <Btn variant="accent" style={{ width: "100%" }} disabled={!customAlt.trim()} onClick={() => setSelectedAlt(customAlt.trim())}>
                        Use this exercise
                      </Btn>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowCustomAlt(true)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "14px 16px", background: "none", border: `1.5px dashed ${T.steel}`, borderRadius: 10, cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600, color: T.steelDark }}
                    >
                      None of these — request my own
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {detailFor && <ExerciseDetailSheet name={detailFor} logs={logs} onClose={() => setDetailFor(null)} />}

      {exerciseInfoIdx !== null && sets[exerciseInfoIdx] && (() => {
        const ex = sets[exerciseInfoIdx];
        const key = normalizeGifKey(ex.name);
        return (
          <div className="fullscreen-overlay" style={{ background: T.paper, zIndex: 70, display: "flex", flexDirection: "column" }}>
            <div style={{ background: T.ink, padding: "calc(18px + env(safe-area-inset-top, 0px)) 20px 18px", color: "#fff", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#B9BEC6", letterSpacing: 1, fontWeight: 600 }}>HOW TO DO IT</span>
                <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: "2px 0 0" }}>{ex.name}</h2>
              </div>
              <button onClick={() => setExerciseInfoIdx(null)} aria-label="Close exercise info" style={{ background: "none", border: "none", color: "#B9BEC6", cursor: "pointer" }}><X size={22} /></button>
            </div>
            {/* max-width + centering — this overlay spans the full browser
                width on desktop (it's outside .app-main-inner's own
                max-width, being a fullscreen-overlay), so an un-capped GIF
                was stretching to fill a 1000px+ wide column and getting
                blown up well past its real resolution. Fine on a phone
                (100% already lands well under this cap), broken on a wide
                desktop window. */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              <div style={{ maxWidth: 480, margin: "0 auto" }}>
              {gifLoading[key] ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: T.steelDark, marginBottom: 14 }}>
                  <Loader2 size={16} className="spin" /> Loading demo…
                </div>
              ) : gifCache[key] ? (
                <img
                  src={gifProxyUrl(gifCache[key])} alt={`${ex.name} demonstration`}
                  style={{ width: "100%", borderRadius: 10, display: "block", marginBottom: 14 }}
                />
              ) : key in gifCache ? (
                // No Retry here, deliberately — this is a CONFIRMED "no
                // match," not a glitch, so retrying would just spend
                // another shared WorkoutX request for the same answer.
                // Unlike the transient-error case below, there's no
                // realistic reason this would resolve differently a few
                // seconds later.
                <Card style={{ marginBottom: 14 }}>
                  <span style={{ fontSize: 13, color: T.steelDark, fontStyle: "italic" }}>Instructional video unavailable for this exercise.</span>
                </Card>
              ) : gifTransientError[key] ? (
                <Card style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13, color: T.steelDark, fontStyle: "italic" }}>Couldn't check for a demo right now.</span>
                  <button onClick={() => loadGif(ex.name)} style={{ background: "none", border: "none", color: T.chargeDeep, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0, flexShrink: 0 }}>Retry</button>
                </Card>
              ) : null}
              <Card>
                <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, margin: "0 0 8px" }}>Form cues</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {(ex.tips && ex.tips.length > 0 ? ex.tips : tipsForExercise(ex.name)).map((tip, i) => (
                    <li key={i} style={{ fontSize: 13, color: T.ink, lineHeight: 1.6, marginBottom: 6 }}>{tip}</li>
                  ))}
                </ul>
              </Card>
              </div>
            </div>
          </div>
        );
      })()}

      {prCelebration && (
        <div
          role="status"
          style={{
            position: "fixed", top: "calc(20px + env(safe-area-inset-top, 0px))", left: 16, right: 16, zIndex: 65,
            display: "flex", alignItems: "center", gap: 10, background: T.charge, color: "#fff", borderRadius: 12,
            padding: "12px 14px", boxShadow: "0 8px 24px rgba(78,74,242,0.45)",
          }}
        >
          <Award size={20} color="#fff" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>NEW PR</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{prCelebration.name} · {prCelebration.weight}lb × {prCelebration.reps}</div>
          </div>
          <button onClick={() => setPrCelebration(null)} aria-label="Dismiss PR notification" style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// Mid-workout "how have I actually done on this before" view — a personal
// record and a real set-by-set breakdown of the last time it was logged,
// plus a lightweight trend, all built from the same real logged history the
// rest of the app already tracks (nothing new to enter). Deliberately not a
// long scrollable session-by-session log like most lifting-tracker apps'
// exercise history — the goal here is "what do I need to beat today," at a
// glance, mid-set, not a full log to read.
function ExerciseDetailSheet({ name, logs, onClose }) {
  const pr = exercisePR(logs, name);
  const lastSession = exerciseLastSession(logs, name);
  const trend = exerciseHistory(logs, name).slice(-6); // oldest -> newest, most recent 6
  const maxWeight = trend.length > 0 ? Math.max(...trend.map((h) => h.weight)) : 0;

  return (
    <div className="fullscreen-overlay" style={{ background: T.paper, zIndex: 70, display: "flex", flexDirection: "column" }}>
      <div style={{ background: T.ink, padding: "calc(18px + env(safe-area-inset-top, 0px)) 20px 18px", color: "#fff", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#B9BEC6", letterSpacing: 1, fontWeight: 600 }}>HISTORY & PR</span>
          <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: "2px 0 0" }}>{name}</h2>
        </div>
        <button onClick={onClose} aria-label="Close exercise history" style={{ background: "none", border: "none", color: "#B9BEC6", cursor: "pointer" }}><X size={22} /></button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {!pr ? (
          <p style={{ color: T.steelDark, fontSize: 13, textAlign: "center", marginTop: 30 }}>No history yet for this exercise — today's log will start it.</p>
        ) : (
          <>
            <Card style={{ background: T.ink, border: "none", marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(78,74,242,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Award size={20} color={T.charge} />
              </div>
              <div>
                <div style={{ color: "#B9BEC6", fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>PERSONAL RECORD</div>
                <div style={{ color: "#fff", fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700 }}>{pr.weight}lb × {pr.reps}</div>
              </div>
            </Card>

            {lastSession && (
              <>
                <TickRule label={`Last time · ${lastSession.date}`} />
                <Card style={{ marginBottom: 12 }}>
                  {lastSession.sets.map((s, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: i > 0 ? `1px solid ${T.steel}` : "none" }}>
                      <span style={{ fontSize: 11, color: T.steelDark, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>SET {i + 1}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>{s.weight}lb × {s.reps}</span>
                    </div>
                  ))}
                </Card>
              </>
            )}

            {trend.length > 1 && (
              <>
                <TickRule label="Trend" />
                <Card>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 64 }}>
                    {trend.map((h, i) => (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                        <span style={{ fontSize: 9, color: T.steelDark, fontFamily: "'JetBrains Mono', monospace", marginBottom: 3 }}>{h.weight}</span>
                        <div style={{ width: "100%", maxWidth: 22, borderRadius: 4, background: i === trend.length - 1 ? T.charge : T.steel, height: `${Math.max(14, (h.weight / maxWeight) * 100)}%` }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    {trend.map((h, i) => (
                      <span key={i} style={{ flex: 1, fontSize: 9, color: T.steelDark, textAlign: "center" }}>{h.dateLabel}</span>
                    ))}
                  </div>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   MAIN SCREENS: HOME / TRAIN
============================================================ */
function StatChip({ label, val, color, icon }) {
  return (
    <Card style={{ flex: 1, textAlign: "center", padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>{icon}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15, color: T.ink }}>{val}</div>
      <div style={{ fontSize: 10, color: T.steelDark, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    </Card>
  );
}

export function Home({ state, setActiveTab, startWorkout, onAskCoach }) {
  const { program, targets, logs, profile } = state;
  const [insightDismissed, setInsightDismissed] = useState(false);
  const insight = insightDismissed ? null : detectCoachInsight(state);
  const nextIdx = logs.workouts.length % program.days.length;
  // Same fix as the active workout screen: a Coach todayOverride swap has
  // no name of its own, so the preview card must derive one too — showing
  // the stale scheduled day's name/count here (before they even tap "Start
  // workout") was the same mismatch, just one screen earlier.
  const hasTodayOverride = Array.isArray(state.todayOverride) && state.todayOverride.length > 0;
  const nextDay = hasTodayOverride
    ? { ...program.days[nextIdx], name: overrideDayName(state.todayOverride), exercises: state.todayOverride }
    : program.days[nextIdx];
  const today = todayISO();
  const todayMeals = (logs.nutrition.find((d) => d.date === today) || { meals: [] }).meals;
  const cals = todayMeals.reduce((a, m) => a + m.cal, 0);
  // Built from the same last-7-local-calendar-days set logic as weekStreak,
  // rather than raw Date subtraction — mixing a UTC-parsed date-only string
  // against a local "now" silently drifts by hours depending on timezone.
  const thisWeek = (() => {
    const last7 = new Set();
    const cursor = new Date();
    for (let i = 0; i < 7; i++) {
      last7.add(dateToISO(cursor));
      cursor.setDate(cursor.getDate() - 1);
    }
    return logs.workouts.filter((w) => last7.has(w.date)).length;
  })();
  const progressHighlights = recentProgressHighlights(logs);

  // env(safe-area-inset-top) added to Home/Train/Fuel/Progress/Profile's top
  // padding — a flat 20px let the eyebrow label ("TODAY", "YOUR PROGRAM",
  // etc.) sit right under a notch/Dynamic Island/status bar in standalone
  // PWA mode. Same technique already used by Onboarding, WorkoutSession,
  // and the Coach panel; those tabs just never got it.
  return (
    <div style={{ padding: "calc(20px + env(safe-area-inset-top, 0px)) 16px 90px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, letterSpacing: 1, fontWeight: 600 }}>TODAY</span>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "2px 0 0", color: T.ink }}>
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </h1>
        </div>
        {/* Light info chips with a border, not a solid dark fill — a dark
            filled pill reads as a primary action button (like "Start
            workout" below), which these two stat readouts aren't. */}
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ background: "#E9EBEF", border: `1px solid ${T.steel}`, borderRadius: 10, padding: "8px 12px", textAlign: "center" }}>
            <div style={{ color: T.ink, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 16 }}>{targets.calories}</div>
            <div style={{ color: T.steelDark, fontSize: 9, fontWeight: 700 }}>CAL GOAL</div>
          </div>
          <div style={{ background: "#E9EBEF", border: `1px solid ${T.steel}`, borderRadius: 10, padding: "8px 12px", textAlign: "center" }}>
            <div style={{ color: T.ink, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 16 }}>{thisWeek}/{profile.daysPerWeek}</div>
            <div style={{ color: T.steelDark, fontSize: 9, fontWeight: 700 }}>WORKOUTS WK</div>
          </div>
        </div>
      </div>

      {/* Coach noticing something on its own, instead of only ever reacting
          when asked — computed straight from real logged data (never a live
          AI call, so it's instant and can't invent a pattern), and tapping
          it opens a real Coach conversation rather than silently changing
          anything by itself. */}
      {insight && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "#EEEDFF", border: "none", borderRadius: 12, padding: "12px 14px", marginTop: 14 }}>
          <Sparkles size={16} color={T.charge} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: T.chargeDeep, marginBottom: 3 }}>COACH NOTICED</div>
            <p style={{ fontSize: 13, color: T.ink, lineHeight: 1.4, margin: "0 0 8px" }}>{insight.message}</p>
            <div style={{ display: "flex", gap: 14 }}>
              <button
                onClick={() => onAskCoach(insight.coachPrompt)}
                style={{ background: "none", border: "none", color: T.chargeDeep, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}
              >
                Ask Coach
              </button>
              <button
                onClick={() => setInsightDismissed(true)}
                style={{ background: "none", border: "none", color: T.steelDark, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* A generated review sits permanently under Progress either way —
          this is just a heads-up that a new one showed up, not the only
          place to see it. */}
      {(() => {
        const unseen = ["weekly", "monthly"]
          .flatMap((cadence) => (state.reviews?.[cadence] || []).map((r, i) => ({ cadence, r, i })))
          .filter(({ r }) => !r.seen);
        if (unseen.length === 0) return null;
        const cadenceLabel = unseen.length > 1 ? "reviews are" : `${unseen[0].cadence} review is`;
        return (
          <button
            onClick={() => setActiveTab("progress")}
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: T.card, border: `1px solid ${T.steel}`, borderRadius: 12, padding: "12px 14px", marginTop: 10, cursor: "pointer", textAlign: "left" }}
          >
            <TrendingUp size={16} color={T.chargeDeep} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 13, color: T.ink, fontWeight: 600 }}>Your {cadenceLabel} ready — see it in Progress</span>
            <ChevronRight size={16} color={T.steelDark} />
          </button>
        );
      })()}

      <TickRule label="Next workout" />
      <Card style={{ background: T.ink, border: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ color: T.charge, fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{program.splitName.toUpperCase()}</span>
            <h3 style={{ color: "#fff", fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, margin: "4px 0 8px" }}>{nextDay.name}</h3>
            <span style={{ color: "#B9BEC6", fontSize: 13 }}>{nextDay.exercises.length} exercises</span>
          </div>
          <Dumbbell size={30} color={T.charge} />
        </div>
        <Btn variant="accent" style={{ width: "100%", marginTop: 14 }} onClick={() => startWorkout(nextIdx)}>
          Start workout <ChevronRight size={16} />
        </Btn>
      </Card>

      <TickRule label="Today's fuel" />
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            {/* Leads with "remaining" as the headline number — "0 / 2645"
                read at a glance like a zero goal, not zero eaten yet — but
                collapsed to one line: the target is already implied by
                "left," so restating "of 2,645" again below it was redundant. */}
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, color: T.ink }}>
              {Math.max(0, targets.calories - cals).toLocaleString()}<span style={{ fontSize: 14, fontWeight: 600, color: T.steelDark }}> cal left</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: T.steelDark, marginLeft: 6 }}>· {cals.toLocaleString()} consumed</span>
            </div>
          </div>
          <Ring value={cals} max={targets.calories} color={T.charge} size={64} stroke={7}>
            <Flame size={22} color={T.charge} />
          </Ring>
        </div>
        <Btn variant="ghost" style={{ width: "100%", marginTop: 14 }} onClick={() => setActiveTab("fuel")}>
          Log food <Plus size={16} />
        </Btn>
      </Card>

      <TickRule label="Your targets" />
      <div style={{ display: "flex", gap: 10 }}>
        <StatChip label="Protein" val={`${targets.protein}g`} color={T.protein} icon={<Beef size={16} color={T.protein} />} />
        <StatChip label="Carbs" val={`${targets.carbs}g`} color={T.carb} icon={<Wheat size={16} color={T.carb} />} />
        <StatChip label="Fat" val={`${targets.fat}g`} color={T.fat} icon={<Droplet size={16} color={T.fat} />} />
      </div>

      {/* Only appears when there's real, positive movement to report from the
          most recent workout — silent otherwise, never "you got weaker." */}
      {progressHighlights.length > 0 && (
        <>
          <TickRule label="Recent progress" />
          <Card>
            {progressHighlights.map((h, i) => (
              <div key={h.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: i > 0 ? `1px solid ${T.steel}` : "none" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{h.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.good, display: "flex", alignItems: "center", gap: 4 }}>
                  <TrendingUp size={13} /> +{h.delta}lb
                </span>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

function Train({ state, startWorkout, setActiveTab }) {
  const { program, logs } = state;
  const nextIdx = logs.workouts.length % program.days.length;
  return (
    <div style={{ padding: "calc(20px + env(safe-area-inset-top, 0px)) 16px 90px" }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, letterSpacing: 1, fontWeight: 600 }}>YOUR PROGRAM</span>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "2px 0 4px", color: T.ink }}>{program.splitName}</h1>
      <p style={{ color: T.steelDark, fontSize: 13, marginBottom: 4 }}>{program.days.length}-day rotating split · choose a session to start</p>

      {/* Direct answer to real beta-tester confusion: she wanted a
          different split but didn't know she could just ask for one.
          Deliberately a plain text link, not a filled button — this is a
          secondary hint, and should carry noticeably less visual weight
          than the actual session cards below it. */}
      <button
        onClick={() => setActiveTab("coach")}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", borderBottom: `1px solid ${T.steel}`, borderRadius: 0, padding: "10px 2px", marginTop: 10, cursor: "pointer", width: "100%", textAlign: "left" }}
      >
        <Sparkles size={13} color={T.chargeDeep} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: T.steelDark, fontWeight: 500, flex: 1 }}>
          Don't like this split, want different exercises, workouts too long or too short, or any other issues? <span style={{ color: T.chargeDeep, fontWeight: 600, textDecoration: "underline" }}>Just tell your Coach.</span>
        </span>
      </button>

      <TickRule label="Sessions" />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {program.days.map((day, i) => {
          const isNext = i === nextIdx;
          return (
            <Card
              key={i}
              onClick={() => startWorkout(i)}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                border: isNext ? `2px solid ${T.charge}` : `1px solid ${T.steel}`,
                // A tinted background + ambient shadow on top of the existing
                // accent border and NEXT pill — the plain border alone didn't
                // stand out enough against the other session cards.
                background: isNext ? "#F5F3FF" : T.card,
                boxShadow: isNext ? "0 8px 24px rgba(91,70,246,0.18)" : "0 1px 2px rgba(18,22,28,0.06)",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 700, margin: 0, color: T.ink }}>{day.name}</h3>
                  {isNext && <span style={{ background: T.charge, color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 6 }}>NEXT</span>}
                </div>
                <div style={{ fontSize: 12, color: T.steelDark, marginTop: 3 }}>{day.exercises.map((e) => e.name).join(" · ")}</div>
              </div>
              {/* Decorative now — the whole card is the click target (was just
                  this small arrow before, an easy miss on mobile). */}
              <div style={{ background: T.ink, borderRadius: 10, width: 40, height: 40, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ChevronRight size={18} color="#fff" />
              </div>
            </Card>
          );
        })}
      </div>

      <TickRule label="History" />
      {logs.workouts.length === 0 && <p style={{ color: T.steelDark, fontSize: 13 }}>No workouts logged yet.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {logs.workouts.slice().reverse().slice(0, 8).map((w, i) => {
          const duration = formatDuration(w.durationSec);
          const exCount = (w.exercises || []).length;
          // "Aug 23" instead of the raw stored ISO string "2026-08-23" —
          // still the numeric/mono date treatment used elsewhere in the
          // app, just no longer literal database formatting leaking through.
          const dateLabel = parseISODate(w.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
          return (
            <Card key={i} style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>{w.dayName}</span>
                <span style={{ fontSize: 12, color: T.steelDark, fontFamily: "'JetBrains Mono', monospace" }}>{dateLabel}</span>
              </div>
              <div style={{ fontSize: 12, color: T.steelDark, marginTop: 3 }}>
                {[duration, `${exCount} exercise${exCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   COACH (AI CHAT)
============================================================ */
export function buildCoachSystem(state) {
  const p = state.profile;
  // Derived from what the current program's exercises ACTUALLY use, not
  // profile.goal's static default sets/rest — a user can ask Coach to
  // change sets/rest specifically to fit more exercises, and a ceiling
  // computed from the old defaults would then flatly contradict the
  // change that was just made. Falls back to the goal-default ceiling only
  // if there's genuinely no program yet to read real numbers from.
  const liveCap = capForProgram(state.program, p.sessionLength, p.experience) ?? capFor(p);
  const history = state.programHistory || [];
  const historySummary = history.map((h, i) => ({
    index: i,
    savedAt: h.savedAt,
    splitName: h.program?.splitName,
    dayNames: (h.program?.days || []).map((d) => d.name),
    calories: h.targets?.calories,
  }));
  return `You are an evidence-based strength & nutrition coach embedded in a workout app called Overload.
User profile: goal=${p.goal}, experience=${p.experience}, equipment=${p.equipment}, days/week=${p.daysPerWeek}, session length=${p.sessionLength} min, injuries=${injuryDescription(p)}, current build="${p.currentPhysique}", desired physique="${p.desiredPhysique}", specific performance goals="${p.specificGoals || "none stated"}", bodyweight=${p.weightLb} lb.${p.notes ? ` Additional notes from the client, in their own words — a real preference/constraint, not a nice-to-have: "${p.notes}"` : ""}
Current program JSON: ${JSON.stringify(state.program)}
Current nutrition targets JSON: ${JSON.stringify(state.targets)}
Original program & targets — exactly what they had right after finishing onboarding, kept forever and always available no matter how many changes they've made since: {"splitName": ${JSON.stringify(state.originalProgram?.splitName)}, "dayNames": ${JSON.stringify((state.originalProgram?.days || []).map((d) => d.name))}, "calories": ${state.originalTargets?.calories ?? "unknown"}}${state.originalProgram ? "" : " — not available for this account (set up before this feature existed); be upfront that you can't restore to it and offer to rebuild it from a fresh description instead."}

Version history — MORE RECENT changes only (not the original), saved automatically each time you changed something, most recent first (index 0 = the version right before the current one). Use this for "undo that last change" / "go back to before I did X" type requests, where X is a specific recent change, NOT for "my original / how I started / right after the quiz" — use "restoreOriginal" for that instead, since it's always reliable regardless of history depth: ${JSON.stringify(historySummary)}
IMPORTANT about this history: it only holds their most recent ${PROGRAM_HISTORY_LIMIT} saved versions, so it may not reach back to a specific older change they're describing. If nothing in it plausibly matches, say so honestly rather than guessing at an index.

SCOPE: You only discuss this person's training, workouts, exercise technique, nutrition/diet, recovery, and their use of this app. If a message is about anything else — general knowledge, current events, coding, other apps, personal advice unrelated to fitness, or literally anything outside training/nutrition/this app — do NOT answer it, even briefly or partially. Instead, in "reply", write ONE short sentence redirecting them back to fitness/nutrition topics (e.g. "I'm just here for your training and nutrition — happy to help with that!"). Do not explain why in detail, do not apologize at length, do not engage with the off-topic content at all, even to say you can't help with it specifically — keep the redirect generic and brief. Set "program", "todayOverride", and "targets" to null in this case.

The user will chat with you to adjust their training (swap exercises, change intensity, work around an injury, change split, add/remove exercises, etc.), their nutrition targets, or just ask questions.

You have REAL control over both the training program AND the calorie/macro targets shown in the app's Fuel section — you are not just giving verbal advice, your JSON response actually updates what the person sees and uses. So whenever a change in goal, activity, or body direction would logically change their calorie/macro needs, actually recalculate and set "targets" — don't just describe the change in words and leave the numbers stale. This includes cases where they only asked about training but the goal shift you made (e.g. from a fat-loss deficit to a muscle-building surplus) means the targets are now wrong and should move with it.

There are TWO different kinds of training requests — telling them apart matters:
1. PERMANENT changes — the user wants their ongoing program itself changed going forward (e.g. "change my split," "my knees hurt in general, adjust my program permanently," "give me more back volume from now on"). For these, modify "program" and leave "todayOverride" null.
2. ONE-TIME / temporary swaps for just their next upcoming session — the user says "today," "this session," "just for now," or gives a clearly temporary reason (short on time right now, a passing ache, etc.), and does NOT ask for a lasting change. For these, set "program" to null (do NOT echo the current program back — it's unused and just wastes space), and instead put ONLY the substituted exercises for that one session in "todayOverride". Never rename or permanently relabel a day for a one-time request.

Worked example — user says "my knees hurt, adjust leg day for today": this is case 2. The correct response has "program" set to null, and "todayOverride" set to a short fresh list of knee-friendly leg exercises for just that one session. Nothing else changes, "targets" stays null too since a temporary knee-friendly swap doesn't change calorie needs. Contrast with "my knees hurt in general, please adjust my program" — that IS case 1: modify "program"'s leg day(s) directly (returning the full program) and leave "todayOverride" null.

Worked example for nutrition — user says "make my workout and diet focused on muscle more than fat loss": update "program" toward hypertrophy-style training AND set "targets" to real recalculated numbers (a calorie surplus, protein around 1g/lb bodyweight, remaining calories split between carbs/fat) — do not just say "eat in a surplus" in the reply while leaving the old deficit-based numbers in place untouched.

Worked example for reverting to a RECENT change — user says "go back to before we switched to muscle focus" (a specific, recent change): look through the version history above to find the entry that matches what they're describing (using dayNames/splitName/calories and the "savedAt" order to judge which one), and set "restoreIndex" to that entry's index. Set "restoreOriginal" to false, and "program", "todayOverride", and "targets" all to null in this case — the app applies the restore itself from the saved snapshot, you don't need to (and shouldn't try to) reconstruct it yourself. If nothing in the history plausibly matches what they're describing, say so honestly in "reply" and ask them to describe what they want instead, rather than guessing.

Worked example for reverting to the ORIGINAL — user says "go back to my original program," "how it was right after the quiz," "undo everything and start over": set "restoreOriginal" to true, and "restoreIndex", "program", "todayOverride", and "targets" all to null — the app restores the permanently-kept original itself. This is the reliable path for "original," unlike "restoreIndex" which can only reach as far back as the rolling history goes.

In both worked examples above, even though most fields are null, "reply" must still be a real, non-empty sentence confirming what you restored (e.g. "Done — you're back on your original Push/Pull/Legs split and the fat-loss calorie targets."). Never leave "reply" blank, even when the other fields are null.

Respond ONLY with a JSON object, no markdown fences, no prose outside the JSON, in exactly this shape. Your response must START with the { character — do not write any sentence, greeting, or summary before it, even a short one:
{"reply": "<a short, friendly 2-4 sentence explanation, written directly to the user>", "program": null or {"splitName": "<string>", "days": [{"name": "<string>", "exercises": [{"name": "<string>", "sets": <number>, "reps": "<string like 8-12>", "rest": <number seconds>, "tips": ["<tip>", "<tip>", "<tip>", "<tip>"], "alternatives": ["<exercise name>", "<exercise name>", "<exercise name>"]}]}]}, "todayOverride": null or [{"name": "<string>", "sets": <number>, "reps": "<string like 8-12>", "rest": <number seconds>, "tips": ["<tip>", "<tip>", "<tip>", "<tip>"], "alternatives": ["<exercise name>", "<exercise name>", "<exercise name>"]}], "targets": null or {"calories": <number>, "protein": <number>, "carbs": <number>, "fat": <number>}, "restoreIndex": null or <number, an index from the version history above>, "restoreOriginal": true or false}

Rules:
- For a PERMANENT change (case 1 above), always build the new "days" by editing the exact "Current program JSON" given above — never reconstruct the program from your memory of earlier messages in this conversation, since that risks silently undoing an earlier change or re-adding something that was already removed. If the user asked you to remove, stop using, or never include a specific exercise or piece of equipment, re-check the "days" you're about to return and confirm it genuinely does not appear anywhere in them before you answer — if honoring that fully would leave a day with too few exercises, say so plainly in "reply" instead of quietly leaving it in while claiming it's done.
- Only include exercises doable with their equipment (${p.equipment}).
- Spell equipment out in exercise names ("Dumbbell Row," not "DB Row") — not everyone using this app knows gym-jargon abbreviations.
- Exercise names must be JUST the plain, standard movement name — nothing else attached, ever. No parentheses, no dash-suffix, no trailing descriptor word or phrase either (not "Leg Press (Low)," not "Leg Press Moderate Depth" — just "Leg Press"). These get looked up against a real exercise-demo database afterward, and ANY extra word beyond the bare movement name is a common reason a lookup for an exercise that's obviously in the database still fails to match. Depth, tempo, stance, range of motion — that belongs in "tips," never the name.
- If an exercise you're including already appears somewhere in "Current program JSON" above (or in the version history), use the EXACT SAME spelling it already has there — don't rename or rephrase an exercise that's already established in this person's program. Where none of that applies and one of these fits what you're programming, prefer it exactly as written: ${exerciseVocabularyFor(p.equipment).join(", ")}.
- Never include exercises that would aggravate stated injuries.
- "restoreOriginal" and "restoreIndex" are mutually exclusive — never set both. If the original program isn't available for this account (noted above), don't set "restoreOriginal" true; be honest in "reply" that you can't and offer to rebuild it from a fresh description instead.
- Whenever you include an exercise (in "program" or "todayOverride"), give it exactly 4 short (under 18 words each) practical form "tips" covering setup, execution, and one common mistake — specific to that exact exercise. These need to work with no internet connection mid-workout, so never leave "tips" empty or generic.
- Also give every exercise exactly 3 "alternatives" — genuinely similar substitute exercises (same primary muscle emphasis AND a comparable movement pattern, not just "same body part"; same equipment; appropriate for their experience level). E.g. for "Leg Curl" suggest other hamstring-focused exercises, not an unrelated quad-dominant squat variation.
- If the request doesn't require any change at all (e.g. a general question), set "program", "todayOverride", "targets", and "restoreIndex" all to null, and just answer helpfully in "reply".
- Keep the same number of training days unless the user explicitly asks to change their weekly schedule.
- MINIMUM 4 exercises on any day you write into "program" or "todayOverride" — do not let a tight time budget collapse the exercise count below this. If the textbook sets/rest for their goal doesn't leave room for 4 real exercises in their session length, trim REST first (down to a floor of 45s — rest is the single biggest, lowest-cost lever), then SETS if that's still not enough (down to a floor of 2), rather than accepting fewer exercises. Only go below 4 if the user explicitly asks for a shorter/quicker one-off session.
- HARD CEILING, not a suggestion, on any day you write into "program" or "todayOverride": no more than ${liveCap} exercises. This is recalculated from the sets/rest THIS program actually currently uses (see "Current program JSON" above — that number already accounts for any single-arm/single-leg exercises currently in it costing roughly double), not a generic assumption — if they've already asked you to cut sets or shorten rest specifically to fit more exercises, that change is exactly what got folded into this number, so don't treat it as separate leftover budget to spend again on top of it. The dominant real-world cost isn't just working+resting sets — it's the fairly fixed overhead per exercise (walking to different equipment, loading/adjusting weight, general setup) that doesn't shrink much just because sets/rest did, which is why cutting a set rarely buys as many extra exercises as it feels like it should. A single-arm/single-leg exercise (Bulgarian split squat, single-arm row, walking lunge, step-up) also genuinely takes about twice as long as the same sets/rest would bilaterally, since both sides need training one at a time — factor that in if you're adding one. If they push back that the number doesn't make sense, explain THAT honestly (fixed per-exercise overhead, unilateral exercises costing double, not just set/rest math) rather than just repeating the number. This applies to every edit, not just a full rebuild — if the current day is already at the ceiling and they ask to add one more exercise without removing anything, cut a less important existing one to make room rather than exceeding it, and say so in "reply".
- Exactly one of "program" or "todayOverride" should be non-null — never both, never neither (unless nothing needs to change, per the rule above). "targets" is independent of that choice — set it whenever the calorie/macro numbers genuinely should change, regardless of which of the other two fields is active.
- If "restoreIndex" is set, leave "program", "todayOverride", and "targets" all null — the restore is handled separately using the saved snapshot, not by you regenerating anything.
- When setting "targets", protein and calories should roughly follow: protein in grams * 4 + carbs in grams * 4 + fat in grams * 9 ≈ calories. Keep protein around 0.8-1.1g per lb of bodyweight unless they ask for something specific.
- CRITICAL: never describe a calorie/macro change in words ("bumped to a surplus," "shifted to a deficit," "increased protein," etc.) unless "targets" in that SAME response actually contains the new real numbers. If your "reply" text mentions calories, surplus, deficit, protein, carbs, or fat changing at all, "targets" must be non-null with real numbers in that response — describing a change without setting it is a bug, not an acceptable shortcut, even to keep the response short.
- When answering a question that references their current calorie/macro numbers (e.g. "what should I eat today," "how much protein am I getting") and you are NOT changing anything, use the exact numbers from "Current nutrition targets JSON" above verbatim — do not recalculate or estimate fresh numbers from scratch. The current targets JSON is always the source of truth for what their numbers actually are right now, even if it looks different from what you'd calculate independently.
- If the request touches BOTH training and nutrition/diet in one message, keep "reply" especially tight — 2-3 short sentences covering the training change, plus at most 1-2 sentences on diet in general terms. Since "targets" now carries the actual numbers, you don't need to restate them in detail in "reply" — just confirm you've updated them.
- This applies EVERY time, including for purely informational questions with no program change at all (e.g. "what's the best time of day to train?") and even deep into a long conversation — always wrap your answer in the JSON object below. Never answer in plain conversational text outside the JSON, no matter how simple or chatty the question feels.`;
}

const DEFAULT_COACH_MESSAGES = [
  { role: "assistant", text: "Hey — I'm your coach. Ask me to adjust your program: swap an exercise, work around an injury, add volume, change your split, or anything else." },
];

// Ready-to-send examples for the empty-state quick-action chips — concrete
// enough to tap and go, covering the three kinds of requests Coach
// actually handles differently (a swap, an injury adjustment, a duration
// change), so a first-time visitor sees real capability, not just a blank
// input box.
const COACH_QUICK_PROMPTS = [
  "Swap squat for leg press",
  "I have a shoulder injury",
  "Shorten my workouts to 30 minutes",
  "Change my split",
];

// Coach replies routinely include markdown (**bold** exercise names,
// numbered/bulleted lists when it lays out a swapped session) since that's
// natural language for an LLM to produce, but the chat bubble rendered it
// as raw text — literal asterisks and no real line breaks. A tiny,
// purpose-built renderer instead of pulling in a full markdown library:
// this only ever needs to handle **bold**, line breaks, and simple lists,
// and building React elements directly (never dangerouslySetInnerHTML)
// means there's no HTML-injection surface from AI-generated text.
function renderInlineBold(text, keyPrefix) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return part ? <span key={`${keyPrefix}-${i}`}>{part}</span> : null;
  });
}

function FormattedText({ text }) {
  if (!text) return null;
  const blocks = [];
  let currentList = null; // { type: "ul" | "ol", items: [] }
  const flushList = () => { if (currentList) { blocks.push(currentList); currentList = null; } };

  text.split("\n").forEach((line) => {
    const bullet = line.match(/^\s*[-*]\s+(.*)/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (bullet) {
      if (!currentList || currentList.type !== "ul") { flushList(); currentList = { type: "ul", items: [] }; }
      currentList.items.push(bullet[1]);
    } else if (numbered) {
      if (!currentList || currentList.type !== "ol") { flushList(); currentList = { type: "ol", items: [] }; }
      currentList.items.push(numbered[1]);
    } else {
      flushList();
      blocks.push({ type: "p", text: line });
    }
  });
  flushList();

  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "ul" || b.type === "ol") {
          const ListTag = b.type;
          return (
            <ListTag key={i} style={{ margin: "4px 0", paddingLeft: 18 }}>
              {b.items.map((item, j) => <li key={j} style={{ marginBottom: 2 }}>{renderInlineBold(item, `${i}-${j}`)}</li>)}
            </ListTag>
          );
        }
        // An empty line becomes a small gap (a real paragraph break),
        // rather than collapsing away or rendering a visible empty row.
        return b.text === "" ? <div key={i} style={{ height: 6 }} /> : <div key={i}>{renderInlineBold(b.text, `${i}`)}</div>;
      })}
    </>
  );
}

export function Coach({ messages, loading, onSend, onClearChat, coachUsage, dailyLimit }) {
  const [input, setInput] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const scrollRef = useRef(null);
  const isEmpty = !messages || messages.length === 0;
  const list = messages && messages.length > 0 ? messages : DEFAULT_COACH_MESSAGES;
  const today = todayISO();
  const usedToday = coachUsage && coachUsage.date === today ? coachUsage.count : 0;
  const remaining = Math.max(0, (dailyLimit || 30) - usedToday);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    onSend(text);
  }

  return (
    <div className="coach-panel" style={{ padding: "calc(20px + env(safe-area-inset-top, 0px)) 16px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, letterSpacing: 1, fontWeight: 600 }}>AI COACH</span>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "2px 0 4px", color: T.ink }}>Ask your coach</h1>
          {remaining <= 10 && (
            <div style={{ fontSize: 11, color: remaining === 0 ? T.protein : T.steelDark, fontWeight: 600, marginBottom: 8 }}>
              {remaining} message{remaining === 1 ? "" : "s"} left today
            </div>
          )}
        </div>
        {list.length > 1 && !confirmClear && (
          <button
            onClick={() => setConfirmClear(true)}
            style={{ background: "none", border: "none", color: T.steelDark, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "4px 0", marginTop: 4 }}
          >
            Clear chat
          </button>
        )}
        {confirmClear && (
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={() => setConfirmClear(false)} style={{ background: "none", border: "none", color: T.steelDark, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>Cancel</button>
            <button onClick={() => { onClearChat(); setConfirmClear(false); }} style={{ background: "none", border: "none", color: T.protein, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>Confirm clear</button>
          </div>
        )}
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", paddingBottom: 10,
          // A dedicated centered intro instead of a single chat bubble
          // floating at the top of an otherwise-empty screen — the blank
          // space below it used to make the tab feel unstyled/unfinished.
          ...(isEmpty ? { alignItems: "center", justifyContent: "center", textAlign: "center", gap: 10 } : { gap: 10 }),
        }}
      >
        {isEmpty ? (
          <>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "#EEEDFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Sparkles size={26} color={T.charge} />
            </div>
            <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 19, fontWeight: 700, color: T.ink, margin: 0 }}>Hey — I'm your coach.</h2>
            <p style={{ fontSize: 13, color: T.steelDark, maxWidth: 260, lineHeight: 1.5, margin: 0 }}>
              Ask me to adjust your program, work around an injury, add volume, change your split, or anything else.
            </p>
          </>
        ) : (
          list.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
              <div style={{
                background: m.role === "user" ? T.charge : T.card, color: m.role === "user" ? "#fff" : T.ink,
                border: m.role === "user" ? "none" : `1px solid ${T.steel}`,
                padding: "10px 14px", borderRadius: 14,
                borderBottomRightRadius: m.role === "user" ? 4 : 14,
                borderBottomLeftRadius: m.role === "user" ? 14 : 4,
                fontSize: 14, lineHeight: 1.4,
              }}>
                <FormattedText text={m.text} />
              </div>
            </div>
          ))
        )}
        {loading && (
          <div style={{ alignSelf: "flex-start", color: T.steelDark, display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <Loader2 size={14} className="spin" /> Coach is thinking…
          </div>
        )}
      </div>
      {isEmpty && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 0 12px" }}>
          {COACH_QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => onSend(p)}
              disabled={loading}
              style={{ background: "#fff", border: `1px solid ${T.steel}`, borderRadius: 20, padding: "8px 12px", fontSize: 12, fontWeight: 600, color: T.ink, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}
            >
              {p}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, padding: "10px 0 16px" }}>
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="e.g. My shoulder hurts, adjust push day"
          style={{ flex: 1, padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${T.steel}`, fontFamily: "'Inter', sans-serif", fontSize: 14, boxSizing: "border-box" }}
        />
        <Btn variant="accent" onClick={send} disabled={loading}><Send size={16} /></Btn>
      </div>
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ============================================================
   FUEL
============================================================ */
// icon matches the size/weight of the icon StatChip uses for the same
// macro on Home, so "Protein/Carbs/Fat" reads as the same visual language
// on both screens instead of two unrelated designs. Sized up from the
// original (11px label, 6px bar) — the val/max numbers were cramped.
function MacroBar({ label, val, max, color, icon }) {
  const pct = Math.min(100, (val / Math.max(1, max)) * 100);
  return (
    <div style={{ width: 140 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, color: T.ink, fontWeight: 600 }}>
          {icon}
          {label}
        </span>
        <span style={{ color: T.steelDark, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{val}/{max}g</span>
      </div>
      <div style={{ height: 8, background: T.steel, borderRadius: 4 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

function Fuel({ state, addMeal, removeMeal, userId }) {
  const { targets, logs, profile } = state;
  const today = todayISO();
  const todayLog = logs.nutrition.find((d) => d.date === today) || { date: today, meals: [] };
  const totals = todayLog.meals.reduce((a, m) => ({ cal: a.cal + m.cal, protein: a.protein + m.protein, carb: a.carb + m.carb, fat: a.fat + m.fat }), { cal: 0, protein: 0, carb: 0, fat: 0 });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", cal: "", protein: "", carb: "", fat: "" });

  const [suggestions, setSuggestions] = useState(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState(null);

  const [photoResult, setPhotoResult] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const [pendingPhotos, setPendingPhotos] = useState(() => readPendingPhotos(userId));
  const [processingQueue, setProcessingQueue] = useState(false);
  const fileInputRef = useRef(null);

  // Analyzes any photos that were saved offline, in the order they were
  // taken. Runs on mount (covers "left offline, came back to this tab
  // online") and again whenever connectivity returns while this tab is open.
  useEffect(() => {
    processPendingPhotos();
    window.addEventListener("online", processPendingPhotos);
    return () => window.removeEventListener("online", processPendingPhotos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function processPendingPhotos() {
    if (!navigator.onLine) return;
    setProcessingQueue(true);
    try {
      // Re-read fresh each loop iteration rather than closing over a stale
      // array, since addMeal below is async (goes through persist).
      let queue = readPendingPhotos(userId);
      while (queue.length > 0) {
        const item = queue[0];
        try {
          const raw = await claudeChat({
            system: MEAL_PHOTO_SYSTEM,
            messages: [{ role: "user", content: [
              { type: "image", source: { type: "base64", media_type: item.mediaType, data: item.base64 } },
              { type: "text", text: "Identify this meal and estimate its calories and macros." },
            ] }],
          });
          const parsed = parseJSONLoose(raw);
          addMeal({ name: parsed.name, cal: parsed.cal, protein: parsed.protein, carb: parsed.carb, fat: parsed.fat }, item.dateISO);
        } catch (err) {
          // Offline again, or some other failure — stop this pass and leave
          // whatever's left in the queue for next time rather than dropping it.
          break;
        }
        queue = queue.filter((p) => p.id !== item.id);
        writePendingPhotos(userId, queue);
        setPendingPhotos(queue);
      }
    } finally {
      setProcessingQueue(false);
    }
  }

  function queuePhoto(base64, mediaType) {
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, base64, mediaType, dateISO: todayISO(), capturedAt: new Date().toISOString() };
    const next = [...readPendingPhotos(userId), entry];
    writePendingPhotos(userId, next);
    setPendingPhotos(next);
  }

  function submit() {
    if (!form.name || !form.cal) return;
    addMeal({ name: form.name, cal: Number(form.cal) || 0, protein: Number(form.protein) || 0, carb: Number(form.carb) || 0, fat: Number(form.fat) || 0 });
    setForm({ name: "", cal: "", protein: "", carb: "", fat: "" });
    setShowForm(false);
  }

  async function getSuggestions() {
    setSuggestLoading(true);
    setSuggestError(null);
    setSuggestions(null);
    try {
      const remaining = { cal: targets.calories - totals.cal, protein: targets.protein - totals.protein, carb: targets.carbs - totals.carb, fat: targets.fat - totals.fat };
      const system = `You are a nutrition coach. Given remaining macro budget for today and the user's goal, suggest exactly 3 realistic meal or snack options that fit. Respond ONLY with JSON, no markdown fences: {"suggestions": [{"name": "<string>", "cal": <number>, "protein": <number>, "carb": <number>, "fat": <number>, "note": "<short reason, under 15 words>"}]}`;
      const userMsg = `Goal: ${profile.goal}. Desired physique: ${profile.desiredPhysique}. Remaining today: ${JSON.stringify(remaining)}. Suggest meals or snacks that fit.`;
      const raw = await claudeChat({ system, messages: [{ role: "user", content: userMsg }] });
      const parsed = parseJSONLoose(raw);
      setSuggestions(parsed.suggestions || []);
    } catch (e) {
      setSuggestError(e.offline ? OFFLINE_MESSAGE : "Couldn't get suggestions — try again.");
    } finally {
      setSuggestLoading(false);
    }
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError(null);
    setPhotoResult(null);
    let base64, mediaType;
    try {
      base64 = await compressImageToBase64(file);
      mediaType = "image/jpeg"; // compression always re-encodes to JPEG
    } catch (err) {
      setPhotoError("Couldn't read that photo — try again.");
      e.target.value = "";
      return;
    }

    if (!navigator.onLine) {
      queuePhoto(base64, mediaType);
      e.target.value = "";
      return;
    }

    setPhotoLoading(true);
    try {
      const raw = await claudeChat({
        system: MEAL_PHOTO_SYSTEM,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: "Identify this meal and estimate its calories and macros." },
        ] }],
      });
      const parsed = parseJSONLoose(raw);
      setPhotoResult(parsed);
    } catch (err) {
      if (err.offline) {
        // Connectivity dropped between the check above and the request
        // actually going out — same graceful fallback as being offline from the start.
        queuePhoto(base64, mediaType);
      } else {
        setPhotoError("Couldn't analyze that photo — try again or add manually.");
      }
    } finally {
      setPhotoLoading(false);
      e.target.value = "";
    }
  }

  return (
    <div style={{ padding: "calc(20px + env(safe-area-inset-top, 0px)) 16px 90px" }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, letterSpacing: 1, fontWeight: 600 }}>NUTRITION</span>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "2px 0 4px", color: T.ink }}>Today's Fuel</h1>
      {/* One-line clarity for a first-time visitor landing here from the nav
          bar's bare "Fuel" label — the eyebrow above already says NUTRITION,
          this spells out what that actually means before any content. */}
      <p style={{ color: T.steelDark, fontSize: 13, marginBottom: 4 }}>Log meals and track calories & macros toward your targets.</p>

      <TickRule label="Calories & macros" />
      <Card style={{ marginTop: 14, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
          <Ring value={totals.cal} max={targets.calories} color={T.charge} size={90} stroke={9}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 17 }}>{totals.cal}</div>
              <div style={{ fontSize: 9, color: T.steelDark }}>/ {targets.calories} cal</div>
            </div>
          </Ring>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Same 16px icon size as Home's macro StatChips, so the two
                screens read as one consistent design language. */}
            <MacroBar label="Protein" val={totals.protein} max={targets.protein} color={T.protein} icon={<Beef size={16} color={T.protein} />} />
            <MacroBar label="Carbs" val={totals.carb} max={targets.carbs} color={T.carb} icon={<Wheat size={16} color={T.carb} />} />
            <MacroBar label="Fat" val={totals.fat} max={targets.fat} color={T.fat} icon={<Droplet size={16} color={T.fat} />} />
          </div>
        </div>
      </Card>

      <TickRule label="Meals logged" />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {todayLog.meals.map((m, i) => (
          <Card key={i} style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>{m.name}</div>
              <div style={{ fontSize: 11, color: T.steelDark, fontFamily: "'JetBrains Mono', monospace" }}>{m.cal} cal · P{m.protein} C{m.carb} F{m.fat}</div>
            </div>
            <button onClick={() => removeMeal(i)} style={{ background: "none", border: "none", color: T.steelDark, cursor: "pointer" }}><X size={16} /></button>
          </Card>
        ))}
        {todayLog.meals.length === 0 && !showForm && <p style={{ color: T.steelDark, fontSize: 13 }}>Nothing logged yet today.</p>}
      </div>

      {showForm && (
        <Card style={{ marginTop: 12 }}>
          <input placeholder="Meal name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            style={{ width: "100%", padding: 12, borderRadius: 8, border: `1.5px solid ${T.steel}`, marginBottom: 8, boxSizing: "border-box", fontFamily: "'Inter', sans-serif" }} />
          <input placeholder="Calories" type="number" value={form.cal} onChange={(e) => setForm({ ...form, cal: e.target.value })}
            style={{ width: "100%", padding: 12, borderRadius: 8, border: `1.5px solid ${T.steel}`, marginBottom: 8, boxSizing: "border-box", fontFamily: "'JetBrains Mono', monospace" }} />
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input placeholder="Protein g" type="number" value={form.protein} onChange={(e) => setForm({ ...form, protein: e.target.value })}
              style={{ flex: 1, minWidth: 0, padding: "10px 6px", borderRadius: 8, border: `1.5px solid ${T.steel}`, boxSizing: "border-box", fontFamily: "'JetBrains Mono', monospace", fontSize: 16 }} />
            <input placeholder="Carbs g" type="number" value={form.carb} onChange={(e) => setForm({ ...form, carb: e.target.value })}
              style={{ flex: 1, minWidth: 0, padding: "10px 6px", borderRadius: 8, border: `1.5px solid ${T.steel}`, boxSizing: "border-box", fontFamily: "'JetBrains Mono', monospace", fontSize: 16 }} />
            <input placeholder="Fat g" type="number" value={form.fat} onChange={(e) => setForm({ ...form, fat: e.target.value })}
              style={{ flex: 1, minWidth: 0, padding: "10px 6px", borderRadius: 8, border: `1.5px solid ${T.steel}`, boxSizing: "border-box", fontFamily: "'JetBrains Mono', monospace", fontSize: 16 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" onClick={() => setShowForm(false)} style={{ flex: 1 }}>Cancel</Btn>
            <Btn variant="accent" onClick={submit} style={{ flex: 1 }}>Add meal</Btn>
          </div>
        </Card>
      )}

      {!showForm && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="primary" style={{ flex: 1 }} onClick={() => setShowForm(true)}><Plus size={16} /> Add meal</Btn>
            <Btn variant="ghost" style={{ flex: 1 }} onClick={() => fileInputRef.current?.click()}><Camera size={16} /> Photo</Btn>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 5, marginTop: 8 }}>
            <Info size={12} color={T.steelDark} style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 11, color: T.steelDark, lineHeight: 1.4 }}>
              Photo scanning uses AI and is usually close, but not exact — always worth a quick double-check.
            </span>
          </div>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handlePhoto} />

      {photoLoading && (
        <Card style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <Loader2 size={16} className="spin" /> <span style={{ fontSize: 13, color: T.steelDark }}>Analyzing your photo…</span>
        </Card>
      )}
      {pendingPhotos.length > 0 && (
        <Card style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, borderColor: T.warn }}>
          {processingQueue ? <Loader2 size={16} color={T.warn} className="spin" /> : <Camera size={16} color={T.warn} />}
          <span style={{ fontSize: 13, color: T.ink }}>
            {pendingPhotos.length} photo{pendingPhotos.length > 1 ? "s" : ""} saved — {processingQueue ? "analyzing now…" : "will analyze automatically once you're back online"}
          </span>
        </Card>
      )}
      {photoError && (
        <Card style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, borderColor: T.warn }}>
          <AlertCircle size={16} color={T.warn} /> <span style={{ fontSize: 13, color: T.ink }}>{photoError}</span>
        </Card>
      )}
      {photoResult && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.ink }}>{photoResult.name}</div>
          {photoResult.note && <div style={{ fontSize: 12, color: T.steelDark, marginTop: 2 }}>{photoResult.note}</div>}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 8, padding: "8px 10px", background: T.paper, borderRadius: 8 }}>
            <Info size={13} color={T.steelDark} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 11, color: T.steelDark, lineHeight: 1.4 }}>
              AI estimate — usually close, but not exact. Double-check the numbers below (especially for sauces, oils, and portion size) before logging.
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "10px 0" }}>
            {[["cal", "Calories"], ["protein", "Protein (g)"], ["carb", "Carbs (g)"], ["fat", "Fat (g)"]].map(([k, lab]) => (
              <div key={k}>
                <label style={{ fontSize: 10, color: T.steelDark, fontWeight: 600 }}>{lab}</label>
                <input
                  type="number" value={photoResult[k]}
                  onChange={(e) => setPhotoResult({ ...photoResult, [k]: e.target.value === "" ? "" : Number(e.target.value) })}
                  style={{ width: "100%", marginTop: 2, padding: 10, borderRadius: 8, border: `1.5px solid ${T.steel}`, fontFamily: "'JetBrains Mono', monospace", fontSize: 16, boxSizing: "border-box" }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" style={{ flex: 1 }} onClick={() => setPhotoResult(null)}>Discard</Btn>
            <Btn variant="accent" style={{ flex: 1 }} onClick={() => { addMeal({ name: photoResult.name, cal: photoResult.cal, protein: photoResult.protein, carb: photoResult.carb, fat: photoResult.fat }); setPhotoResult(null); }}>
              Add to log
            </Btn>
          </div>
        </Card>
      )}

      <TickRule label="Need ideas?" />
      {!suggestions && !suggestLoading && (
        <Btn variant="ghost" style={{ width: "100%" }} onClick={getSuggestions}><Sparkles size={16} /> Suggest meals for what's left today</Btn>
      )}
      {suggestLoading && (
        <Card style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Loader2 size={16} className="spin" /> <span style={{ fontSize: 13, color: T.steelDark }}>Thinking of options…</span>
        </Card>
      )}
      {suggestError && <p style={{ color: T.warn, fontSize: 13 }}>{suggestError}</p>}
      {suggestions && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {suggestions.map((s, i) => (
            <Card key={i} style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: T.steelDark, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>{s.cal} cal · P{s.protein} C{s.carb} F{s.fat}</div>
                  {s.note && <div style={{ fontSize: 12, color: T.steelDark, marginTop: 4 }}>{s.note}</div>}
                </div>
                <button onClick={() => addMeal({ name: s.name, cal: s.cal, protein: s.protein, carb: s.carb, fat: s.fat })}
                  style={{ background: T.charge, border: "none", borderRadius: 8, width: 32, height: 32, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <Plus size={16} color="#fff" />
                </button>
              </div>
            </Card>
          ))}
          <Btn variant="ghost" onClick={getSuggestions}><Sparkles size={14} /> More ideas</Btn>
        </div>
      )}
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ============================================================
   PROGRESS
============================================================ */
export function monthKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function MonthlySummary({ logs }) {
  const now = new Date();
  const monthWorkouts = logs.workouts.filter((w) => monthKey(parseISODate(w.date)) === monthKey(now));
  const totalSets = monthWorkouts.reduce((a, w) => a + w.exercises.reduce((b, e) => b + e.logged.filter((l) => l.done).length, 0), 0);
  const totalVolume = monthWorkouts.reduce(
    (a, w) => a + w.exercises.reduce((b, e) => b + e.logged.reduce((c, l) => c + (l.done && l.weight && l.reps ? Number(l.weight) * Number(l.reps) : 0), 0), 0),
    0
  );
  const dayCounts = {};
  monthWorkouts.forEach((w) => { dayCounts[w.dayName] = (dayCounts[w.dayName] || 0) + 1; });
  const monthName = now.toLocaleDateString(undefined, { month: "long" });

  return (
    <Card>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 700, color: T.ink, marginBottom: 10 }}>{monthName} so far</div>
      <div style={{ display: "flex", gap: 8 }}>
        <StatChip label="Workouts" val={monthWorkouts.length} color={T.charge} icon={<Dumbbell size={16} color={T.charge} />} />
        <StatChip label="Sets done" val={totalSets} color={T.good} icon={<Check size={16} color={T.good} />} />
        <StatChip label="Volume (lb)" val={totalVolume.toLocaleString()} color={T.protein} icon={<TrendingUp size={16} color={T.protein} />} />
      </div>
      {Object.keys(dayCounts).length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {Object.entries(dayCounts).map(([name, count]) => (
            <span key={name} style={{ background: T.paper, border: `1px solid ${T.steel}`, borderRadius: 8, padding: "4px 9px", fontSize: 11, color: T.ink, fontWeight: 600 }}>
              {name} × {count}
            </span>
          ))}
        </div>
      )}
      {monthWorkouts.length === 0 && <p style={{ color: T.steelDark, fontSize: 13, marginTop: 8 }}>No workouts logged this month yet.</p>}
    </Card>
  );
}

export function exerciseHistory(logs, name) {
  return logs.workouts
    .filter((w) => w.exercises.some((e) => e.name === name))
    .map((w) => {
      const ex = w.exercises.find((e) => e.name === name);
      const withWeight = ex.logged.filter((l) => l.weight && l.reps);
      if (withWeight.length === 0) return null;
      const top = withWeight.reduce((max, l) => (Number(l.weight) > Number(max.weight) ? l : max), withWeight[0]);
      return { date: w.date, dateLabel: w.date.slice(5), weight: Number(top.weight), reps: Number(top.reps) };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date > b.date ? 1 : -1));
}

// The full set-by-set breakdown from the most recent time this exercise was
// actually logged, across ANY program day — broader than "last time THIS
// specific day was done" (used elsewhere for the in-workout "Last time: Xlb
// x Y" hint), since the same exercise can appear on more than one day, or a
// swap can mean the day itself has changed since. Powers the mid-workout
// exercise detail view's "last time" breakdown.
export function exerciseLastSession(logs, name) {
  const matches = logs.workouts
    .filter((w) => w.exercises.some((e) => e.name === name))
    .sort((a, b) => (a.date > b.date ? -1 : 1)); // most recent first
  if (matches.length === 0) return null;
  const w = matches[0];
  const ex = w.exercises.find((e) => e.name === name);
  const loggedSets = ex.logged.filter((l) => l.weight && l.reps);
  if (loggedSets.length === 0) return null;
  return { date: w.date, sets: loggedSets.map((l) => ({ weight: Number(l.weight), reps: Number(l.reps) })) };
}

// The heaviest set ever logged for this exercise — ties broken by more reps
// at that weight, since that's still the harder set to have actually beaten.
export function exercisePR(logs, name) {
  const history = exerciseHistory(logs, name);
  if (history.length === 0) return null;
  return history.reduce((best, h) => (
    h.weight > best.weight || (h.weight === best.weight && h.reps > best.reps) ? h : best
  ), history[0]);
}

// Active-time-only workout duration: the wall-clock time the workout screen
// was actually open, deliberately excluding any gap after "save & exit"
// until it's resumed — saving a workout and finishing it three days later
// shouldn't count as a three-day-long workout. Pure so the accumulation
// itself is unit-testable without faking real timers end to end; the caller
// supplies "now" and the timestamp the current active stretch began.
export function accumulateActiveSeconds(priorActiveSeconds, resumedAtMs, nowMs) {
  const thisStretch = Math.max(0, Math.round((nowMs - resumedAtMs) / 1000));
  return (priorActiveSeconds || 0) + thisStretch;
}

// Human-readable duration for history/insight copy — "42 min" for anything
// under an hour, "1h 12m" once it crosses that, never "0 min" for a real
// (if very short) logged session.
export function formatDuration(totalSeconds) {
  if (!totalSeconds || totalSeconds <= 0) return null;
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Small, purely positive "you're improving" signal for the Home dashboard —
// exercises from the most recently finished workout that went up in weight
// compared to the time before, biggest jump first. Deliberately silent
// (returns []) when nothing improved, rather than reporting a decline —
// this is meant to be an occasional nudge, not a full log; a bad session
// just doesn't get a highlight, it doesn't get called out either.
export function recentProgressHighlights(logs, limit = 3) {
  const workouts = logs.workouts;
  if (!workouts || workouts.length === 0) return [];
  const last = workouts[workouts.length - 1];
  const names = Array.from(new Set(last.exercises.map((e) => e.name)));
  const highlights = names
    .map((name) => {
      const history = exerciseHistory(logs, name);
      if (history.length < 2) return null;
      const latest = history[history.length - 1];
      const prev = history[history.length - 2];
      const delta = latest.weight - prev.weight;
      if (delta <= 0) return null;
      return { name, delta, weight: latest.weight, reps: latest.reps };
    })
    .filter(Boolean);
  return highlights.sort((a, b) => b.delta - a.delta).slice(0, limit);
}

// Deterministic, data-driven "Coach noticed something" signal — computed
// directly from real logged data, never a live AI call, so it's instant,
// free, and can never hallucinate a pattern that isn't actually there.
// Returns at most one insight, prioritized, so it stays an occasional nudge
// rather than a stream of unsolicited opinions — this app's own dashboard
// philosophy elsewhere is "don't clutter," this follows the same rule.
// Tapping the resulting card sends a real message into Coach chat, so any
// actual program change still goes through the same reviewed, revertible
// path as any other Coach edit — this only decides WHEN to bring something
// up, never WHAT to silently change on its own.
export function detectCoachInsight(state) {
  const logs = state?.logs;
  const profile = state?.profile;
  const program = state?.program;
  if (!logs || !profile) return null;
  const workouts = logs.workouts || [];

  // Deliberately no adherence/schedule nudge here — real report: this used
  // to compare workouts-done-in-a-trailing-7-days against the full weekly
  // target, which reads as "you're behind" even a day or two into a fresh
  // week (a rolling window can't tell "genuinely behind" from "just early"
  // without knowing which days are actually left to train). Explicit user
  // preference: "Don't want coach giving advice about schedule."

  // 2. Duration overrun: the last few timed sessions consistently ran well
  // past the session length they actually asked for.
  const timed = workouts.filter((w) => w.durationSec).slice(-3);
  if (timed.length >= 2 && profile.sessionLength) {
    const avgMin = timed.reduce((a, w) => a + w.durationSec, 0) / timed.length / 60;
    const targetMin = profile.sessionLength;
    if (avgMin > targetMin * 1.2) {
      const overBy = Math.round(avgMin - targetMin);
      return {
        type: "duration",
        message: `Your last few sessions have run about ${overBy} min over your ${targetMin}-min target. Want me to trim the exercise count?`,
        coachPrompt: `My last few workouts have been running about ${overBy} minutes longer than my ${targetMin}-minute target. Can you shorten my sessions so they actually fit?`,
      };
    }
  }

  // 3. Stalled lift: a current-program exercise whose last 3 logged top
  // sets show no weight increase at all.
  if (program?.days) {
    const names = Array.from(new Set(program.days.flatMap((d) => d.exercises.map((e) => e.name))));
    for (const name of names) {
      const history = exerciseHistory(logs, name).slice(-3);
      if (history.length === 3 && history.every((h) => h.weight === history[0].weight)) {
        return {
          type: "stalled",
          message: `Your ${name} has held at ${history[0].weight}lb for ${history.length} sessions in a row — want to try a deload or a rep-range change?`,
          coachPrompt: `My ${name} has been stuck at ${history[0].weight}lb for a few sessions in a row. Can you help me break through this plateau?`,
        };
      }
    }
  }

  return null;
}

/* ============================================================
   PERIODIC AI REVIEWS (weekly / monthly)
   Rolling-window, not calendar-aligned — the next review is simply due one
   period after the last one (or after the account was created, for the
   very first one), rather than trying to line up with a fixed weekday or
   the 1st of the month. Simpler to reason about, and doesn't require
   knowing what day the account was created relative to any calendar
   boundary.
============================================================ */
const REVIEW_PERIOD_MS = { weekly: 7 * 86400000, monthly: 30 * 86400000 };

export function reviewPeriodStart(reviews, accountCreatedAt, cadence) {
  const list = reviews?.[cadence] || [];
  const last = list.length > 0 ? list[list.length - 1] : null;
  return last ? new Date(last.generatedAt).getTime() : new Date(accountCreatedAt).getTime();
}

export function nextReviewDueAt(reviews, accountCreatedAt, cadence) {
  return reviewPeriodStart(reviews, accountCreatedAt, cadence) + REVIEW_PERIOD_MS[cadence];
}

export function isReviewDue(reviews, accountCreatedAt, cadence, now = new Date()) {
  if (!accountCreatedAt) return false;
  return now.getTime() >= nextReviewDueAt(reviews, accountCreatedAt, cadence);
}

// Deterministic stats for the period — computed regardless of whether the
// AI call that turns them into prose succeeds, so there's always at least
// real numbers behind a review, never just AI-generated vibes.
export function summarizeReviewPeriod(logs, periodStartMs, periodEndMs) {
  const inRange = (dateStr) => {
    const t = new Date(dateStr).getTime();
    return t >= periodStartMs && t <= periodEndMs;
  };
  const workouts = (logs.workouts || []).filter((w) => inRange(w.date));
  const totalDurationSec = workouts.reduce((a, w) => a + (w.durationSec || 0), 0);
  const timedCount = workouts.filter((w) => w.durationSec).length;
  const weighIns = (logs.bodyweight || []).filter((w) => inRange(w.date)).sort((a, b) => (a.date > b.date ? 1 : -1));
  const weightChange = weighIns.length >= 2 ? Number((weighIns[weighIns.length - 1].weight - weighIns[0].weight).toFixed(1)) : null;
  return {
    workoutCount: workouts.length,
    avgDurationSec: timedCount > 0 ? Math.round(totalDurationSec / timedCount) : null,
    weightChange,
    startWeight: weighIns[0]?.weight ?? null,
    endWeight: weighIns[weighIns.length - 1]?.weight ?? null,
  };
}

export function buildReviewSystem(profile, cadence, summary) {
  const periodLabel = cadence === "weekly" ? "the past week" : "the past month";
  return `You are an evidence-based strength & nutrition coach writing a short periodic progress review for a client in a workout app called Overload, covering ${periodLabel}.

Client profile: goal=${profile.goal}, experience=${profile.experience}, days/week target=${profile.daysPerWeek}.
Logged data for ${periodLabel}: ${summary.workoutCount} workout(s) logged${summary.avgDurationSec ? `, averaging ${Math.round(summary.avgDurationSec / 60)} min each` : ""}.${summary.weightChange !== null ? ` Bodyweight went from ${summary.startWeight}lb to ${summary.endWeight}lb (${summary.weightChange > 0 ? "+" : ""}${summary.weightChange}lb).` : " No bodyweight trend available for this period."}

Write a short, honest, encouraging review — 3-5 sentences of overview, then 2-3 concrete, specific pieces of advice for training and/or diet going forward. If little or nothing was logged this period, say that plainly and gently rather than inventing progress that didn't happen — ask what got in the way rather than assuming.

Respond ONLY with JSON, no markdown fences: {"overview": "<3-5 sentence summary>", "advice": ["<specific tip>", "<specific tip>"]}`;
}

function ExerciseProgress({ logs }) {
  const names = Array.from(new Set(logs.workouts.flatMap((w) => w.exercises.map((e) => e.name)))).sort();
  const [selected, setSelected] = useState(names[0] || "");
  useEffect(() => { if (!selected && names[0]) setSelected(names[0]); }, [names.length]);

  if (names.length === 0) {
    return (
      <Card style={{ textAlign: "center", padding: "24px 16px" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: T.paper, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
          <TrendingUp size={20} color={T.steelDark} />
        </div>
        <p style={{ color: T.steelDark, fontSize: 13, margin: 0 }}>Log a workout to start tracking exercise progress.</p>
      </Card>
    );
  }

  const history = exerciseHistory(logs, selected);
  const first = history[0];
  const latest = history[history.length - 1];
  const delta = first && latest ? latest.weight - first.weight : 0;

  return (
    <Card>
      <select
        value={selected} onChange={(e) => setSelected(e.target.value)}
        style={{ width: "100%", padding: 12, borderRadius: 8, border: `1.5px solid ${T.steel}`, fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 14, color: T.ink, boxSizing: "border-box", marginBottom: 10 }}
      >
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      {history.length > 1 ? (
        <>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={history}>
              <CartesianGrid stroke={T.steel} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke={T.steelDark} />
              <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke={T.steelDark} domain={["dataMin - 5", "dataMax + 5"]} />
              <Tooltip contentStyle={{ fontFamily: "Inter", fontSize: 12, borderRadius: 8 }} formatter={(v, k, p) => [`${v} lb × ${p.payload.reps}`, "Top set"]} />
              <Line type="monotone" dataKey="weight" stroke={T.charge} strokeWidth={3} dot={{ r: 3, fill: T.charge }} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: T.steelDark }}>
            <span>First: {first.weight}lb × {first.reps}</span>
            <span style={{ color: delta > 0 ? T.good : delta < 0 ? T.warn : T.steelDark, fontWeight: 700 }}>
              {delta > 0 ? "+" : ""}{delta}lb since first log
            </span>
            <span>Latest: {latest.weight}lb × {latest.reps}</span>
          </div>
        </>
      ) : (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: T.paper, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 8px" }}>
            <TrendingUp size={18} color={T.steelDark} />
          </div>
          <p style={{ color: T.steelDark, fontSize: 13, margin: 0 }}>Log this exercise at least twice to see a trend.</p>
        </div>
      )}
    </Card>
  );
}

// Shows generated weekly/monthly reviews, most-recent-first within each
// cadence, only when at least one of either exists — nothing shown at all
// (not even an empty state) for accounts that never enabled either, so
// this doesn't clutter Progress for the common case of neither being on.
// Marks any unseen entries as seen once they're actually rendered here
// (this section itself IS "viewing" them, whether reached via the Home
// banner or just browsing Progress directly).
function ReviewsSection({ reviews, onMarkSeen }) {
  const weekly = reviews?.weekly || [];
  const monthly = reviews?.monthly || [];
  useEffect(() => {
    weekly.forEach((r, i) => { if (!r.seen) onMarkSeen?.("weekly", i); });
    monthly.forEach((r, i) => { if (!r.seen) onMarkSeen?.("monthly", i); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekly.length, monthly.length]);

  if (weekly.length === 0 && monthly.length === 0) return null;

  function ReviewCard({ label, entry }) {
    return (
      <Card style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.chargeDeep, fontWeight: 700, letterSpacing: 0.5 }}>{label}</span>
          <span style={{ fontSize: 11, color: T.steelDark }}>{entry.generatedAt.slice(0, 10)}</span>
        </div>
        {entry.overview ? (
          <p style={{ fontSize: 13, color: T.ink, margin: "0 0 8px", lineHeight: 1.5 }}>{entry.overview}</p>
        ) : (
          <p style={{ fontSize: 13, color: T.steelDark, margin: "0 0 8px", fontStyle: "italic" }}>
            {entry.summary.workoutCount} workout{entry.summary.workoutCount === 1 ? "" : "s"} logged this period.
          </p>
        )}
        {entry.advice && entry.advice.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {entry.advice.map((tip, i) => (
              <li key={i} style={{ fontSize: 12.5, color: T.steelDark, marginBottom: 3 }}>{tip}</li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  return (
    <>
      <TickRule label="Reviews" />
      {weekly.slice().reverse().slice(0, 3).map((r, i) => (
        <ReviewCard key={`w-${weekly.length - 1 - i}`} label="WEEKLY REVIEW" entry={r} />
      ))}
      {monthly.slice().reverse().slice(0, 3).map((r, i) => (
        <ReviewCard key={`m-${monthly.length - 1 - i}`} label="MONTHLY REVIEW" entry={r} />
      ))}
    </>
  );
}

export function Progress({ state, addWeight, removeWeight, onOpenHistory, onMarkReviewSeen }) {
  const { logs, profile } = state;
  const [entry, setEntry] = useState("");
  const chartData = logs.bodyweight.map((w) => ({ date: w.date.slice(5), weight: w.weight }));
  const totalWorkouts = logs.workouts.length;
  const weekStreak = (() => {
    const dateSet = new Set(logs.workouts.map((w) => w.date));
    const toISO = dateToISO; // local calendar date, matching how w.date was stored
    let streak = 0;
    let cursor = new Date();
    for (;;) {
      let hasWorkout = false;
      for (let i = 0; i < 7; i++) {
        const check = new Date(cursor);
        check.setDate(check.getDate() - i);
        if (dateSet.has(toISO(check))) { hasWorkout = true; break; }
      }
      if (!hasWorkout) break;
      streak++;
      cursor.setDate(cursor.getDate() - 7);
    }
    return streak;
  })();

  return (
    <div style={{ padding: "calc(20px + env(safe-area-inset-top, 0px)) 16px 90px" }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, letterSpacing: 1, fontWeight: 600 }}>PROGRESS</span>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "2px 0 4px", color: T.ink }}>Your Trend</h1>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <StatChip label="Workouts logged" val={totalWorkouts} color={T.charge} icon={<Award size={16} color={T.charge} />} />
        <StatChip label="Week streak" val={weekStreak} color={T.good} icon={<Sparkles size={16} color={T.good} />} />
      </div>

      {totalWorkouts > 0 && (
        <button
          onClick={onOpenHistory}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: `1px solid ${T.steel}`, borderRadius: 10, padding: "12px 14px", marginTop: 10, cursor: "pointer", textAlign: "left" }}
        >
          <span style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>View & edit workout history</span>
          <ChevronRight size={16} color={T.steelDark} />
        </button>
      )}

      <ReviewsSection reviews={state.reviews} onMarkSeen={onMarkReviewSeen} />

      <TickRule label="This month" />
      <MonthlySummary logs={logs} />

      <TickRule label="Exercise progress" />
      <ExerciseProgress logs={logs} />

      <TickRule label="Bodyweight" />
      <Card>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid stroke={T.steel} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke={T.steelDark} />
              <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke={T.steelDark} domain={["dataMin - 3", "dataMax + 3"]} />
              <Tooltip contentStyle={{ fontFamily: "Inter", fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey="weight" stroke={T.charge} strokeWidth={3} dot={{ r: 3, fill: T.charge }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          // An icon, not just bare text, so an empty chart card doesn't
          // read as broken/unfinished — same treatment as other empty
          // states could use across the app.
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: T.paper, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
              <Scale size={20} color={T.steelDark} />
            </div>
            <p style={{ color: T.steelDark, fontSize: 13, margin: 0 }}>Log at least 2 weigh-ins to see your trend.</p>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input
            placeholder={`Weight (lb) · last ${profile.weightLb}`} type="number" value={entry}
            onChange={(e) => setEntry(e.target.value)}
            // Standard UI typography, not the raw monospace/code font — this
            // is a normal text entry field, not a numeric readout like a
            // stat chip or timer.
            style={{ flex: 1, padding: 12, borderRadius: 8, border: `1.5px solid ${T.steel}`, boxSizing: "border-box", fontFamily: "'Inter', sans-serif", fontSize: 15 }}
          />
          <Btn variant="accent" onClick={() => { if (entry) { addWeight(Number(entry)); setEntry(""); } }}>
            <Scale size={16} /> Log
          </Btn>
        </div>
      </Card>

      {logs.bodyweight.length > 0 && (
        <>
          <TickRule label="Recent entries" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Reversed for most-recent-first display, but keeps each entry's
                real index into logs.bodyweight so deleting removes the right one
                even though the list order shown here is flipped. */}
            {logs.bodyweight.map((w, i) => ({ ...w, i })).reverse().slice(0, 10).map((w) => (
              <Card key={w.i} style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: T.ink, fontFamily: "'JetBrains Mono', monospace" }}>{w.weight} lb</div>
                  <div style={{ fontSize: 11, color: T.steelDark }}>{w.date}</div>
                </div>
                <button onClick={() => removeWeight(w.i)} style={{ background: "none", border: "none", color: T.steelDark, cursor: "pointer" }}><X size={16} /></button>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Real ask: an editable history — tap a past workout, correct a weight/rep
// typo or a bad log after the fact, or delete an entry entirely (a false
// start, a duplicate, testing). `index` throughout is always the real
// position in `workouts` (oldest first) — the list itself is shown
// reversed (most-recent-first) but keeps each entry's real index so
// delete/update always hits the right one, same convention the bodyweight
// list already uses.
export function WorkoutHistoryEditor({ workouts, onClose, onDelete, onUpdate }) {
  const [openIdx, setOpenIdx] = useState(null);
  const [editedExercises, setEditedExercises] = useState(null); // working copy while editing, or null (not yet touched)
  const [confirmDelete, setConfirmDelete] = useState(false);

  function closeDetail() {
    setOpenIdx(null);
    setEditedExercises(null);
    setConfirmDelete(false);
  }

  function updateSet(exIdx, setIdx, field, val, baseExercises) {
    const copy = baseExercises.map((e) => ({ ...e, logged: (e.logged || []).map((l) => ({ ...l })) }));
    copy[exIdx].logged[setIdx][field] = val;
    setEditedExercises(copy);
  }

  if (openIdx !== null) {
    const entry = workouts[openIdx];
    const exercises = editedExercises || entry.exercises || [];
    return (
      <div className="fullscreen-overlay" style={{ background: T.paper, zIndex: 70, display: "flex", flexDirection: "column" }}>
        <div style={{ background: T.ink, padding: "calc(18px + env(safe-area-inset-top, 0px)) 20px 18px", color: "#fff", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#B9BEC6", letterSpacing: 1, fontWeight: 600 }}>{entry.date}</span>
            <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: "2px 0 0" }}>{entry.dayName}</h2>
          </div>
          <button onClick={closeDetail} aria-label="Close workout detail" style={{ background: "none", border: "none", color: "#B9BEC6", cursor: "pointer" }}><X size={22} /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {exercises.map((ex, exIdx) => (
            <Card key={exIdx} style={{ marginBottom: 10 }}>
              <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, margin: "0 0 8px" }}>{ex.name}</h3>
              {(ex.logged || []).map((l, setIdx) => (
                <div key={setIdx} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                  <span style={{ width: 16, flexShrink: 0, fontSize: 12, color: T.steelDark, fontFamily: "'JetBrains Mono', monospace" }}>{setIdx + 1}</span>
                  <input
                    type="number" placeholder="lb" value={l.weight ?? ""}
                    onChange={(e) => updateSet(exIdx, setIdx, "weight", e.target.value, exercises)}
                    aria-label={`${ex.name} set ${setIdx + 1} weight`}
                    style={{ flex: 1, minWidth: 0, padding: "8px 6px", borderRadius: 8, border: `1.5px solid ${T.steel}`, fontFamily: "'JetBrains Mono', monospace", fontSize: 15, boxSizing: "border-box" }}
                  />
                  <input
                    type="number" placeholder="reps" value={l.reps ?? ""}
                    onChange={(e) => updateSet(exIdx, setIdx, "reps", e.target.value, exercises)}
                    aria-label={`${ex.name} set ${setIdx + 1} reps`}
                    style={{ flex: 1, minWidth: 0, padding: "8px 6px", borderRadius: 8, border: `1.5px solid ${T.steel}`, fontFamily: "'JetBrains Mono', monospace", fontSize: 15, boxSizing: "border-box" }}
                  />
                </div>
              ))}
            </Card>
          ))}
        </div>
        <div style={{ padding: 16, borderTop: `1px solid ${T.steel}`, display: "flex", gap: 8, flexShrink: 0 }}>
          <Btn variant="ghost" onClick={() => setConfirmDelete(true)} style={{ flexShrink: 0 }}>Delete</Btn>
          <Btn
            variant="accent"
            style={{ flex: 1 }}
            onClick={() => {
              if (editedExercises) onUpdate(openIdx, editedExercises);
              closeDetail();
            }}
          >
            Save changes
          </Btn>
        </div>

        {confirmDelete && (
          <div className="fullscreen-overlay" style={{ background: "rgba(18,22,28,0.92)", zIndex: 75, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", padding: 28, textAlign: "center" }}>
            <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Delete this workout?</h3>
            <p style={{ color: "#B9BEC6", fontSize: 14, maxWidth: 300, marginBottom: 20 }}>This permanently removes it from your history. This can't be undone.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 280 }}>
              <Btn
                variant="accent"
                onClick={() => {
                  onDelete(openIdx);
                  closeDetail();
                }}
                style={{ width: "100%" }}
              >
                Delete
              </Btn>
              <button onClick={() => setConfirmDelete(false)} style={{ background: "none", border: "none", color: "#B9BEC6", fontSize: 13, cursor: "pointer", padding: "8px 0" }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const reversed = workouts.map((w, i) => ({ ...w, i })).reverse();
  return (
    <div className="fullscreen-overlay" style={{ background: T.paper, zIndex: 70, display: "flex", flexDirection: "column" }}>
      <div style={{ background: T.ink, padding: "calc(18px + env(safe-area-inset-top, 0px)) 20px 18px", color: "#fff", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>Workout history</h2>
        <button onClick={onClose} aria-label="Close workout history" style={{ background: "none", border: "none", color: "#B9BEC6", cursor: "pointer" }}><X size={22} /></button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {reversed.length === 0 ? (
          <p style={{ color: T.steelDark, fontSize: 13, textAlign: "center", marginTop: 40 }}>No workouts logged yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reversed.map((w) => (
              <Card key={w.i} onClick={() => setOpenIdx(w.i)} style={{ padding: 12, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>{w.dayName}</div>
                  <div style={{ fontSize: 11, color: T.steelDark }}>
                    {w.date}{w.durationSec ? ` · ${formatDuration(w.durationSec)}` : ""} · {(w.exercises || []).length} exercises
                  </div>
                </div>
                <ChevronRight size={16} color={T.steelDark} />
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   PROFILE
============================================================ */
export function ProfileTab({ state, resetAll, account, onLogout, subscribed, trialActive, trialDaysLeftCount, onOpenSubscribe, onSetReviewEnabled }) {
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  async function openManageSubscription() {
    setPortalLoading(true);
    setPortalError("");
    try {
      const res = await fetch("/api/create-portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.id }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        const raw = data.error || "";
        const friendly = raw.toLowerCase().includes("no such customer")
          ? "We couldn't find a billing record for this account — this can happen if your subscription was set up in an earlier test environment. Please contact support."
          : raw || "Couldn't open billing portal.";
        setPortalError(friendly);
        setPortalLoading(false);
      }
    } catch (e) {
      setPortalError("Couldn't open billing portal.");
      setPortalLoading(false);
    }
  }
  const { profile, targets } = state;
  const rows = [
    ["Goal", GOAL_SCHEME[profile.goal]?.label],
    ["Current build", (profile.currentPhysique || "").replace(/_/g, " ")],
    ["Target physique", profile.desiredPhysique],
    ["Specific goals", profile.specificGoals || "None stated"],
    ["Experience", profile.experience],
    ["Equipment", profile.equipment === "full" ? "Full Gym" : profile.equipment === "dumbbell" ? "Dumbbells" : "Bodyweight"],
    ["Training days/wk", profile.daysPerWeek],
    ["Session length", `~${profile.sessionLength} min`],
    ["Injuries noted", injuryDescription(profile)],
    ["Height", `${Math.floor(profile.heightIn / 12)}'${profile.heightIn % 12}"`],
    ["Weight on file", `${profile.weightLb} lb`],
    ["Maintenance (TDEE)", `${targets.tdee} cal`],
  ];
  return (
    <div style={{ padding: "calc(20px + env(safe-area-inset-top, 0px)) 16px 90px" }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, letterSpacing: 1, fontWeight: 600 }}>PROFILE</span>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "2px 0 4px", color: T.ink }}>Your Setup</h1>

      <TickRule label="Account" />
      <Card style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>{account?.name}</div>
          <div style={{ fontSize: 12, color: T.steelDark }}>{account?.email}</div>
        </div>
        <Btn variant="ghost" onClick={onLogout}>Log out</Btn>
      </Card>

      <TickRule label="Subscription" />
      <Card>
        {subscribed ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.good, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
              <Check size={16} /> Active subscription
            </div>
            <Btn variant="ghost" onClick={openManageSubscription} disabled={portalLoading} style={{ width: "100%" }}>
              {portalLoading ? "Opening…" : "Manage or cancel subscription"}
            </Btn>
            {portalError && <p style={{ color: T.warn, fontSize: 12, marginTop: 8 }}>{portalError}</p>}
          </>
        ) : trialActive ? (
          <>
            <div style={{ fontSize: 14, color: T.ink, fontWeight: 700, marginBottom: 4 }}>Free trial — {trialDaysLeftCount} day{trialDaysLeftCount === 1 ? "" : "s"} left</div>
            <p style={{ fontSize: 13, color: T.steelDark, margin: "0 0 12px" }}>Subscribe now to keep access after your trial ends.</p>
            <Btn variant="accent" onClick={onOpenSubscribe} style={{ width: "100%" }}>Subscribe</Btn>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: T.steelDark, margin: "0 0 12px" }}>You're not currently subscribed.</p>
            <Btn variant="accent" onClick={onOpenSubscribe} style={{ width: "100%" }}>Subscribe</Btn>
          </>
        )}
      </Card>

      <TickRule label="Details" />
      <Card>
        {rows.map(([label, val], i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: i < rows.length - 1 ? `1px solid ${T.steel}` : "none", gap: 12 }}>
            <span style={{ color: T.steelDark, fontSize: 13, flexShrink: 0 }}>{label}</span>
            <span style={{ fontWeight: 600, fontSize: 13, color: T.ink, textTransform: "capitalize", textAlign: "right" }}>{val}</span>
          </div>
        ))}
      </Card>

      <TickRule label="Reviews" />
      <Card>
        <p style={{ fontSize: 12, color: T.steelDark, margin: "0 0 10px" }}>A short AI-written progress review, generated automatically once a period's worth of data is in.</p>
        {[["weekly", "Weekly review"], ["monthly", "Monthly review"]].map(([cadence, label], i) => (
          <div key={cadence} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderTop: i > 0 ? `1px solid ${T.steel}` : "none" }}>
            <span style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>{label}</span>
            <button
              role="switch"
              aria-checked={!!state.reviewsEnabled?.[cadence]}
              aria-label={`Toggle ${label.toLowerCase()}`}
              onClick={() => onSetReviewEnabled(cadence, !state.reviewsEnabled?.[cadence])}
              style={{
                width: 42, height: 24, borderRadius: 12, border: "none", cursor: "pointer", padding: 2,
                background: state.reviewsEnabled?.[cadence] ? T.charge : T.steel,
                display: "flex", justifyContent: state.reviewsEnabled?.[cadence] ? "flex-end" : "flex-start",
              }}
            >
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", display: "block" }} />
            </button>
          </div>
        ))}
      </Card>

      <TickRule label="Support & legal" />
      <Card>
        <a href="mailto:support@overload-app.com" style={{ display: "block", fontSize: 13, color: T.ink, fontWeight: 600, padding: "8px 0", textDecoration: "none" }}>Contact support</a>
        <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: 13, color: T.ink, fontWeight: 600, padding: "8px 0", textDecoration: "none", borderTop: `1px solid ${T.steel}` }}>Terms of Service</a>
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ display: "block", fontSize: 13, color: T.ink, fontWeight: 600, padding: "8px 0", textDecoration: "none", borderTop: `1px solid ${T.steel}` }}>Privacy Policy</a>
      </Card>

      <TickRule label="Reset" />
      <Card>
        <p style={{ fontSize: 13, color: T.steelDark, marginTop: 0 }}>Retake the quiz to regenerate your program and macro targets from scratch. This permanently deletes all logged workouts, bodyweight entries, and coach chat history for this account — it cannot be undone.</p>
        {confirmReset ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Btn variant="accent" onClick={resetAll} style={{ width: "100%", background: T.protein }}>
              Yes, permanently delete everything
            </Btn>
            <button onClick={() => setConfirmReset(false)} style={{ background: "none", border: "none", color: T.steelDark, fontSize: 13, cursor: "pointer", padding: "6px 0" }}>
              Cancel
            </button>
          </div>
        ) : (
          <Btn variant="ghost" onClick={() => setConfirmReset(true)} style={{ width: "100%" }}><RotateCcw size={16} /> Retake quiz & reset</Btn>
        )}
      </Card>
    </div>
  );
}

/* ============================================================
   ROOT APP
============================================================ */
export default function App() {
  const [account, setAccount] = useState(null);
  const [subscribed, setSubscribed] = useState(false);
  const [trialStartedAt, setTrialStartedAt] = useState(null);
  const [showSubscribeOverlay, setShowSubscribeOverlay] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [confirmEmailPending, setConfirmEmailPending] = useState(null);
  const [justConfirmedEmail, setJustConfirmedEmail] = useState(false);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("home");
  const [session, setSession] = useState(null);
  const [conflictStartIdx, setConflictStartIdx] = useState(null); // dayIdx the user is trying to start while a DIFFERENT day is already paused, or null
  const [historyEditorOpen, setHistoryEditorOpen] = useState(false);
  const [coachLoading, setCoachLoading] = useState(false);
  // "synced" | "offline" (change saved locally, not yet on the server) | "saving"
  const [syncStatus, setSyncStatus] = useState("synced");
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Retry any unsynced local change as soon as connectivity returns — this
  // is what turns "saved locally at the gym" into "actually backed up"
  // without the person having to do anything themselves.
  useEffect(() => {
    if (!account) return;
    async function retryPendingSync() {
      if (!navigator.onLine || !hasPendingSync(account.id) || !stateRef.current) return;
      setSyncStatus("saving");
      const ok = await saveState(account.id, stateRef.current);
      setSyncStatus(ok ? "synced" : "offline");
    }
    retryPendingSync(); // covers reopening the app back online with a pending change already queued
    window.addEventListener("online", retryPendingSync);
    return () => window.removeEventListener("online", retryPendingSync);
  }, [account]);

  // Checks once per state change whether a weekly/monthly review has come
  // due — no cron/background jobs here, so "the app was opened" is the
  // only real trigger point available. reviewGenerating guards against
  // firing twice for the same cadence while a request is already in
  // flight (a fast double-render, or logs changing again mid-request).
  const reviewGeneratingRef = useRef({ weekly: false, monthly: false });
  useEffect(() => {
    if (!account || !state?.accountCreatedAt) return;
    ["weekly", "monthly"].forEach(async (cadence) => {
      if (!state.reviewsEnabled?.[cadence]) return;
      if (reviewGeneratingRef.current[cadence]) return;
      if (!isReviewDue(state.reviews, state.accountCreatedAt, cadence)) return;
      reviewGeneratingRef.current[cadence] = true;
      try {
        const periodStartMs = reviewPeriodStart(state.reviews, state.accountCreatedAt, cadence);
        const summary = summarizeReviewPeriod(state.logs, periodStartMs, Date.now());
        let overview = null;
        let advice = [];
        try {
          const raw = await claudeChat({
            system: buildReviewSystem(state.profile, cadence, summary),
            messages: [{ role: "user", content: "Write my review now." }],
          });
          const parsed = parseJSONLoose(raw);
          overview = parsed?.overview || null;
          advice = Array.isArray(parsed?.advice) ? parsed.advice : [];
        } catch (e) {
          // No connection or the call failed — still record a real,
          // data-only review below rather than losing the period
          // entirely; nothing here should block on AI availability.
        }
        const entry = { generatedAt: new Date().toISOString(), periodStartMs, periodEndMs: Date.now(), summary, overview, advice, seen: false };
        persist((prev) => ({ ...prev, reviews: { ...prev.reviews, [cadence]: [...(prev.reviews?.[cadence] || []), entry] } }));
      } finally {
        reviewGeneratingRef.current[cadence] = false;
      }
    });
  }, [account, state?.logs, state?.reviewsEnabled, state?.accountCreatedAt]);

  useEffect(() => {
    (async () => {
      // Clicking the confirmation link in the signup email lands back here
      // with type=signup in the URL and (by default) a live session already
      // created. This tab shows a clean "email confirmed" screen rather than
      // dropping straight into the app — but crucially keeps the session
      // alive (no signOut) so that whoever's still on the original "check
      // your email" tab (same browser, same origin, so it shares this
      // session via localStorage) picks it up and signs itself in
      // automatically. That's the point: someone who added the app to
      // their home screen and confirms via the Mail app shouldn't have to
      // come back and log in by hand.
      const params = new URLSearchParams(window.location.hash.replace(/^#/, "") + "&" + window.location.search.replace(/^\?/, ""));
      if (params.get("type") === "signup") {
        window.history.replaceState(null, "", window.location.pathname);
        setJustConfirmedEmail(true);
        setLoading(false);
        return;
      }

      // A cold start has to ask Supabase for a session before anything
      // else can happen, and that ask has no built-in timeout — a
      // completely offline device can leave this hanging indefinitely,
      // which left "loading" stuck true forever and the app a permanent
      // blank white screen. Real report: needed wifi just to OPEN the app
      // at all, despite working fine offline once it was already open.
      // Racing it against a timeout guarantees this resolves either way;
      // on timeout, fall back to whoever was last signed in on this
      // device and their already-cached local state, same as how the rest
      // of the app already works offline once open.
      const timedOut = Symbol("timedOut");
      const sessionPromise = supabase.auth.getSession().catch(() => null);
      const sessionResult = await Promise.race([
        sessionPromise,
        new Promise((resolve) => setTimeout(() => resolve(timedOut), 5000)),
      ]);
      if (sessionResult === timedOut || !sessionResult?.data?.session?.user) {
        const lastAccount = readLastAccount();
        if (lastAccount && !navigator.onLine) {
          setAccount({ id: lastAccount.id, name: lastAccount.name, email: lastAccount.email });
          setSubscribed(!!lastAccount.subscribed);
          setTrialStartedAt(lastAccount.trialStartedAt || null);
          const loadedLocal = readLocalState(lastAccount.id);
          setState(loadedLocal && loadedLocal.program ? { ...loadedLocal, program: normalizeProgramTips(loadedLocal.program) } : loadedLocal);
          setSyncStatus("offline");
        }
        // If the timeout was actually just a slow-but-live connection (not
        // truly offline), don't abandon it — once the real answer arrives,
        // hydrate for real so the person lands in their live account
        // rather than being stuck on the offline fallback (or a login
        // screen) with no way back in short of a manual reload.
        if (sessionResult === timedOut) {
          sessionPromise.then((late) => {
            if (late?.data?.session?.user) hydrateAccount(late.data.session.user);
          });
        }
      } else {
        await hydrateAccount(sessionResult.data.session.user);
      }
      setLoading(false);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setAccount(null);
        setState(null);
        setSubscribed(false);
        setTrialStartedAt(null);
      }
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
        setLoading(false);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // While showing "check your email," poll for the session appearing —
  // this is what actually signs someone in automatically the moment they
  // confirm via a link opened in a different tab/context (Mail app's
  // in-app browser, etc.), since that tab shares this browser's session
  // storage. Without this, confirming would only ever affect whichever tab
  // the link itself opened, not the one they were originally on.
  useEffect(() => {
    if (!confirmEmailPending) return;
    const interval = setInterval(async () => {
      const { data: { session: sbSession } } = await supabase.auth.getSession();
      if (sbSession?.user) {
        clearInterval(interval);
        setConfirmEmailPending(null);
        await hydrateAccount(sbSession.user);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [confirmEmailPending]);

  async function hydrateAccount(user) {
    const profileRow = await loadProfile(user.id);
    const accountObj = { id: user.id, name: profileRow?.name || user.user_metadata?.name || "", email: user.email };
    const subscribedVal = !!profileRow?.subscribed;
    const trialStartedAtVal = profileRow?.trial_started_at || null;
    setAccount(accountObj);
    setSubscribed(subscribedVal);
    setTrialStartedAt(trialStartedAtVal);
    // Caches the last-known entitlement alongside the account, not just
    // false/null defaults — a cold-start-while-offline fallback needs to
    // know whether this person was actually subscribed, not guess "no" and
    // wrongly show a paywall to someone who already pays.
    writeLastAccount({ ...accountObj, subscribed: subscribedVal, trialStartedAt: trialStartedAtVal });
    const { state: loaded, fromCache } = await loadState(user.id);
    // Backfills tips/alternatives onto programs saved before those features
    // existed, so existing accounts get offline-capable "How to do it" tips
    // and swap alternatives immediately on next load, no AI call needed.
    let finalState = loaded && loaded.program ? { ...loaded, program: normalizeProgramTips(loaded.program) } : loaded;

    // Backfills a permanent originalProgram for accounts created before that
    // existed — best-effort using the oldest entry still in their recent
    // history, or the current program itself if they've never changed it
    // (in which case current genuinely IS the original). Saved directly via
    // saveState rather than persist(), since account/state React state
    // isn't guaranteed settled yet at this point in the load sequence.
    if (finalState && finalState.program && !finalState.originalProgram) {
      const history = finalState.programHistory || [];
      const oldest = history.length > 0 ? history[history.length - 1] : null;
      finalState = {
        ...finalState,
        originalProgram: oldest ? oldest.program : finalState.program,
        originalTargets: oldest ? oldest.targets : finalState.targets,
      };
      saveState(user.id, finalState);
    }

    // Same backfill idea for accounts created before periodic reviews
    // existed — without accountCreatedAt, isReviewDue() has no anchor to
    // count a period from and silently never fires. Best-effort: falls
    // back to their oldest history snapshot's savedAt, or now if there's
    // no history either — either way the first review just ends up due
    // one period from whenever this backfill actually ran, not "always
    // was on since day one," which is fine for a one-time migration.
    if (finalState && !finalState.accountCreatedAt) {
      const history = finalState.programHistory || [];
      const oldest = history.length > 0 ? history[history.length - 1] : null;
      finalState = {
        ...finalState,
        accountCreatedAt: oldest?.savedAt || new Date().toISOString(),
        reviewsEnabled: finalState.reviewsEnabled || { weekly: false, monthly: false },
        reviews: finalState.reviews || { weekly: [], monthly: [] },
      };
      saveState(user.id, finalState);
    }

    setState(finalState);
    setSyncStatus(fromCache || hasPendingSync(user.id) ? "offline" : "synced");
  }

  // Used by the "Email confirmed" screen's continue button — the session
  // was never signed out (see the type=signup handling above), so this just
  // picks it up and enters the app, same as opening the app normally.
  async function continueIntoApp() {
    const { data: { session: sbSession } } = await supabase.auth.getSession();
    if (sbSession?.user) {
      await hydrateAccount(sbSession.user);
    }
    setJustConfirmedEmail(false);
  }

  async function checkSubscription() {
    if (!account) return;
    const profileRow = await loadProfile(account.id);
    setSubscribed(!!profileRow?.subscribed);
    setTrialStartedAt(profileRow?.trial_started_at || null);
  }

  // Cardless 30-day trial: just a timestamp on the user's own profile row,
  // no Stripe/payment info involved at all.
  async function startFreeTrial() {
    if (!account) return;
    const startedAt = new Date().toISOString();
    const { error } = await supabase.from("profiles").update({ trial_started_at: startedAt }).eq("id", account.id);
    if (!error) setTrialStartedAt(startedAt);
  }

  // The Stripe webhook updates the database asynchronously, so when we land
  // back on the app after checkout, poll briefly instead of assuming it's
  // already reflected.
  useEffect(() => {
    if (!account || subscribed) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      const profileRow = await loadProfile(account.id);
      if (profileRow?.subscribed) {
        setSubscribed(true);
        clearInterval(interval);
      } else if (attempts >= 6) {
        clearInterval(interval);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [account, subscribed]);

  function persist(updater) {
    setState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // Computed and used for the save right here, inside the updater —
      // React doesn't guarantee this callback runs synchronously right
      // after setState() is called, so reading "next" from an outer
      // variable after the fact is not reliable and previously saved
      // undefined instead of the real data.
      setSyncStatus("saving");
      saveState(account.id, next).then((ok) => setSyncStatus(ok ? "synced" : "offline"));
      return next;
    });
  }

  // Lives at the App level (not inside the Coach tab component) so an in-flight
  // request keeps running — and its reply gets saved — even if the person
  // switches to Train, Fuel, etc. while waiting on it.
  function clearCoachChat() {
    persist((prev) => ({ ...prev, coachChat: DEFAULT_COACH_MESSAGES }));
  }

  const COACH_DAILY_LIMIT = 30;

  async function sendCoachMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || coachLoading) return;

    const today = todayISO();
    const usage = stateRef.current.coachUsage;
    const usedToday = usage && usage.date === today ? usage.count : 0;
    const baseList = stateRef.current.coachChat && stateRef.current.coachChat.length ? stateRef.current.coachChat : DEFAULT_COACH_MESSAGES;

    if (usedToday >= COACH_DAILY_LIMIT) {
      const withUser = [...baseList, { role: "user", text: trimmed }];
      persist((prev) => ({
        ...prev,
        coachChat: [...withUser, { role: "assistant", text: "You've hit today's message limit for the coach — it resets tomorrow. Thanks for being an active user!" }],
      }));
      return;
    }

    const withUser = [...baseList, { role: "user", text: trimmed }];
    // Count this attempt against today's quota now, before the API call —
    // this way a maxed-out user is stopped above without ever costing an
    // API call, and this attempt is counted whether or not it succeeds.
    persist((prev) => ({ ...prev, coachChat: withUser, coachUsage: { date: today, count: usedToday + 1 } }));
    setCoachLoading(true);
    try {
      const system = buildCoachSystem(stateRef.current);
      // The API requires the conversation to start with a "user" turn — drop the
      // assistant's opening greeting bubble (and anything before the first user message).
      const firstUserIdx = withUser.findIndex((m) => m.role === "user");
      const apiMessages = withUser.slice(firstUserIdx).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      const raw = await claudeChat({ system, messages: apiMessages });
      let parsed;
      try {
        parsed = parseJSONLoose(raw);
      } catch (parseErr) {
        console.error("Coach JSON parse failed. Raw response was: " + raw);
        const extractedReply = extractReplyOnly(raw);
        const looksLikePlainText = !raw.includes("{");
        parsed = {
          reply: extractedReply || (looksLikePlainText ? raw.trim() : "Got it — though my response got cut off partway through that one. Mind trying again, maybe as a smaller request?"),
          program: null,
          todayOverride: null,
        };
      }
      console.log("Coach response received:", JSON.stringify(parsed));
      const { hasOverride, hasValidTargets, hasNewProgram, restoreIdx, restoreOriginal, madeChange } = coachResponseFlags(parsed);
      const replyText = coachReplyText(parsed, madeChange);
      const withReply = [...withUser, { role: "assistant", text: replyText }];

      // Diagnostics: flag cases that look like a bug so they're visible in the
      // console without needing to guess after the fact.
      if (!parsed.reply || !parsed.reply.trim()) {
        console.warn("Coach returned an empty reply for message: \"" + trimmed + "\". Full parsed response: " + JSON.stringify(parsed));
      }
      if (restoreIdx !== null && !(stateRef.current.programHistory || [])[restoreIdx]) {
        console.warn("Coach set restoreIndex=" + restoreIdx + " but no matching history entry exists. History length: " + (stateRef.current.programHistory || []).length);
      }
      if (restoreOriginal && !stateRef.current.originalProgram) {
        console.warn("Coach set restoreOriginal=true but this account has no originalProgram saved.");
      }
      const revertKeywords = /\b(go back|revert|undo|original|before|forget)\b/i;
      if (revertKeywords.test(trimmed) && restoreIdx === null && !restoreOriginal && !hasNewProgram && !hasValidTargets) {
        console.warn("Message looked like a revert request but nothing changed (no restoreIndex, restoreOriginal, program, or targets set). Full parsed response: " + JSON.stringify(parsed));
      }

      persist((prev) => {
        const history = prev.programHistory || [];

        // Restoring the permanently-kept original — always reliable,
        // regardless of how deep programHistory goes (or has already rolled
        // past). Checked first since it's the more specific/intentional ask.
        if (restoreOriginal && prev.originalProgram) {
          const newHistory = [
            { program: prev.program, targets: prev.targets, savedAt: new Date().toISOString() },
            ...history,
          ].slice(0, PROGRAM_HISTORY_LIMIT);
          return {
            ...prev,
            coachChat: withReply,
            program: prev.originalProgram,
            targets: prev.originalTargets,
            programHistory: newHistory,
          };
        }

        // Restoring from a saved snapshot: apply the exact stored program/targets,
        // never something the model reconstructed from memory.
        if (restoreIdx !== null && history[restoreIdx]) {
          const snapshot = history[restoreIdx];
          const newHistory = [
            { program: prev.program, targets: prev.targets, savedAt: new Date().toISOString() },
            ...history,
          ].slice(0, PROGRAM_HISTORY_LIMIT);
          return {
            ...prev,
            coachChat: withReply,
            program: snapshot.program,
            targets: snapshot.targets,
            programHistory: newHistory,
          };
        }

        // A real, non-restore change to program and/or targets: snapshot the
        // current version into history first so it can be reverted to later.
        if (hasNewProgram || hasValidTargets) {
          const newHistory = [
            { program: prev.program, targets: prev.targets, savedAt: new Date().toISOString() },
            ...history,
          ].slice(0, PROGRAM_HISTORY_LIMIT);
          return {
            ...prev,
            coachChat: withReply,
            program: hasNewProgram ? normalizeProgramTips({ splitName: deriveSplitName(parsed.program.days) || prev.program.splitName, days: parsed.program.days }) : prev.program,
            todayOverride: hasOverride ? withTips(parsed.todayOverride) : prev.todayOverride,
            targets: hasValidTargets
              ? { calories: Math.round(t.calories), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat), tdee: prev.targets.tdee }
              : prev.targets,
            programHistory: newHistory,
          };
        }

        // No lasting change (e.g. a one-time swap, or just a question) — no history entry needed.
        return {
          ...prev,
          coachChat: withReply,
          todayOverride: hasOverride ? withTips(parsed.todayOverride) : prev.todayOverride,
        };
      });
    } catch (e) {
      console.error("Coach send failed:", e);
      const failText = e.offline ? OFFLINE_MESSAGE : "Sorry, I couldn't reach the coach just now. Please try sending that again in a moment.";
      persist((prev) => ({ ...prev, coachChat: [...withUser, { role: "assistant", text: failText }] }));
    } finally {
      setCoachLoading(false);
    }
  }

  async function handleSignUp({ name, email, password }) {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { name } },
    });
    if (error) return { ok: false, error: error.message };
    // Supabase deliberately doesn't error here if the email is already
    // registered (to avoid leaking which emails have accounts) — but it
    // does leave a tell: data.user.identities is an empty array for an
    // existing, already-confirmed account, vs. containing an entry for a
    // genuinely new signup.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { ok: false, error: "That email is already registered — sign in instead." };
    }
    if (!data.session) {
      // Email confirmation is required by the Supabase project settings —
      // there's no session yet until they click the link in their inbox.
      setConfirmEmailPending(email);
      return { ok: true };
    }
    await hydrateAccount(data.user);
    return { ok: true };
  }

  async function resendConfirmation(email) {
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function handleSignIn({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    await hydrateAccount(data.user);
    return { ok: true };
  }

  async function handleForgotPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function handleSetNewPassword(password) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, error: error.message };
    setPasswordRecovery(false);
    // Give the new session a moment to fully settle before reading data —
    // this is the extra safety net on top of the retry logic in loadState/loadProfile.
    await new Promise((r) => setTimeout(r, 400));
    const { data: { session: sbSession } } = await supabase.auth.getSession();
    if (sbSession?.user) await hydrateAccount(sbSession.user);
    return { ok: true };
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setAccount(null);
    setState(null);
    setSubscribed(false);
    setActiveTab("home");
  }

  function handleOnboarded({ profile, program, targets }) {
    const fresh = {
      profile, program, targets,
      // Kept forever, separate from programHistory (which only holds the
      // most recent PROGRAM_HISTORY_LIMIT changes and can age out) — this
      // is what "back to my original program" restores, guaranteed, no
      // matter how many changes happen afterward.
      originalProgram: program,
      originalTargets: targets,
      logs: { workouts: [], nutrition: [], bodyweight: [{ date: todayISO(), weight: profile.weightLb }] },
      coachChat: DEFAULT_COACH_MESSAGES,
      todayOverride: null,
      inProgressWorkout: null,
      coachUsage: null,
      programHistory: [],
      gifCache: {},
      accountCreatedAt: new Date().toISOString(),
      reviewsEnabled: { weekly: !!profile.weeklyReviewEnabled, monthly: !!profile.monthlyReviewEnabled },
      reviews: { weekly: [], monthly: [] },
    };
    persist(fresh);
  }

  // Only one paused workout can be held in inProgressWorkout at a time —
  // starting a second, DIFFERENT day while one is already paused silently
  // overwrote it the moment "Save & exit" ran on the new one, with no
  // warning it was about to happen. Real report: "I accidentally selected
  // a new workout and it deleted my other workout with no warning."
  // Skipped for a same-day resume (state.inProgressWorkout.dayIdx ===
  // dayIdx) and for the resume button itself (resume === true) — neither
  // of those can actually lose anything.
  function startWorkout(dayIdx, resume) {
    if (!resume && state.inProgressWorkout && state.inProgressWorkout.dayIdx !== dayIdx) {
      setConflictStartIdx(dayIdx);
      return;
    }
    // resumedAt marks the start of THIS active stretch — whether that's a
    // brand-new workout or picking a saved one back up — so duration only
    // ever counts time the workout screen was actually open.
    setSession({ dayIdx, resume: !!resume, resumedAt: Date.now() });
  }

  // Applies a chosen swap — this step itself is always instant/offline,
  // regardless of whether the alternatives list it was picked from came
  // from baked-in AI data, a live smart lookup, or the offline pool
  // fallback. scope "today" only overrides this session (cleared
  // automatically when the workout finishes, same as a Coach one-time
  // swap); "permanent" updates the actual program going forward,
  // snapshotted into history so it's revertible like any other program change.
  function swapExercise(dayIdx, exIdx, newExerciseName, scope) {
    persist((prev) => {
      const hasOverride = Array.isArray(prev.todayOverride) && prev.todayOverride.length > 0;
      const baseExercises = hasOverride ? prev.todayOverride : prev.program.days[dayIdx].exercises;
      const newExercises = baseExercises.map((ex, i) =>
        i === exIdx ? { name: newExerciseName, sets: ex.sets, reps: ex.reps, rest: ex.rest, tips: tipsForExercise(newExerciseName) } : ex
      );

      if (scope === "today") {
        return { ...prev, todayOverride: newExercises };
      }

      const history = prev.programHistory || [];
      const newHistory = [
        { program: prev.program, targets: prev.targets, savedAt: new Date().toISOString() },
        ...history,
      ].slice(0, PROGRAM_HISTORY_LIMIT);
      const newDays = prev.program.days.map((d, i) => (i === dayIdx ? { ...d, exercises: newExercises } : d));
      return { ...prev, program: { ...prev.program, days: newDays }, programHistory: newHistory };
    });
  }

  // Caches a one-time smart-lookup result onto the exercise itself, so the
  // live AI call for "similar exercises" never has to run twice for the
  // same exercise. Not a "change" worth a history snapshot — just enriching
  // existing data.
  function cacheAlternatives(dayIdx, exIdx, alternatives) {
    persist((prev) => {
      const hasOverride = Array.isArray(prev.todayOverride) && prev.todayOverride.length > 0;
      const baseExercises = hasOverride ? prev.todayOverride : prev.program.days[dayIdx].exercises;
      const newExercises = baseExercises.map((ex, i) => (i === exIdx ? { ...ex, alternatives } : ex));
      if (hasOverride) return { ...prev, todayOverride: newExercises };
      const newDays = prev.program.days.map((d, i) => (i === dayIdx ? { ...d, exercises: newExercises } : d));
      return { ...prev, program: { ...prev.program, days: newDays } };
    });
  }

  // Global, account-wide, name-keyed WorkoutX GIF cache — gifUrl is a real
  // URL string, or null for "checked, confirmed none available". Real
  // usage data showed the earlier per-exercise-object version fetching
  // "Barbell Bench Press" 3 separate times, because the same exercise name
  // appearing on more than one day of the program each had its own
  // independent, uncached slot. Keyed by name instead, this is a genuine
  // one-time cost per exercise ever, for the whole account — not per
  // occurrence, not per workout session.
  function cacheGif(key, gifUrl) {
    persist((prev) => ({ ...prev, gifCache: { ...(prev.gifCache || {}), [key]: gifUrl } }));
  }

  function saveWorkoutProgress(dayIdx, sets) {
    const activeSeconds = accumulateActiveSeconds(state.inProgressWorkout?.activeSeconds, session.resumedAt, Date.now());
    persist((prev) => ({ ...prev, inProgressWorkout: { dayIdx, sets, savedAt: new Date().toISOString(), activeSeconds } }));
    setSession(null);
  }

  function discardWorkoutProgress() {
    persist((prev) => ({ ...prev, inProgressWorkout: null }));
    setSession(null);
  }

  function finishWorkout(sets) {
    const day = state.program.days[session.dayIdx];
    const durationSec = accumulateActiveSeconds(state.inProgressWorkout?.activeSeconds, session.resumedAt, Date.now());
    const entry = { date: todayISO(), dayName: day.name, exercises: sets, durationSec };
    persist((prev) => ({ ...prev, logs: { ...prev.logs, workouts: [...prev.logs.workouts, entry] }, todayOverride: null, inProgressWorkout: null }));
    setSession(null);
    setActiveTab("train");
  }

  function lastLogFor(dayName) {
    return state.logs.workouts.slice().reverse().find((w) => w.dayName === dayName) || null;
  }

  // dateISO defaults to today, but a photo analyzed after coming back online
  // passes the date it was actually captured, so it lands on the right day.
  function addMeal(meal, dateISO) {
    const date = dateISO || todayISO();
    persist((prev) => {
      const nutrition = [...prev.logs.nutrition];
      const idx = nutrition.findIndex((d) => d.date === date);
      if (idx === -1) nutrition.push({ date, meals: [meal] });
      else nutrition[idx] = { ...nutrition[idx], meals: [...nutrition[idx].meals, meal] };
      return { ...prev, logs: { ...prev.logs, nutrition } };
    });
  }

  function removeMeal(mealIdx) {
    const today = todayISO();
    persist((prev) => {
      const nutrition = prev.logs.nutrition.map((d) => (d.date === today ? { ...d, meals: d.meals.filter((_, i) => i !== mealIdx) } : d));
      return { ...prev, logs: { ...prev.logs, nutrition } };
    });
  }

  function addWeight(weight) {
    persist((prev) => ({ ...prev, logs: { ...prev.logs, bodyweight: [...prev.logs.bodyweight, { date: todayISO(), weight }] } }));
  }

  function removeWeight(index) {
    persist((prev) => ({ ...prev, logs: { ...prev.logs, bodyweight: prev.logs.bodyweight.filter((_, i) => i !== index) } }));
  }

  // index here is always the real position in logs.workouts (oldest
  // first) — callers showing a reversed, most-recent-first list must map
  // back to this real index themselves, same convention as removeWeight
  // above and the bodyweight list's own reversed rendering.
  function deleteWorkoutLog(index) {
    persist((prev) => ({ ...prev, logs: { ...prev.logs, workouts: prev.logs.workouts.filter((_, i) => i !== index) } }));
  }

  function updateWorkoutLog(index, updatedExercises) {
    persist((prev) => ({
      ...prev,
      logs: { ...prev.logs, workouts: prev.logs.workouts.map((w, i) => (i === index ? { ...w, exercises: updatedExercises } : w)) },
    }));
  }

  function setReviewEnabled(cadence, enabled) {
    persist((prev) => ({ ...prev, reviewsEnabled: { ...prev.reviewsEnabled, [cadence]: enabled } }));
  }

  function markReviewSeen(cadence, index) {
    persist((prev) => ({
      ...prev,
      reviews: { ...prev.reviews, [cadence]: (prev.reviews?.[cadence] || []).map((r, i) => (i === index ? { ...r, seen: true } : r)) },
    }));
  }

  function resetAll() {
    persist(null);
  }

  if (loading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: T.paper }}><style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style></div>;
  }

  if (passwordRecovery) {
    return (
      <div className="auth-screen-outer">
        <style>{FONT_IMPORT}</style>
        <style>{SHELL_CSS}</style>
        <SetNewPasswordScreen onSetPassword={handleSetNewPassword} />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="auth-screen-outer">
        <style>{FONT_IMPORT}</style>
        <style>{SHELL_CSS}</style>
        {justConfirmedEmail ? (
          <EmailConfirmedScreen onContinue={continueIntoApp} />
        ) : confirmEmailPending ? (
          <ConfirmEmailScreen
            email={confirmEmailPending}
            onResend={resendConfirmation}
            onBackToLogin={() => setConfirmEmailPending(null)}
          />
        ) : (
          <Login onSignUp={handleSignUp} onSignIn={handleSignIn} onForgotPassword={handleForgotPassword} />
        )}
      </div>
    );
  }

  const trialActive = isTrialActive(trialStartedAt);

  if (!state) {
    return (
      <div className="auth-screen-outer">
        <style>{FONT_IMPORT}</style>
        <style>{SHELL_CSS}</style>
        <Onboarding onComplete={handleOnboarded} />
      </div>
    );
  }

  if (!subscribed && !trialActive) {
    return (
      <div className="auth-screen-outer">
        <style>{FONT_IMPORT}</style>
        <style>{SHELL_CSS}</style>
        <Paywall
          account={account}
          trialUsed={!!trialStartedAt}
          onStartTrial={startFreeTrial}
          onRefresh={checkSubscription}
          onLogout={handleLogout}
        />
      </div>
    );
  }

  const TABS = [
    { key: "home", label: "Home", icon: HomeIcon },
    { key: "train", label: "Train", icon: Dumbbell },
    { key: "coach", label: "Coach", icon: MessageCircle },
    { key: "fuel", label: "Fuel", icon: Utensils },
    { key: "progress", label: "Progress", icon: TrendingUp },
    { key: "profile", label: "You", icon: User },
  ];

  // todayOverride is a Coach one-time swap for "your next upcoming
  // session" — same day-of-rotation math as Home/Train use to decide which
  // card gets the NEXT pill. It was being applied to whichever dayIdx the
  // active session actually pointed at, with no check that it was really
  // that same day — so a stale override generated for legs kept getting
  // overlaid onto push, back, or any other day the person actually picked,
  // forcing them into a workout they never chose. Real report: "it took me
  // to legs every time" no matter what was tapped.
  const nextIdx = state.logs.workouts.length % state.program.days.length;
  const sessionIsNextDay = session && session.dayIdx === nextIdx;

  return (
    <div className="app-shell">
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>

      <div className="sidebar-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", marginBottom: 36 }}>
          <Zap size={20} color={T.charge} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: 2, color: T.charge, fontWeight: 700 }}>OVERLOAD</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 10, border: "none", cursor: "pointer", background: active ? "rgba(78,74,242,0.18)" : "transparent", color: active ? "#fff" : "#9CA3AF", fontWeight: active ? 700 : 500, fontSize: 14, textAlign: "left", position: "relative" }}
              >
                {t.key === "coach" && coachLoading && !active && (
                  <span style={{ position: "absolute", top: 8, left: 30, width: 7, height: 7, borderRadius: "50%", background: T.charge, animation: "pulseDot 1s ease-in-out infinite" }} />
                )}
                <Icon size={19} strokeWidth={active ? 2.5 : 2} color={active ? T.charge : "#9CA3AF"} />
                {t.label}
              </button>
            );
          })}
        </div>
        <button onClick={handleLogout} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 10, border: "none", cursor: "pointer", background: "transparent", color: "#9CA3AF", fontSize: 13, textAlign: "left" }}>
          <LogOut size={17} /> Log out
        </button>
      </div>

      <div className="app-main" style={{ fontFamily: "'Inter', sans-serif" }}>
        {syncStatus === "offline" && (
          <div style={{ background: T.warn, color: "#fff", fontSize: 12, fontWeight: 600, textAlign: "center", padding: "9px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", flexShrink: 0, animation: "pulseDot 1.4s ease-in-out infinite" }} />
            Offline — saved on this device, will sync automatically
          </div>
        )}
        {!subscribed && trialActive && (
          // A soft tint (same treatment as the Coach discoverability hint on
          // Train) rather than a solid full-width charge-purple bar — a beta
          // review flagged the old version as the single most attention-
          // grabbing element on the page, which fights against the app
          // otherwise feeling premium/calm rather than pushy about billing.
          <div style={{ background: "#EEEDFF", color: T.chargeDeep, fontSize: 12, fontWeight: 600, textAlign: "center", padding: "6px 16px" }}>
            {/* chargeDeep on this tint verifies at 7.2:1 — well above WCAG
                AA's 4.5:1 for normal text, and the button text is bold on
                top of that. */}
            {trialDaysLeft(trialStartedAt)} day{trialDaysLeft(trialStartedAt) === 1 ? "" : "s"} left in your trial · <button onClick={() => setActiveTab("profile")} style={{ background: "none", border: "none", color: T.chargeDeep, textDecoration: "underline", cursor: "pointer", fontWeight: 700, fontSize: 12, padding: 0 }}>Subscribe anytime</button>
          </div>
        )}
        <div className="app-main-inner">
          {activeTab === "home" && (
            <Home
              state={state}
              setActiveTab={setActiveTab}
              startWorkout={startWorkout}
              onAskCoach={(prompt) => { setActiveTab("coach"); sendCoachMessage(prompt); }}
            />
          )}
          {activeTab === "train" && <Train state={state} startWorkout={startWorkout} setActiveTab={setActiveTab} />}
          {activeTab === "coach" && <Coach messages={state.coachChat} loading={coachLoading} onSend={sendCoachMessage} onClearChat={clearCoachChat} coachUsage={state.coachUsage} dailyLimit={COACH_DAILY_LIMIT} />}
          {activeTab === "fuel" && <Fuel state={state} addMeal={addMeal} removeMeal={removeMeal} userId={account.id} />}
          {activeTab === "progress" && <Progress state={state} addWeight={addWeight} removeWeight={removeWeight} onOpenHistory={() => setHistoryEditorOpen(true)} onMarkReviewSeen={markReviewSeen} />}
          {activeTab === "profile" && <ProfileTab state={state} resetAll={resetAll} account={account} onLogout={handleLogout} subscribed={subscribed} trialActive={trialActive} trialDaysLeftCount={trialDaysLeft(trialStartedAt)} onOpenSubscribe={() => setShowSubscribeOverlay(true)} onSetReviewEnabled={setReviewEnabled} />}
        </div>

        <div className="bottom-nav">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 0", color: active ? T.charge : T.steelDark, position: "relative" }}
              >
                {t.key === "coach" && coachLoading && !active && (
                  <span style={{ position: "absolute", top: 3, right: "calc(50% - 14px)", width: 7, height: 7, borderRadius: "50%", background: T.charge, animation: "pulseDot 1s ease-in-out infinite" }} />
                )}
                <Icon size={19} strokeWidth={active ? 2.5 : 2} />
                <span style={{ fontSize: 9, fontWeight: active ? 700 : 500 }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Guards against a stale saved workout referencing a day that no
          longer exists — e.g. the Coach permanently shrunk the program's
          day count while this was paused. Without this check, resuming it
          would crash trying to render an undefined day. Hidden on the
          Coach tab specifically — real report: it floats right over the
          middle of an active chat, covering message text just above the
          input box. Home and Train already surface resume prominently, so
          nothing is actually lost by not floating it here too. */}
      {state.inProgressWorkout && !session && activeTab !== "coach" && state.program.days[state.inProgressWorkout.dayIdx] && (
        <button
          className="resume-bar"
          onClick={() => startWorkout(state.inProgressWorkout.dayIdx, true)}
          style={{ background: T.ink, color: "#fff", border: "none", borderRadius: 999, padding: "10px 18px 10px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", boxShadow: "0 8px 24px rgba(18,22,28,0.4)" }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: T.charge, flexShrink: 0, animation: "pulseDot 1.4s ease-in-out infinite" }} />
          <span style={{ textAlign: "left" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#B9BEC6", letterSpacing: 1 }}>RESUME</div>
            <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
              {Array.isArray(state.todayOverride) && state.todayOverride.length > 0 && state.inProgressWorkout.dayIdx === nextIdx
                ? overrideDayName(state.todayOverride)
                : state.program.days[state.inProgressWorkout.dayIdx]?.name}
            </div>
          </span>
          <ChevronRight size={16} color={T.charge} />
        </button>
      )}

      {conflictStartIdx !== null && state.inProgressWorkout && (
        <div className="fullscreen-overlay" style={{ background: "rgba(18,22,28,0.92)", zIndex: 70, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", padding: 28, textAlign: "center" }}>
          <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>You have an unfinished workout</h3>
          <p style={{ color: "#B9BEC6", fontSize: 14, maxWidth: 320, marginBottom: 24 }}>
            Starting "{state.program.days[conflictStartIdx]?.name}" now will permanently discard your paused progress on "{state.program.days[state.inProgressWorkout.dayIdx]?.name}".
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 320 }}>
            <Btn
              variant="accent"
              onClick={() => {
                const idx = conflictStartIdx;
                persist((prev) => ({ ...prev, inProgressWorkout: null }));
                setConflictStartIdx(null);
                setSession({ dayIdx: idx, resume: false, resumedAt: Date.now() });
              }}
              style={{ width: "100%" }}
            >
              Discard it & start "{state.program.days[conflictStartIdx]?.name}"
            </Btn>
            <Btn
              variant="ghost"
              onClick={() => {
                const idx = state.inProgressWorkout.dayIdx;
                setConflictStartIdx(null);
                setSession({ dayIdx: idx, resume: true, resumedAt: Date.now() });
              }}
              style={{ width: "100%", color: "#fff", borderColor: "rgba(255,255,255,0.25)" }}
            >
              Resume "{state.program.days[state.inProgressWorkout.dayIdx]?.name}" instead
            </Btn>
            <button onClick={() => setConflictStartIdx(null)} style={{ background: "none", border: "none", color: "#B9BEC6", fontSize: 13, cursor: "pointer", padding: "8px 0" }}>Cancel</button>
          </div>
        </div>
      )}

      {session && state.program.days[session.dayIdx] && (
        <WorkoutSession
          day={
            Array.isArray(state.todayOverride) && state.todayOverride.length > 0 && sessionIsNextDay
              ? { ...state.program.days[session.dayIdx], name: overrideDayName(state.todayOverride), exercises: state.todayOverride }
              : state.program.days[session.dayIdx]
          }
          isOverride={Array.isArray(state.todayOverride) && state.todayOverride.length > 0 && sessionIsNextDay}
          lastLog={lastLogFor(state.program.days[session.dayIdx].name)}
          logs={state.logs}
          resumedAt={session.resumedAt}
          priorActiveSeconds={session.resume && state.inProgressWorkout && state.inProgressWorkout.dayIdx === session.dayIdx ? state.inProgressWorkout.activeSeconds : 0}
          initialSets={session.resume && state.inProgressWorkout && state.inProgressWorkout.dayIdx === session.dayIdx ? state.inProgressWorkout.sets : null}
          onFinish={finishWorkout}
          onCancel={discardWorkoutProgress}
          onSaveExit={(sets) => saveWorkoutProgress(session.dayIdx, sets)}
          equipment={state.profile.equipment}
          injuries={state.profile.injuries}
          onSwapExercise={(exIdx, newName, scope) => swapExercise(session.dayIdx, exIdx, newName, scope)}
          onCacheAlternatives={(exIdx, alts) => cacheAlternatives(session.dayIdx, exIdx, alts)}
          gifCache={state.gifCache || {}}
          onCacheGif={cacheGif}
        />
      )}

      {showSubscribeOverlay && (
        <SubscribeOverlay account={account} onClose={() => setShowSubscribeOverlay(false)} />
      )}

      {historyEditorOpen && (
        <WorkoutHistoryEditor
          workouts={state.logs.workouts}
          onClose={() => setHistoryEditorOpen(false)}
          onDelete={deleteWorkoutLog}
          onUpdate={updateWorkoutLog}
        />
      )}
    </div>
  );
}
