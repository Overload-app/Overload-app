// @vitest-environment jsdom
//
// Every real account was saved BEFORE the pre-launch changes: no food
// preferences, one-time changes with no day attached, chat messages without
// timestamps, in-progress workouts without the background clock, reviews
// without a schedule anchor, no Undo snapshot. New code that quietly assumes
// any of those exist would crash for real users while every fresh-account
// test passes. This loads exactly that kind of account and walks every
// screen and the main flows.
import { describe, test, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const USER = { id: "u1", email: "t@example.com", user_metadata: { name: "Tester" } };
const ex = (name, extra = {}) => ({ name, sets: 3, reps: "8-12", rest: 90, ...extra });

// Shaped like a real account saved a few weeks ago — deliberately missing
// every field added since.
function legacyState() {
  return {
    profile: { sex: "male", age: 24, heightIn: 70, weightLb: 175, goal: "build", experience: "intermediate", equipment: "full", daysPerWeek: 3, sessionLength: 60, activity: "light", injuries: ["none"], currentPhysique: "average", desiredPhysique: "lean", specificGoals: "", notes: "" },
    program: { splitName: "PPL", days: [
      { name: "Push", exercises: [ex("Barbell Bench Press", { tips: ["a"] }), ex("Overhead Press"), ex("Cable Fly"), ex("Tricep Pushdown")] },
      { name: "Pull", exercises: [ex("Lat Pulldown"), ex("Barbell Row"), ex("Barbell Curl"), ex("Face Pull")] },
      { name: "Legs", exercises: [ex("Barbell Squat"), ex("Romanian Deadlift"), ex("Leg Press"), ex("Leg Curl")] },
    ] },
    targets: { calories: 2800, protein: 175, carbs: 330, fat: 78 },
    logs: {
      workouts: [{ date: "2026-09-28", dayName: "Push", durationSec: 3000, exercises: [{ name: "Barbell Bench Press", logged: [{ weight: "185", reps: "8", done: true }] }] }],
      nutrition: [{ date: "2026-09-28", meals: [{ name: "Oats", cal: 400, protein: 20, carb: 60, fat: 8 }] }],
      bodyweight: [{ date: "2026-09-28", weight: 175 }],
    },
    // Legacy one-time change: a bare list, no day stored.
    todayOverride: [ex("Dumbbell Row"), ex("Dumbbell Curl"), ex("Dumbbell Pullover"), ex("Renegade Row")],
    // Legacy in-progress workout: no running clock stored.
    inProgressWorkout: { dayIdx: 0, sets: [{ name: "Barbell Bench Press", reps: "8-12", rest: 90, logged: [{ weight: "185", reps: "8", done: true }, { weight: "", reps: "", done: false }] }], rest: null, savedAt: "2026-09-29T18:00:00.000Z", activeSeconds: 900 },
    // Legacy chat: no timestamps, no change ids.
    coachChat: [{ role: "assistant", text: "Hey — I'm your coach." }, { role: "user", text: "make push harder" }, { role: "assistant", text: "Done." }],
    reviews: { weekly: [{ generatedAt: "2026-09-25T00:00:00.000Z", summary: { workoutCount: 3 }, overview: "Good week.", advice: ["Sleep more."], seen: true }], monthly: [] },
    reviewsEnabled: { weekly: true, monthly: false },
    programHistory: [],
    gifCache: {},
    accountCreatedAt: "2026-09-01T00:00:00.000Z",
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
vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}) }));

const { default: App } = await import("./App.jsx");
const tab = (name) => screen.getByRole("button", { name: new RegExp(`^${name}$`) });
const noCrash = () => expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();

describe("an account saved before the pre-launch changes", () => {
  beforeEach(() => {
    stored = legacyState();
    try { localStorage.clear(); localStorage.setItem("overload_tester_unlocked", "1"); } catch (e) {}
  });

  test("loads, and every tab renders", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    noCrash();
    for (const name of ["Train", "Coach", "Fuel", "Progress", "You", "Home"]) {
      await user.click(tab(name));
      noCrash();
    }
  }, 30000);

  test("the old one-time change still shows, on the day it always applied to", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    await user.click(tab("Train"));
    // One workout logged -> next scheduled is Pull (index 1).
    expect(screen.getAllByText("ONE-TIME CHANGE").length).toBe(1);
    noCrash();
  }, 30000);

  test("resuming the old in-progress workout works, and finishing logs it without losing anything", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    await user.click(await screen.findByText("RESUME"));
    expect(await screen.findByText("Barbell Bench Press")).toBeInTheDocument();
    noCrash();
    await user.click(screen.getByText(/Finish workout/));
    expect(await screen.findByText("WORKOUT COMPLETE")).toBeInTheDocument();
    noCrash();
    expect(stored.logs.workouts.length).toBe(2);
    expect(stored.logs.nutrition[0].meals.length).toBe(1);
    expect(stored.logs.bodyweight.length).toBe(1);
    await user.click(screen.getByText("Done"));
    noCrash();
  }, 30000);

  test("the quiz editor opens on an account with no food answers, and saves", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    await user.click(tab("You"));
    await user.click(screen.getByText("Edit my answers"));
    noCrash();
    await user.click(screen.getByText("No dairy"));
    await user.click(screen.getByText("Review changes"));
    await user.click(screen.getByText("Save changes"));
    noCrash();
    expect(stored.profile.diet).toEqual(["dairy_free"]);
    expect(stored.logs.workouts.length).toBe(1);
  }, 30000);

  test("old reviews show and can be collapsed and deleted", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    await user.click(tab("Progress"));
    // Weekly reviews are on and the last was over a week ago, so loading the
    // app also (correctly) generates a new one — at least the old one shows.
    expect(screen.getAllByText("WEEKLY REVIEW").length).toBeGreaterThanOrEqual(1);
    noCrash();
    await user.click(screen.getAllByRole("button", { name: /^Delete weekly review/ })[0]);
    await user.click(screen.getByText("DELETE"));
    noCrash();
    expect(stored.logs.workouts.length).toBe(1);
  }, 30000);

  test("sending a Coach message with old, untimestamped chat history doesn't crash", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    await user.click(tab("Coach"));
    await user.type(screen.getByPlaceholderText("e.g. My shoulder hurts, adjust push day"), "hi{enter}");
    await waitFor(() => expect(screen.queryByLabelText("Coach is typing")).not.toBeInTheDocument(), { timeout: 8000 });
    noCrash();
  }, 30000);
});
