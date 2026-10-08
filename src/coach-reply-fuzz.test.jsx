// @vitest-environment jsdom
//
// The real Coach, end to end, fed every kind of bad or unusual AI reply I could
// think of. Most of the Coach bugs fixed before launch were the APP mishandling
// a reply — a double-encoded field, a day that doesn't exist, two changes at
// once — not the AI itself. For every case: the app must not crash, must not
// lose a single logged workout, meal or weigh-in, must leave the program in a
// shape the rest of the app can use, and must never claim a change that didn't
// happen.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const USER = { id: "u1", email: "t@example.com", user_metadata: { name: "Tester" } };
const ex = (name, extra = {}) => ({ name, sets: 3, reps: "8-12", rest: 90, tips: ["a", "b", "c", "d"], alternatives: [], ...extra });

function baseState() {
  return {
    profile: { sex: "male", age: 28, heightIn: 70, weightLb: 170, goal: "build", experience: "intermediate", equipment: "full", daysPerWeek: 4, sessionLength: 60, activity: "light", injuries: ["none"], otherInjuries: "", diet: [], otherDiet: "", foodPrefs: "", notes: "", currentPhysique: "average", desiredPhysique: "lean", specificGoals: "" },
    program: { splitName: "PPL", days: [
      { name: "Push (Chest/Triceps)", exercises: [ex("Barbell Bench Press"), ex("Cable Fly"), ex("Tricep Pushdown"), ex("Incline Dumbbell Press")] },
      { name: "Pull (Back/Biceps)", exercises: [ex("Lat Pulldown"), ex("Barbell Row"), ex("Barbell Curl"), ex("Face Pull")] },
      { name: "Legs", exercises: [ex("Barbell Squat"), ex("Romanian Deadlift"), ex("Leg Press"), ex("Leg Curl")] },
      { name: "Push (Shoulders/Chest Volume)", exercises: [ex("Overhead Press"), ex("Lateral Raise"), ex("Dumbbell Bench Press"), ex("Cable Fly")] },
    ] },
    targets: { calories: 2800, protein: 170, carbs: 330, fat: 78 },
    originalProgram: null, originalTargets: null,
    logs: {
      workouts: [{ date: "2026-10-01", dayName: "Push (Chest/Triceps)", durationSec: 2700, exercises: [{ name: "Barbell Bench Press", logged: [{ weight: "185", reps: "8", done: true }] }] }],
      nutrition: [{ date: "2026-10-01", meals: [{ name: "Chicken", cal: 500, protein: 45, carb: 40, fat: 12 }] }],
      bodyweight: [{ date: "2026-10-01", weight: 170 }],
    },
    reviews: { weekly: [], monthly: [] }, reviewsEnabled: { weekly: false, monthly: false },
    accountCreatedAt: "2026-09-01T00:00:00.000Z",
    coachChat: [{ role: "assistant", text: "Hey — I'm your coach." }],
    gifCache: {}, todayOverride: null, todayOverrideDayIdx: null, inProgressWorkout: null, programHistory: [],
  };
}

let stored;
vi.mock("./supabaseClient.js", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: USER, access_token: "tok" } } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(async () => ({})),
    },
    from: vi.fn((table) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => {
        if (table === "app_state") return { data: { state: stored }, error: null };
        if (table === "profiles") return { data: { id: "u1", name: "Tester", subscribed: true, trial_started_at: null }, error: null };
        return { data: null, error: null };
      }),
      insert: vi.fn(async () => ({ data: null, error: null })),
      upsert: vi.fn(async (row) => { if (row && "state" in row) stored = row.state; return { data: null, error: null }; }),
      update: vi.fn().mockReturnThis(),
    })),
  },
}));
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const toolReply = (input) => ({ ok: true, json: async () => ({ content: [{ type: "tool_use", name: "respond", input }], usage: { input_tokens: 100, output_tokens: 100 } }) });
const blank = { program: null, programDayEdit: null, todayOverride: null, targets: null, restoreIndex: null, restoreOriginal: false, overrideCeiling: false };
let nextResponse;

