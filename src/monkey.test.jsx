// @vitest-environment jsdom
//
// Monkey test: hundreds of random taps and junk typing across every tab, with
// the AI unreachable. The app must never show the crash screen, and nothing a
// person logged may ever shrink — destructive buttons (delete, reset,
// discard...) are left alone, so any drop is a real loss.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const USER = { id: "u1", email: "t@example.com", user_metadata: { name: "Tester" } };
const ex = (name) => ({ name, sets: 3, reps: "8-12", rest: 75, tips: ["a", "b", "c", "d"], alternatives: [] });

function storedState() {
  const ex = (name) => ({ name, sets: 3, reps: "8-12", rest: 75, tips: ["a", "b", "c", "d"], alternatives: ["Dumbbell Row"] });
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const daysAgo = (n) => iso(new Date(today.getTime() - n * 86400000));
  return {
    profile: { sex: "male", age: 24, heightIn: 70, weightLb: 175, goal: "build", experience: "intermediate", equipment: "full", daysPerWeek: 3, sessionLength: 60, activity: "light", injuries: ["none"], otherInjuries: "", diet: ["vegetarian"], otherDiet: "", foodPrefs: "pasta", notes: "", currentPhysique: "average", desiredPhysique: "lean", specificGoals: "" },
    program: { splitName: "PPL", days: [
      { name: "Push", exercises: [ex("Barbell Bench Press"), ex("Overhead Press"), ex("Lateral Raise"), ex("Tricep Pushdown")] },
      { name: "Pull", exercises: [ex("Lat Pulldown"), ex("Barbell Row"), ex("Face Pull"), ex("Barbell Curl")] },
      { name: "Legs", exercises: [ex("Barbell Squat"), ex("Romanian Deadlift"), ex("Leg Press"), ex("Leg Curl")] },
    ] },
    targets: { calories: 2800, protein: 175, carbs: 320, fat: 80 },
    logs: {
      workouts: [3, 2, 1].map((n, i) => ({ date: daysAgo(n), dayName: ["Push", "Pull", "Legs"][i], durationSec: 2700, exercises: [{ name: "Barbell Bench Press", sets: 3, reps: "8-12", rest: 75, logged: [{ weight: "135", reps: "8", done: true }] }] })),
      nutrition: [{ date: daysAgo(0), meals: [{ name: "Oats", cal: 400, protein: 20, carb: 60, fat: 8 }] }, { date: daysAgo(1), meals: [{ name: "Pasta", cal: 700, protein: 30, carb: 100, fat: 15 }] }],
      bodyweight: [{ date: daysAgo(5), weight: 176 }, { date: daysAgo(1), weight: 175 }],
    },
    reviews: { weekly: [{ generatedAt: new Date().toISOString(), periodStart: daysAgo(7), periodEnd: daysAgo(0), overview: "Good week", advice: ["Keep going"] }], monthly: [] },
    reviewsEnabled: { weekly: true, monthly: false },
    accountCreatedAt: "2026-09-01T00:00:00.000Z",
    coachChat: [{ role: "assistant", text: "Hey — I'm your coach." }],
    gifCache: {}, todayOverride: null, inProgressWorkout: null, programHistory: [],
    originalProgram: null,
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
      upsert: vi.fn(async (row) => { if (table === "app_state") stored = row.state; return { data: null, error: null }; }),
      update: vi.fn().mockReturnThis(),
    })),
  },
}));
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: App, ErrorBoundary } = await import("./App.jsx");

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const DESTRUCTIVE = /delete|remove|reset|discard|sign ?out|log ?out|clear|undo|trash|cancel|manage subscription|retake|^×$|^x$/i;
const JUNK = ["", "0", "-5", "99999", "1e9", "abc", "  ", "🍕🍕", "<script>", "135", "8", "NaN", "Infinity", "12.5.3", "'; drop table", "a".repeat(300)];
const counts = (st) => ({
  workouts: st?.logs?.workouts?.length ?? 0,
  meals: (st?.logs?.nutrition || []).reduce((n, d) => n + (d.meals?.length || 0), 0),
  weighIns: st?.logs?.bodyweight?.length ?? 0,
  days: st?.program?.days?.length ?? 0,
});

