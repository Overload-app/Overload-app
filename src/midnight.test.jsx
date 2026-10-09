// @vitest-environment jsdom
//
// Left open past midnight, the Fuel tab kept showing yesterday's meals as
// today's. It should roll over by itself.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const USER = { id: "u1", email: "t@example.com", user_metadata: { name: "Tester" } };
const ex = (name) => ({ name, sets: 3, reps: "8-12", rest: 75, tips: ["a", "b", "c", "d"], alternatives: [] });

function storedState() {
  return {
    profile: { sex: "male", age: 28, heightIn: 70, weightLb: 165, goal: "build", experience: "intermediate", equipment: "full", daysPerWeek: 5, sessionLength: 60, activity: "light", injuries: ["none"], otherInjuries: "", diet: [], otherDiet: "", foodPrefs: "", notes: "", currentPhysique: "average", desiredPhysique: "lean", specificGoals: "" },
    program: { splitName: "PPL", days: [
      { name: "Push (Chest/Triceps/Shoulders)", exercises: [ex("Barbell Bench Press"), ex("Cable Fly")] },
      { name: "Push (Shoulders/Chest Volume)", exercises: [ex("Overhead Press"), ex("Lateral Raise")] },
      { name: "Legs", exercises: [ex("Barbell Squat"), ex("Leg Curl")] },
      { name: "Upper", exercises: [ex("Barbell Row"), ex("Incline Bench Press")] },
      { name: "Pull (Back/Biceps + Conditioning)", exercises: [ex("Lat Pulldown"), ex("Barbell Curl")] },
    ] },
    targets: { calories: 2800, protein: 180, carbs: 300, fat: 80 },
    // Four workouts logged, so Pull (index 4) is next in the rotation.
    logs: { workouts: [0, 1, 2, 3].map((i) => ({ date: `2026-09-2${i}`, dayName: "x", durationSec: 1800, exercises: [] })), nutrition: [{ date: "2026-10-08", meals: [{ name: "Late Night Burrito", cal: 900, protein: 40, carb: 90, fat: 35 }] }], bodyweight: [{ date: "2026-09-20", weight: 165 }] },
    reviews: { weekly: [], monthly: [] }, reviewsEnabled: { weekly: false, monthly: false },
    accountCreatedAt: "2026-09-01T00:00:00.000Z",
    coachChat: [{ role: "assistant", text: "Hey — I'm your coach." }],
    gifCache: {}, todayOverride: null, inProgressWorkout: null, programHistory: [],
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
      upsert: vi.fn(async () => ({ data: null, error: null })),
      update: vi.fn().mockReturnThis(),
    })),
  },
}));
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: App } = await import("./App.jsx");

describe("the day turning over with the app open", () => {
  beforeEach(() => {
    stored = storedState();
    try { localStorage.clear(); localStorage.setItem("overload_tester_unlocked", "1"); } catch (e) {}
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  test("yesterday's meals leave the Fuel tab at midnight, without touching anything", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 9, 8, 23, 58));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 4000 });
    await user.click(screen.getByRole("button", { name: /^Fuel$/ }));
    expect(await screen.findByText("Late Night Burrito")).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(3 * 60 * 1000); });
    expect(screen.queryByText("Late Night Burrito")).not.toBeInTheDocument();
    // Still saved — it's yesterday's now, not gone.
    expect(stored.logs.nutrition[0].meals[0].name).toBe("Late Night Burrito");
  }, 20000);
});