const { default: App } = await import("./App.jsx");

// Everything the rest of the app assumes about the saved state.
function shapeProblems(st, before) {
  const p = [];
  if (!st?.program?.days?.length) p.push("program has no days");
  (st?.program?.days || []).forEach((d, i) => {
    if (typeof d.name !== "string" || !d.name.trim()) p.push(`day ${i} has no name`);
    if (!Array.isArray(d.exercises)) { p.push(`day ${i} exercises is not a list`); return; }
    if (d.exercises.length === 0) p.push(`day ${i} has no exercises`);
    d.exercises.forEach((e, j) => {
      if (typeof e?.name !== "string" || !e.name.trim()) p.push(`day ${i} exercise ${j} has no name`);
      if (!(Number(e?.sets) >= 1)) p.push(`day ${i} "${e?.name}" has unusable sets: ${JSON.stringify(e?.sets)}`);
      if (!(Number(e?.rest) >= 0)) p.push(`day ${i} "${e?.name}" has unusable rest: ${JSON.stringify(e?.rest)}`);
      if (!Array.isArray(e?.tips)) p.push(`day ${i} "${e?.name}" tips is not a list`);
    });
  });
  if (st?.todayOverride != null) {
    if (!Array.isArray(st.todayOverride)) p.push("todayOverride is not a list");
    else st.todayOverride.forEach((e, j) => {
      if (typeof e?.name !== "string" || !e.name.trim()) p.push(`override exercise ${j} has no name`);
      if (!(Number(e?.sets) >= 1)) p.push(`override "${e?.name}" has unusable sets: ${JSON.stringify(e?.sets)}`);
    });
  }
  const t = st?.targets || {};
  if (![t.calories, t.protein, t.carbs, t.fat].every((n) => Number.isFinite(Number(n)))) p.push(`targets not numeric: ${JSON.stringify(t)}`);
  if (Number(t.calories) < 1500) p.push(`calories below the safe floor: ${t.calories}`);
  // Never, ever lose their own data.
  if (st?.logs?.workouts?.length !== before.logs.workouts.length) p.push("LOGGED WORKOUTS CHANGED");
  if (st?.logs?.nutrition?.[0]?.meals?.length !== before.logs.nutrition[0].meals.length) p.push("LOGGED MEALS CHANGED");
  if (st?.logs?.bodyweight?.length !== before.logs.bodyweight.length) p.push("LOGGED WEIGH-INS CHANGED");
  return p;
}

const CLAIMS_SUCCESS = /^(done|swapped|updated|changed|added|removed|saved|got it|fixed|all set)/i;

async function send(user, text, response) {
  nextResponse = response;
  render(<App />);
  await screen.findByRole("button", { name: /^Train$/ }, { timeout: 4000 });
  await user.click(screen.getByRole("button", { name: /^Coach$/ }));
  await user.type(screen.getByPlaceholderText("e.g. My shoulder hurts, adjust push day"), text + "{enter}");
  await waitFor(() => expect(screen.queryByLabelText("Coach is typing")).not.toBeInTheDocument(), { timeout: 6000 });
  const last = stored.coachChat[stored.coachChat.length - 1];
  return { reply: last?.role === "assistant" ? last.text : "", crashed: !!screen.queryByText("Something went wrong.") };
}