describe("monkey test", () => {
  beforeEach(() => {
    stored = storedState();
    try { localStorage.clear(); localStorage.setItem("overload_tester_unlocked", "1"); } catch (e) {}
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({ error: "down" }) }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    window.open = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    window.scrollTo = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  for (const seed of [1, 7, 42, 1234, 99]) {
    test(`seed ${seed}: 250 random actions, no crash, nothing lost`, async () => {
      const rand = rng(seed);
      const pick = (arr) => arr[Math.floor(rand() * arr.length)];
      const user = userEvent.setup({ delay: null });
      render(<ErrorBoundary><App /></ErrorBoundary>);
      await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
      const start = counts(stored);
      const log = [];
      for (let step = 0; step < 250; step++) {
        const buttons = screen.queryAllByRole("button").filter((b) => !b.disabled && !DESTRUCTIVE.test(`${b.textContent} ${b.getAttribute("aria-label") || ""}`));
        const inputs = [...document.querySelectorAll("input:not([type=file]):not([type=checkbox]), textarea")].filter((i) => !i.disabled);
        const r = rand();
        try {
          if (r < 0.7 && buttons.length) {
            const b = pick(buttons);
            log.push(`click "${(b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 40)}"`);
            await user.click(b);
          } else if (inputs.length) {
            const i = pick(inputs);
            const junk = pick(JUNK);
            log.push(`type "${junk.slice(0, 20)}" into ${i.placeholder || i.getAttribute("aria-label") || i.type}`);
            await user.clear(i).catch(() => {});
            if (junk) await user.type(i, junk);
            if (rand() < 0.4) await user.keyboard("{Enter}");
          }
        } catch (e) {
          // An element that vanished between finding and clicking is fine.
        }
        await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
        if (screen.queryByText("Something went wrong.")) {
          throw new Error(`crash screen after: ${log.slice(-8).join(" | ")}`);
        }
        const now = counts(stored);
        for (const k of ["workouts", "meals", "weighIns"]) {
          if (now[k] < start[k]) throw new Error(`${k} shrank ${start[k]} -> ${now[k]} after: ${log.slice(-8).join(" | ")}`);
        }
        if (now.days === 0) throw new Error(`program lost its days after: ${log.slice(-8).join(" | ")}`);
      }
      if (process.env.MONKEY_REPORT) (await import("node:fs")).appendFileSync(process.env.MONKEY_REPORT, `seed ${seed} visited: ` + [...new Set(log.filter((l) => l.startsWith("click")).map((l) => l.slice(7, 30)))].join(" / ") + "\n");
    }, 120000);
  }

  // A brand-new account: no saved state at all, so the quiz and onboarding
  // run with the AI unreachable.
  for (const seed of [3, 11, 77]) {
    test(`new account, seed ${seed}: 300 random actions through the quiz and onboarding`, async () => {
      stored = null;
      const rand = rng(seed);
      const pick = (arr) => arr[Math.floor(rand() * arr.length)];
      const user = userEvent.setup({ delay: null });
      render(<ErrorBoundary><App /></ErrorBoundary>);
      await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
      const log = [];
      for (let step = 0; step < 300; step++) {
        const buttons = screen.queryAllByRole("button").filter((b) => !b.disabled && !DESTRUCTIVE.test(`${b.textContent} ${b.getAttribute("aria-label") || ""}`) && (rand() < 0.15 || b.getAttribute("aria-label") !== "Back"));
        const inputs = [...document.querySelectorAll("input:not([type=file]):not([type=checkbox]), textarea")].filter((i) => !i.disabled && !i.value);
        try {
          if ((rand() < 0.65 || !inputs.length) && buttons.length) {
            const b = pick(buttons);
            log.push(`click "${(b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 40)}"`);
            await user.click(b);
          } else if (inputs.length) {
            const i = pick(inputs);
            const junk = rand() < 0.7 ? pick(["17", "16", "180", "70", "25", "150"]) : pick(JUNK);
            log.push(`type "${junk.slice(0, 20)}" into ${i.placeholder || i.getAttribute("aria-label") || i.type}`);
            await user.clear(i).catch(() => {});
            if (junk) await user.type(i, junk);
          }
        } catch (e) {}
        await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
        if (screen.queryByText("Something went wrong.")) throw new Error(`crash screen after: ${log.slice(-10).join(" | ")}`);
        if (stored && stored.program && (!stored.program.days || stored.program.days.length === 0)) throw new Error(`saved a program with no days after: ${log.slice(-10).join(" | ")}`);
        if (stored && stored.targets && !(stored.targets.calories > 0)) throw new Error(`saved bad targets after: ${log.slice(-10).join(" | ")}`);
        if (stored?.targets && stored?.profile) {
          const age = Number(stored.profile.age);
          const minor = age > 0 && age < 18 && stored.profile.standardPlan !== true;
          const floor = minor ? (stored.profile.sex === "male" ? 1800 : 1600) : (stored.profile.sex === "male" ? 1500 : 1200);
          if (stored.targets.calories < floor) throw new Error(`calories ${stored.targets.calories} under the ${floor} floor for age ${age} ${stored.profile.sex}`);
        }
      }
      if (process.env.MONKEY_REPORT) (await import("node:fs")).appendFileSync(process.env.MONKEY_REPORT, `new ${seed}: program=${!!stored?.program} days=${stored?.program?.days?.length} cal=${stored?.targets?.calories} age=${stored?.profile?.age} sex=${stored?.profile?.sex} goal=${stored?.profile?.goal} wt=${stored?.profile?.weightLb} last=${log.slice(-5).join(" | ")}\n`);
    }, 120000);
  }
});
