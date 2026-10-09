// @vitest-environment jsdom
//
// A meal or weigh-in deleted with one tap can be brought straight back.
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

describe("Undo after a one-tap delete", () => {
  beforeEach(() => {
    stored = storedState();
    try { localStorage.clear(); localStorage.setItem("overload_tester_unlocked", "1"); } catch (e) {}
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  });
  afterEach(() => vi.restoreAllMocks());

  test("a deleted meal comes back", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: /^Fuel$/ }));
    await user.click(screen.getByRole("button", { name: "Delete Oats" }));
    expect(screen.queryByText("Oats")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Removed Oats");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Oats")).toBeInTheDocument();
    const todays = stored.logs.nutrition.find((d) => d.meals.some((m) => m.name === "Oats"));
    expect(todays.meals.filter((m) => m.name === "Oats").length).toBe(1);
  }, 20000);

  test("a deleted weigh-in comes back in the same place", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: /^Progress$/ }));
    const before = stored.logs.bodyweight.map((w) => w.weight);
    await user.click(screen.getAllByRole("button", { name: "Delete weigh-in" })[1]);
    expect(stored.logs.bodyweight.length).toBe(1);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(stored.logs.bodyweight.map((w) => w.weight)).toEqual(before);
  }, 20000);
});
