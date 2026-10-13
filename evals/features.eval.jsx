// @vitest-environment jsdom
//
// EVERY OTHER AI FEATURE, against the real model. Real ask: "the main parts
// of the app work, it's all the AI stuff that doesn't — test every part."
// The Coach has its own list (coach.eval.jsx); this covers the rest, calling
// the app's own prompts, request shape (api/claude.js's buildUpstreamBody)
// and parsers, then checking what a person would actually get:
//   - a program built from the quiz (onboarding, and editing quiz answers)
//   - "describe what you ate" estimates
//   - "suggest meals for what's left today"
//   - weekly / monthly reviews
//   - exercise alternatives (the server endpoint itself)
//
// Costs real money, so it is NOT part of `npm test`:
//   ANTHROPIC_API_KEY=sk-ant-... npx vitest run --config evals/vitest.config.js evals/features.eval.jsx
//   EVAL_FEATURES_BUDGET_USD=1.50   hard stop for this file (default 1.50)
//   EVAL_ONLY=program,meal          only checks whose id contains one of these
// A report is written to evals/results/.
import { describe, test, expect, vi, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { buildUpstreamBody } from "../api/claude.js";

const KEY = process.env.ANTHROPIC_API_KEY;
const BUDGET_CENTS = Number(process.env.EVAL_FEATURES_BUDGET_USD || 1.5) * 100;
const ONLY = (process.env.EVAL_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
const USER = { id: "eval-user", email: "eval@example.com" };

vi.mock("../src/supabaseClient.js", () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: USER, access_token: "eval" } } })) },
    from: vi.fn(() => ({ insert: vi.fn(async () => ({})), select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: null })) })),
  },
}));
// For the alternatives endpoint: signed in, nothing cached.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "eval-user" } }, error: null }) },
    from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null }), upsert: async () => ({}) }; return q; },
  }),
}));