const CASES = [
  // [name, reply input (object) OR a full fetch response, expect: "change" | "no-change" | "either"]
  ["normal one-day edit", toolReply({ ...blank, reply: "Swapped it.", programDayEdit: { dayIndex: 2, day: { name: "Legs", exercises: [ex("Hack Squat"), ex("Romanian Deadlift"), ex("Leg Press"), ex("Leg Curl")] } } }), "change"],
  ["day edit sent as a JSON string", toolReply({ ...blank, reply: "Swapped it.", programDayEdit: JSON.stringify({ dayIndex: 2, day: { name: "Legs", exercises: [ex("Hack Squat"), ex("Leg Press"), ex("Leg Curl"), ex("Calf Raise")] } }) }), "change"],
  ["day edit as a TRUNCATED JSON string", toolReply({ ...blank, reply: "Swapped it.", programDayEdit: JSON.stringify({ dayIndex: 2, day: { name: "Legs", exercises: [ex("Hack Squat"), ex("Leg Press"), ex("Leg Curl"), ex("Calf Raise")] } }).slice(0, -1) }), "change"],
  ["day edit for a day that doesn't exist", toolReply({ ...blank, reply: "Done — updated it.", programDayEdit: { dayIndex: 9, day: { name: "Legs", exercises: [ex("Hack Squat")] } } }), "no-change"],
  ["day edit with an EMPTY exercise list", toolReply({ ...blank, reply: "Done — cleared it.", programDayEdit: { dayIndex: 2, day: { name: "Legs", exercises: [] } } }), "either"],
  ["exercise missing its name", toolReply({ ...blank, reply: "Updated.", programDayEdit: { dayIndex: 2, day: { name: "Legs", exercises: [ex("Barbell Squat"), { sets: 3, reps: "10", rest: 60 }, ex("Leg Curl"), ex("Leg Press")] } } }), "either"],
  ["sets/rest as words and nulls", toolReply({ ...blank, reply: "Updated.", programDayEdit: { dayIndex: 2, day: { name: "Legs", exercises: [ex("Barbell Squat", { sets: "three", rest: null }), ex("Leg Curl", { sets: null, rest: "ninety" }), ex("Leg Press", { sets: "4" }), ex("Calf Raise")] } } }), "change"],
  ["tips as a string instead of a list", toolReply({ ...blank, reply: "Updated.", programDayEdit: { dayIndex: 2, day: { name: "Legs", exercises: [ex("Barbell Squat", { tips: "keep your chest up" }), ex("Leg Curl"), ex("Leg Press"), ex("Calf Raise")] } } }), "change"],
  ["both a full program AND a day edit", toolReply({ ...blank, reply: "Rebuilt everything.", program: { splitName: "UL", days: [{ name: "Upper", exercises: [ex("Barbell Bench Press"), ex("Barbell Row"), ex("Overhead Press"), ex("Lat Pulldown")] }, { name: "Lower", exercises: [ex("Barbell Squat"), ex("Romanian Deadlift"), ex("Leg Press"), ex("Leg Curl")] }] }, programDayEdit: { dayIndex: 0, day: { name: "X", exercises: [ex("Push-Up")] } } }), "change"],
  ["a program with zero days", toolReply({ ...blank, reply: "Done — new program.", program: { splitName: "None", days: [] } }), "no-change"],
  ["a program whose days have no exercises", toolReply({ ...blank, reply: "Done — new program.", program: { splitName: "X", days: [{ name: "A", exercises: [] }, { name: "B" }] } }), "either"],
  ["one-time change with no day named", toolReply({ ...blank, reply: "Just for today.", todayOverride: [ex("Dumbbell Row"), ex("Dumbbell Curl"), ex("Dumbbell Pullover"), ex("Renegade Row")] }), "change"],
  ["one-time change for a day that doesn't exist", toolReply({ ...blank, reply: "Done — just for today.", todayOverride: [ex("Dumbbell Row")], todayOverrideDayIndex: 12 }), "no-change"],
  ["one-time change sent as an object, not a list", toolReply({ ...blank, reply: "Done — just for today.", todayOverride: { name: "Dumbbell Row", sets: 3 }, todayOverrideDayIndex: 1 }), "no-change"],
  ["one-time change with a broken exercise", toolReply({ ...blank, reply: "Just for today.", todayOverride: [ex("Dumbbell Row"), { name: "", sets: "x" }, ex("Dumbbell Curl"), ex("Dumbbell Pullover")], todayOverrideDayIndex: 1 }), "either"],
  ["targets as strings", toolReply({ ...blank, reply: "Bumped your calories.", targets: { calories: "3000", protein: "180", carbs: "350", fat: "85" } }), "change"],
  ["targets far below the safe floor", toolReply({ ...blank, reply: "Set you to 800 calories.", targets: { calories: 800, protein: 120, carbs: 40, fat: 20 } }), "either"],
  ["targets missing a field", toolReply({ ...blank, reply: "Bumped your calories.", targets: { calories: 3000, protein: 180 } }), "no-change"],
  ["absurd targets", toolReply({ ...blank, reply: "Done.", targets: { calories: 999999, protein: 99999, carbs: 1, fat: 1 } }), "either"],
  ["restore to a version that doesn't exist", toolReply({ ...blank, reply: "Done — reverted it.", restoreIndex: 7 }), "no-change"],
  // The app backfills an original on load for any account missing one, so
  // this is a real, successful restore — not a false "Done".
  ["restore original (always available after load)", toolReply({ ...blank, reply: "Done — back to your original.", restoreOriginal: true }), "either"],
  ["blank reply, no change", toolReply({ ...blank, reply: "" }), "no-change"],
  ["blank reply WITH a change", toolReply({ ...blank, reply: "", programDayEdit: { dayIndex: 2, day: { name: "Legs", exercises: [ex("Hack Squat"), ex("Leg Press"), ex("Leg Curl"), ex("Calf Raise")] } } }), "change"],
  ["prose instead of a tool call", { ok: true, json: async () => ({ content: [{ type: "text", text: "Hey! What would you like to work on today?" }], usage: { input_tokens: 10, output_tokens: 10 } }) }, "no-change"],
  ["HTTP 500", { ok: false, status: 500, json: async () => ({ error: { message: "Overloaded" } }) }, "no-change"],
  ["HTTP 429 rate limit", { ok: false, status: 429, json: async () => ({ error: { message: "rate_limit" } }) }, "no-change"],
  ["names with qualifiers and emoji", toolReply({ ...blank, reply: "Updated.", programDayEdit: { dayIndex: 2, day: { name: "Legs 🦵", exercises: [ex("Barbell Squat (High Bar)"), ex("Leg Press - Wide Stance"), ex("Leg Curl 🔥"), ex("Calf Raise")] } } }), "change"],
  ["a reply that's an object, not text", toolReply({ ...blank, reply: { text: "Done" } }), "no-change"],
  ["a reply that's a number", toolReply({ ...blank, reply: 42 }), "no-change"],
  ["a 40-exercise day", toolReply({ ...blank, reply: "Updated.", overrideCeiling: true, programDayEdit: { dayIndex: 2, day: { name: "Legs", exercises: Array.from({ length: 40 }, (_, i) => ex(`Leg Exercise ${i}`)) } } }), "change"],
];