// ---- real API, with a running bill -------------------------------------
const realFetch = globalThis.fetch;
const ledger = { cents: 0, calls: 0 };
function costCents(u) {
  return (((u?.input_tokens || 0) * 2 + (u?.cache_read_input_tokens || 0) * 0.2 + (u?.cache_creation_input_tokens || 0) * 4 + (u?.output_tokens || 0) * 10) / 1e6) * 100;
}
async function callAnthropic(body) {
  if (ledger.cents >= BUDGET_CENTS) throw new Error(`Eval budget of $${(BUDGET_CENTS / 100).toFixed(2)} reached — stopping.`);
  const res = await realFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  ledger.cents += costCents(data.usage);
  ledger.calls++;
  return { res, data };
}
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("/api/claude")) {
    const { res, data } = await callAnthropic(buildUpstreamBody(JSON.parse(init.body)));
    return { ok: res.ok, status: res.status, headers: new Headers({ "content-type": "application/json" }), json: async () => data };
  }
  if (u.includes("/api/exercise-alternatives")) {
    // The app's own request, answered by the real endpoint (which then calls
    // the real model through the branch below).
    const query = Object.fromEntries(new URL(u, "https://x").searchParams);
    const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await alternativesHandlerRef.current({ method: "GET", headers: { authorization: "Bearer eval" }, query }, res);
    return { ok: res.statusCode === 200, status: res.statusCode, json: async () => res.body };
  }
  if (u.includes("api.anthropic.com")) {
    const { res, data } = await callAnthropic(JSON.parse(init.body));
    return { ok: res.ok, status: res.status, json: async () => data };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const alternativesHandlerRef = { current: null };
const App = await import("../src/App.jsx");
const {
  claudeChat, parseJSONLoose, acceptGeneratedProgram, buildProgramGenSystem, calcTargets, gentlePlan,
  MEAL_TEXT_SYSTEM, cleanAiMeal, mealNameFromDescription, buildMealSuggestionSystem, mealSuggestionUserMessage,
  mealSuggestionsFrom, buildReviewSystem, summarizeReviewPeriod, inferMuscleGroup, dayFocusGroups, INJURY_EXCLUDES,
  usesOnly, isSameCoreExercise, reviewFromParsed, generateProgramWithRetry,
} = App;
const { default: alternativesHandler } = await import("../api/exercise-alternatives.js");
alternativesHandlerRef.current = alternativesHandler;
const { fetchSimilarExercises } = App;

// ---- helpers --------------------------------------------------------------
const results = [];
const run = KEY ? describe : describe.skip;
const wanted = (id) => ONLY.length === 0 || ONLY.some((o) => id.includes(o));
async function check(id, what, fn) {
  if (!wanted(id)) return;
  const started = Date.now();
  let failures = [], detail = "";
  try {
    const out = await fn();
    failures = (out.failures || []).filter(Boolean);
    detail = out.detail || "";
  } catch (e) {
    failures = [`threw: ${e.message}`];
  }
  results.push({ id, what, failures, detail, ms: Date.now() - started });
}
const macroGap = (m) => Math.abs(4 * m.protein + 4 * m.carb + 9 * m.fat - m.cal) / Math.max(1, m.cal);

function baseProfile(over = {}) {
  return {
    sex: "male", age: 25, heightIn: 70, weightLb: 175, goal: "build", experience: "intermediate", equipment: "full",
    daysPerWeek: 4, sessionLength: 60, activity: "light", injuries: ["none"], otherInjuries: "", diet: [], otherDiet: "",
    foodPrefs: "", notes: "", currentPhysique: "average", desiredPhysique: "lean and muscular", specificGoals: "", ...over,
  };
}

// ---- 1. programs from the quiz ---------------------------------------------
const PROFILES = [
  ["program-beginner-3", baseProfile({ experience: "beginner", daysPerWeek: 3, goal: "lose", sessionLength: 45 })],
  ["program-intermediate-4", baseProfile()],
  ["program-advanced-6", baseProfile({ experience: "advanced", daysPerWeek: 6, sessionLength: 75 })],
  ["program-5-day-female", baseProfile({ sex: "female", weightLb: 140, daysPerWeek: 5, goal: "recomp" })],
  ["program-dumbbells-only", baseProfile({ equipment: "dumbbell", daysPerWeek: 4 })],
  ["program-bodyweight-only", baseProfile({ equipment: "bodyweight", daysPerWeek: 3, sessionLength: 30 })],
  ["program-knees", baseProfile({ injuries: ["knees"], daysPerWeek: 4 })],
  ["program-shoulders-lowerback", baseProfile({ injuries: ["shoulders", "lower_back"], daysPerWeek: 3 })],
  ["program-minor-16", baseProfile({ age: 16, weightLb: 140, daysPerWeek: 4, experience: "beginner" })],
  ["program-30min-5day", baseProfile({ daysPerWeek: 5, sessionLength: 30 })],
  ["program-older-lifter", baseProfile({ age: 58, experience: "beginner", daysPerWeek: 3, goal: "recomp", injuries: ["lower_back"] })],
  ["program-dumbbell-knees-6", baseProfile({ equipment: "dumbbell", injuries: ["knees"], daysPerWeek: 6, experience: "advanced" })],
];

function programFailures(program, profile) {
  if (!program) return ["the app couldn't use it (fell back to the generic program)"];
  const f = [];
  if (program.days.length !== Number(profile.daysPerWeek)) f.push(`${program.days.length} days, asked for ${profile.daysPerWeek}`);
  const terms = (profile.injuries || []).flatMap((i) => INJURY_EXCLUDES[i] || []).map((t) => t.toLowerCase());
  program.days.forEach((d) => {
    const names = d.exercises.map((e) => e.name);
    if (names.length < 3) f.push(`${d.name}: only ${names.length} exercises`);
    if (names.length > 9) f.push(`${d.name}: ${names.length} exercises`);
    const dupes = names.filter((n, i) => names.findIndex((m) => isSameCoreExercise(m, n)) !== i);
    if (dupes.length) f.push(`${d.name}: repeats ${dupes.join(", ")}`);
    if (profile.equipment === "dumbbell" || profile.equipment === "bodyweight") {
      const bad = names.filter((n) => !usesOnly(n, profile.equipment));
      if (bad.length) f.push(`${d.name}: needs other equipment: ${bad.join(", ")}`);
    }
    const hurt = names.filter((n) => terms.some((t) => n.toLowerCase().includes(t)));
    if (hurt.length) f.push(`${d.name}: loads an injury: ${hurt.join(", ")}`);
    const focus = dayFocusGroups(d.name);
    if (focus) {
      const off = names.filter((n) => { const g = inferMuscleGroup(n); return g && g !== "core" && !focus.has(g) && !(focus.has("back") && /rear delt|face pull|reverse fly/i.test(n)); });
      if (off.length > 1 && !/weak[- ]?point|accessor|arms|full|total/i.test(d.name)) f.push(`${d.name}: off-focus: ${off.join(", ")}`);
    }
    if (gentlePlan(profile)) {
      const heavy = d.exercises.filter((e) => Number(e.sets) > 3);
      if (heavy.length) f.push(`${d.name}: more than 3 sets for an under-18: ${heavy.map((e) => e.name).join(", ")}`);
    }
    d.exercises.forEach((e) => {
      if (!(Number(e.rest) >= 20 && Number(e.rest) <= 300)) f.push(`${e.name}: rest ${e.rest}`);
      if (!e.reps) f.push(`${e.name}: no reps`);
      if (!Array.isArray(e.tips) || e.tips.length === 0) f.push(`${e.name}: no tips`);
    });
  });
  return f;
}

// ---- 2. describe what you ate ---------------------------------------------------
const MEALS = [
  ["a bagel with cream cheese", [300, 550]],
  ["2 scrambled eggs and 2 slices of toast with butter", [350, 650]],
  ["big mac and medium fries", [850, 1250]],
  ["chipotle chicken burrito with rice, beans, cheese, sour cream and guac", [1000, 1600]],
  ["a banana", [80, 135]],
  ["protein shake, 1 scoop whey with 12oz whole milk", [250, 450]],
  ["hamburger wrap(hamburger ketchup mustard)", [350, 750]],
  ["3 slices of pepperoni pizza", [750, 1200]],
  ["greek yogurt with granola and blueberries", [200, 500]],
  ["chicken breast 6oz, 1 cup white rice, broccoli", [450, 700]],
  ["a large iced latte with oat milk", [120, 350]],
  ["food", [100, 1200]],
  ["2 tbsp peanut butter", [170, 220]],
  ["ramen cup noodles", [250, 450]],
];

// ---- 3. meal suggestions -------------------------------------------------------
const SUGGEST = [
  ["suggest-normal", baseProfile({ foodPrefs: "love chicken, rice, eggs and pasta" }), { cal: 1200, protein: 90, carb: 120, fat: 35 }, null],
  ["suggest-vegan", baseProfile({ diet: ["vegan"], foodPrefs: "love mexican food and smoothies" }), { cal: 900, protein: 60, carb: 100, fat: 30 }, /\b(chicken|beef|steak|pork|turkey|fish|salmon|tuna|shrimp|egg|eggs|whey|honey|bacon)\b|(?<!(almond|oat|soy|coconut|cashew|rice|vegan|plant|dairy-free|nut) )\b(milk|cheese|yogurt|butter)\b/i],
  ["suggest-vegetarian", baseProfile({ diet: ["vegetarian"], foodPrefs: "pizza and pasta" }), { cal: 1000, protein: 70, carb: 110, fat: 30 }, /\b(chicken|beef|steak|pork|turkey|fish|salmon|tuna|shrimp|bacon|ham|pepperoni|sausage|anchov)/i],
  ["suggest-halal", baseProfile({ diet: ["halal"], foodPrefs: "burgers" }), { cal: 1100, protein: 80, carb: 110, fat: 35 }, /\b(pork|bacon|ham|pepperoni|prosciutto|chorizo|beer|wine)\b/i],
  ["suggest-nut-allergy", baseProfile({ diet: ["nut_allergy"], foodPrefs: "smoothies and oats" }), { cal: 700, protein: 50, carb: 80, fat: 20 }, /\b(peanut|almond|cashew|walnut|pecan|pistachio|hazelnut|nut butter|nutella|macadamia)/i],
  ["suggest-gluten-free", baseProfile({ diet: ["gluten_free"], foodPrefs: "sandwiches" }), { cal: 800, protein: 60, carb: 80, fat: 25 }, /(?<!(gluten[- ]free|lettuce|gf)[- ])\b(bread|bagel|wrap|tortilla|pasta|noodle|toast|bun|pita|couscous|beer)\b/i],
  ["suggest-dairy-free", baseProfile({ diet: ["dairy_free"], foodPrefs: "pizza" }), { cal: 900, protein: 60, carb: 90, fat: 30 }, /(?<!(dairy[- ]free|vegan|oat|almond|coconut|soy|cashew|plant[- ]based|nut) )\b(cheese|milk|yogurt|whey|butter|cream)\b/i],
  ["suggest-small-snack", baseProfile(), { cal: 250, protein: 25, carb: 20, fat: 5 }, null],
  ["suggest-over-target", baseProfile(), { cal: -150, protein: 10, carb: -20, fat: -5 }, null],
];

// ---- 4. reviews ------------------------------------------------------------------
function reviewLogs(workouts, weights) {
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  return {
    workouts: Array.from({ length: workouts }, (_, i) => ({ date: day(1 + i), dayName: "Push", durationSec: 2700, exercises: [] })),
    bodyweight: weights.map((w, i) => ({ date: day(weights.length - i), weight: w })),
    nutrition: [],
  };
}
const REVIEWS = [
  ["review-good-week", "weekly", baseProfile(), reviewLogs(4, [180, 179.4])],
  ["review-no-workouts", "weekly", baseProfile({ goal: "lose" }), reviewLogs(0, [])],
  ["review-cut-month", "monthly", baseProfile({ goal: "lose", diet: ["vegetarian"], foodPrefs: "pasta" }), reviewLogs(14, [200, 197, 195])],
  ["review-minor", "weekly", baseProfile({ age: 15, weightLb: 130, goal: "build" }), reviewLogs(3, [130, 131])],
];

// ---- 5. exercise alternatives -------------------------------------------------------
const ALTS = [
  ["alt-bench-full", "Barbell Bench Press", "full", "", "chest"], // a weighted dip is a fair chest swap; checked by name below
  ["alt-pulldown-dumbbell", "Lat Pulldown", "dumbbell", "", "back"],
  ["alt-squat-knees", "Barbell Squat", "full", "knees", "legs"],
  ["alt-machine-lateral", "Machine Lateral Raise", "full", "", "shoulders"],
  ["alt-pushdown-bodyweight", "Tricep Pushdown", "bodyweight", "", "triceps"],
  ["alt-curl-full", "Barbell Curl", "full", "", "biceps"],
];

run("every AI feature, against the real model", () => {
  test("programs from the quiz", async () => {
    await Promise.all(PROFILES.map(([id, profile]) => check(id, `program: ${profile.daysPerWeek} days, ${profile.equipment}, ${profile.experience}, injuries ${profile.injuries.join("/")}, age ${profile.age}`, async () => {
      const { raw, accepted: program } = await generateProgramWithRetry(profile);
      return { failures: programFailures(program, profile), detail: program ? program.days.map((d) => `${d.name}: ${d.exercises.map((e) => `${e.name} ${e.sets}x${e.reps}`).join(", ")}`).join(" | ") : String(raw).slice(0, 600) };
    })));
  }, 600000);

  test("describe what you ate", async () => {
    await Promise.all(MEALS.map(([text, [lo, hi]], i) => check(`meal-${i}`, `describe: "${text}"`, async () => {
      const raw = await claudeChat({ system: MEAL_TEXT_SYSTEM, messages: [{ role: "user", content: text }] });
      const m = cleanAiMeal(parseJSONLoose(raw), mealNameFromDescription(text));
      return {
        failures: [
          (m.cal < lo || m.cal > hi) && `${m.cal} cal, expected ${lo}-${hi}`,
          m.cal > 0 && macroGap(m) > 0.25 && `macros don't add up (${4 * m.protein + 4 * m.carb + 9 * m.fat} vs ${m.cal} cal)`,
          (m.name === "Meal" || m.name.length > 45) && `name: "${m.name}"`,
        ],
        detail: `${m.name}: ${m.cal} cal P${m.protein} C${m.carb} F${m.fat} — ${m.note}`,
      };
    })));
  }, 300000);

  test("meal suggestions", async () => {
    await Promise.all(SUGGEST.map(([id, profile, remaining, banned]) => check(id, `suggestions: ${profile.diet.join("/") || "no diet"}, ${remaining.cal} cal left`, async () => {
      const raw = await claudeChat({ system: buildMealSuggestionSystem(), messages: [{ role: "user", content: mealSuggestionUserMessage(profile, remaining) }] });
      const list = mealSuggestionsFrom(parseJSONLoose(raw));
      const text = list.map((m) => `${m.name} ${m.note}`).join(" | ");
      const roomy = remaining.cal > 300;
      return {
        failures: [
          list.length === 0 && "no suggestions came back",
          list.length > 0 && list.length < 3 && `only ${list.length}`,
          banned && list.some((m) => banned.test(m.name)) && `breaks the diet: ${list.filter((m) => banned.test(m.name)).map((m) => m.name).join(", ")}`,
          roomy && list.some((m) => m.cal > remaining.cal * 1.2 + 50) && `over what's left: ${list.filter((m) => m.cal > remaining.cal * 1.2 + 50).map((m) => `${m.name} ${m.cal}`).join(", ")}`,
          !roomy && list.some((m) => m.cal > 400) && `too big when ${remaining.cal} cal are left: ${list.map((m) => m.cal).join(", ")}`,
          list.some((m) => m.cal >= 150 && macroGap(m) > 0.3) && "macros don't add up",
        ],
        detail: text || String(raw).slice(0, 500),
      };
    })));
  }, 300000);

  test("reviews", async () => {
    await Promise.all(REVIEWS.map(([id, cadence, profile, logs]) => check(id, `${cadence} review`, async () => {
      const periodStart = Date.now() - (cadence === "weekly" ? 7 : 30) * 86400000;
      const summary = summarizeReviewPeriod(logs, periodStart, Date.now());
      const raw = await claudeChat({ system: buildReviewSystem(profile, cadence, summary), messages: [{ role: "user", content: "Write my review now." }] });
      const r = reviewFromParsed(parseJSONLoose(raw));
      const overview = r.overview || "";
      const advice = r.advice;
      const all = `${overview} ${advice.join(" ")}`;
      return {
        failures: [
          !overview && "no overview",
          (advice.length < 2 || advice.length > 6) && `${advice.length} pieces of advice`,
          summary.workoutCount > 0 && !all.includes(String(summary.workoutCount)) && !/\d(\.\d)? (sessions|workouts)/i.test(all) && `doesn't mention how many workouts`,
          profile.diet.includes("vegetarian") && /\b(chicken|beef|steak|pork|turkey|fish|salmon|tuna)\b/i.test(all) && "meat advice to a vegetarian",
          /\b(I don't have|no data|can't see)\b/i.test(all) && summary.workoutCount > 0 && "claims it has no data",
        ],
        detail: all.slice(0, 700),
      };
    })));
  }, 300000);

  test("exercise alternatives", async () => {
    process.env.ANTHROPIC_API_KEY = KEY;
    process.env.SUPABASE_URL = "https://eval.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "eval";
    await Promise.all(ALTS.map(([id, name, equipment, injuries, group]) => check(id, `alternatives: ${name} (${equipment}${injuries ? `, ${injuries}` : ""})`, async () => {
      // Through the app's own fetchSimilarExercises, so its safety filter
      // (injuries, equipment) is part of what's tested.
      let alts = [], err = null;
      try { alts = await fetchSimilarExercises(name, equipment, injuries ? [injuries] : []); } catch (e) { err = e.message; }
      const res = { statusCode: err ? 500 : 200, body: { error: err } };
      const terms = injuries ? (INJURY_EXCLUDES[injuries] || []).map((t) => t.toLowerCase()) : [];
      return {
        failures: [
          res.statusCode !== 200 && `HTTP ${res.statusCode}: ${res.body?.error}`,
          res.statusCode === 200 && alts.length === 0 && "no alternatives",
          alts.some((a) => isSameCoreExercise(a, name)) && "suggested the same exercise",
          alts.filter((a) => inferMuscleGroup(a) && inferMuscleGroup(a) !== group && !(group === "chest" && /dip/i.test(a))).length > 0 && `different muscle: ${alts.filter((a) => inferMuscleGroup(a) && inferMuscleGroup(a) !== group).join(", ")}`,
          (equipment === "dumbbell" || equipment === "bodyweight") && alts.some((a) => !usesOnly(a, equipment)) && `needs other equipment: ${alts.filter((a) => !usesOnly(a, equipment)).join(", ")}`,
          terms.length && alts.some((a) => terms.some((t) => a.toLowerCase().includes(t))) && `loads the injury: ${alts.join(", ")}`,
        ],
        detail: alts.join(", ") || JSON.stringify(res.body).slice(0, 300),
      };
    })));
  }, 300000);
});

afterAll(() => {
  if (!KEY || results.length === 0) return;
  const passed = results.filter((r) => r.failures.length === 0).length;
  const lines = [
    `# AI features test — ${new Date().toISOString()}`,
    "",
    `**${passed}/${results.length} passed** · ${ledger.calls} AI calls · $${(ledger.cents / 100).toFixed(3)} spent`,
    "",
    ...results.map((r) => [
      `- ${r.failures.length ? "FAIL" : "pass"} **${r.id}** — ${r.what}`,
      ...r.failures.map((f) => `  - ${f}`),
      r.detail ? `  - got: ${r.detail.replace(/\n/g, " ")}` : null,
    ].filter(Boolean).join("\n")),
  ];
  mkdirSync("evals/results", { recursive: true });
  const file = `evals/results/features-${Date.now()}.md`;
  writeFileSync(file, lines.join("\n"));
  console.log(`\n${passed}/${results.length} passed · ${ledger.calls} AI calls · $${(ledger.cents / 100).toFixed(3)} spent\nFull report: ${file}`);
});