describe("the Coach survives every kind of bad AI reply", () => {
  let fetchSpy;
  beforeEach(() => {
    stored = baseState();
    try { localStorage.clear(); localStorage.setItem("overload_tester_unlocked", "1"); } catch (e) {}
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/claude")) return nextResponse;
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });
  afterEach(() => fetchSpy.mockRestore());

  test("a too-low calorie target is raised to the safe floor, and the reply says so", async () => {
    const user = userEvent.setup();
    const { reply } = await send(user, "put me on 800 calories", toolReply({ ...blank, reply: "Set you to 800 calories.", targets: { calories: 800, protein: 120, carbs: 40, fat: 20 } }));
    expect(stored.targets.calories).toBe(1500);
    expect(reply).toContain("I kept calories at 1,500");
  }, 20000);

  test("absurd numbers are refused rather than shown on the Fuel screen", async () => {
    const user = userEvent.setup();
    const { reply } = await send(user, "change my calories", toolReply({ ...blank, reply: "Done.", targets: { calories: 999999, protein: 99999, carbs: 1, fat: 1 } }));
    expect(stored.targets.calories).toBe(2800);
    expect(reply).toMatch(/didn't actually go through/);
  }, 20000);

  test("a malformed exercise is cleaned up, not saved broken", async () => {
    const user = userEvent.setup();
    await send(user, "update legs", toolReply({ ...blank, reply: "Updated.", programDayEdit: { dayIndex: 2, day: { name: "Legs", exercises: [ex("Barbell Squat", { sets: "three", rest: null }), { sets: 3 }, ex("Leg Press", { sets: "4" }), ex("Calf Raise", { tips: "drive through the toes" })] } } }));
    const legs = stored.program.days[2].exercises;
    expect(legs.map((e) => e.name)).toEqual(["Barbell Squat", "Leg Press", "Calf Raise"]);
    expect(legs[0]).toMatchObject({ sets: 3, rest: 90 });
    expect(legs[1].sets).toBe(4);
    expect(legs[2].tips).toEqual(["drive through the toes"]);
  }, 20000);

  // Real ask: an Undo button on every Coach change.
  test("Undo puts the program back exactly, and marks the change as undone", async () => {
    const user = userEvent.setup();
    const before = baseState();
    await send(user, "swap squat for hack squat", toolReply({ ...blank, reply: "Swapped it.", programDayEdit: { dayIndex: 2, day: { name: "Legs", exercises: [ex("Hack Squat"), ex("Romanian Deadlift"), ex("Leg Press"), ex("Leg Curl")] } } }));
    expect(stored.program.days[2].exercises[0].name).toBe("Hack Squat");
    await user.click(screen.getByRole("button", { name: "Undo this change" }));
    expect(stored.program).toEqual(before.program);
    expect(stored.lastCoachChange).toBe(null);
    expect(screen.getByText("Undone")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo this change" })).not.toBeInTheDocument();
    // Their own logs are untouched by an undo too.
    expect(stored.logs).toEqual(before.logs);
  }, 20000);

  test("Undo also takes back a one-time workout and new calorie targets", async () => {
    const user = userEvent.setup();
    await send(user, "dumbbells only today, and more calories", toolReply({ ...blank, reply: "Done.", todayOverride: [ex("Dumbbell Row"), ex("Dumbbell Curl"), ex("Dumbbell Pullover"), ex("Renegade Row")], todayOverrideDayIndex: 1, targets: { calories: 3100, protein: 180, carbs: 380, fat: 85 } }));
    expect(stored.todayOverride).not.toBe(null);
    expect(stored.targets.calories).toBe(3100);
    await user.click(screen.getByRole("button", { name: "Undo this change" }));
    expect(stored.todayOverride).toBe(null);
    expect(stored.targets.calories).toBe(2800);
  }, 20000);

  test("a plain question offers no Undo — nothing changed", async () => {
    const user = userEvent.setup();
    await send(user, "how do I do an RDL", toolReply({ ...blank, reply: "Hinge at the hips, soft knees, bar close to your legs." }));
    expect(screen.queryByRole("button", { name: "Undo this change" })).not.toBeInTheDocument();
    expect(stored.lastCoachChange ?? null).toBe(null);
  }, 20000);

  // Found while testing: the meal review card saved a cleared box as "", and
  // an AI estimate can come back as text — and day totals are built with +,
  // so either turned a sum into stuck-together text ("0" + 500 -> "0500").
  test("a meal with a cleared box and text numbers is saved as real numbers", async () => {
    const user = userEvent.setup();
    nextResponse = toolReply({ name: "Bagel with cream cheese", cal: "450", protein: "12", carb: "60", fat: "16", note: "one standard bagel" });
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 4000 });
    await user.click(screen.getByRole("button", { name: /^Fuel$/ }));
    await user.click(screen.getByText("Describe"));
    await user.type(screen.getByPlaceholderText(/What did you eat/), "a bagel with cream cheese");
    await user.click(screen.getByText("Estimate"));
    await screen.findByText("Bagel with cream cheese");
    await user.clear(screen.getByLabelText("Fat (g)"));
    await user.click(screen.getByText("Add to log"));
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const meal = stored.logs.nutrition.find((d) => d.date === iso).meals.at(-1);
    expect(meal).toMatchObject({ name: "Bagel with cream cheese", cal: 450, protein: 12, carb: 60, fat: 0 });
    // And the rest of the app can still add it up.
    expect(screen.queryByText(/0450|450450/)).not.toBeInTheDocument();
  }, 20000);

  test("a saved review whose text is the wrong shape doesn't break the Progress tab", async () => {
    const user = userEvent.setup();
    stored.reviews = { weekly: [{ generatedAt: "2026-10-01T00:00:00.000Z", summary: { workoutCount: 3 }, overview: { text: "bad" }, advice: [{ tip: 1 }, "Sleep more."], seen: true }], monthly: [] };
    stored.reviewsEnabled = { weekly: false, monthly: false };
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 4000 });
    await user.click(screen.getByRole("button", { name: /^Progress$/ }));
    await user.click(screen.getByRole("button", { name: /^Expand weekly review/ }));
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
    expect(screen.getByText("Sleep more.")).toBeInTheDocument();
  }, 20000);

  test("a meal estimate with a non-text name doesn't break the Fuel tab", async () => {
    const user = userEvent.setup();
    nextResponse = toolReply({ name: { en: "Bagel" }, cal: 450, protein: 12, carb: 60, fat: 16, note: ["one", "bagel"] });
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 4000 });
    await user.click(screen.getByRole("button", { name: /^Fuel$/ }));
    await user.click(screen.getByText("Describe"));
    await user.type(screen.getByPlaceholderText(/What did you eat/), "a bagel");
    await user.click(screen.getByText("Estimate"));
    await screen.findByText("Add to log");
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
  }, 20000);

  // Real ask: gentler plans for under-18s unless they explicitly ask otherwise.
  test("a teen on the gentle plan is held at the teen calorie floor, and told why", async () => {
    const user = userEvent.setup();
    stored.profile = { ...stored.profile, age: 15 };
    const { reply } = await send(user, "put me on 1500 calories", toolReply({ ...blank, reply: "Set you to 1,500 calories.", targets: { calories: 1500, protein: 130, carbs: 160, fat: 45 } }));
    expect(stored.targets.calories).toBe(1800);
    expect(reply).toContain("I kept calories at 1,800");
  }, 20000);

  test("a teen who explicitly asks for the standard plan gets it, recorded, with the adult floor", async () => {
    const user = userEvent.setup();
    stored.profile = { ...stored.profile, age: 16 };
    await send(user, "I don't want the gentle plan, give me a normal one", toolReply({ ...blank, reply: "Switched you to the standard plan.", standardPlan: true, targets: { calories: 1600, protein: 150, carbs: 150, fat: 50 } }));
    expect(stored.profile.standardPlan).toBe(true);
    expect(stored.targets.calories).toBe(1600);
  }, 20000);

  test("an adult can't be switched onto or off a teen plan by the Coach", async () => {
    const user = userEvent.setup();
    await send(user, "hi", toolReply({ ...blank, reply: "Hey!", standardPlan: true }));
    expect(stored.profile.standardPlan).toBeUndefined();
  }, 20000);

  for (const [name, response, expectation] of CASES) {
    test(name, async () => {
      const before = baseState();
      const user = userEvent.setup();
      const { reply, crashed } = await send(user, "change something", response);
      expect(crashed).toBe(false);
      expect(shapeProblems(stored, before)).toEqual([]);
      const programChanged = JSON.stringify(stored.program) !== JSON.stringify(before.program);
      const anythingChanged = programChanged || stored.todayOverride != null || JSON.stringify(stored.targets) !== JSON.stringify(before.targets);
      if (expectation === "no-change") {
        expect(anythingChanged).toBe(false);
        // And it must not tell them it did.
        expect(reply).not.toMatch(CLAIMS_SUCCESS);
      }
      if (expectation === "change") expect(anythingChanged).toBe(true);
      expect(reply.trim().length).toBeGreaterThan(0);
    }, 20000);
  }
});
