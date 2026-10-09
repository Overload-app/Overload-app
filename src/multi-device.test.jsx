// @vitest-environment jsdom
//
// Two devices, one account. A phone that kept the app paused in the
// background must pick up what another device saved, not save its old copy
// over it.
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
let upsertGate = null;
let readGate = null;
let storedAt;
let upserts;
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
        if (table === "app_state") { const snap = { state: stored, updated_at: storedAt }; if (readGate) await readGate; return { data: snap, error: null }; }
        if (table === "profiles") return { data: { id: "u1", name: "Tester", subscribed: true, trial_started_at: null }, error: null };
        return { data: null, error: null };
      }),
      insert: vi.fn(async () => ({ data: null, error: null })),
      upsert: vi.fn(async (row) => { upserts.push(row); if (upsertGate) await upsertGate; stored = row.state; storedAt = row.updated_at; return { data: null, error: null }; }),
      update: vi.fn().mockReturnThis(),
    })),
  },
}));
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: App, fetchNewerState, saveState } = await import("./App.jsx");

const comeBackToFront = async () => {
  await act(async () => { window.dispatchEvent(new Event("focus")); await new Promise((r) => setTimeout(r, 50)); });
};

describe("another device saved while this one was in the background", () => {
  beforeEach(() => {
    stored = storedState();
    stored.logs.nutrition = [];
    storedAt = "2026-10-08T10:00:00.000+00:00";
    upserts = [];
    upsertGate = null;
    readGate = null;
    try { localStorage.clear(); localStorage.setItem("overload_tester_unlocked", "1"); } catch (e) {}
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  test("coming back to the front picks up the other device's meal, and the next save keeps it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 4000 });
    await user.click(screen.getByRole("button", { name: /^Fuel$/ }));

    // Meanwhile, on the laptop:
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    stored = { ...stored, logs: { ...stored.logs, nutrition: [{ date: iso, meals: [{ name: "Laptop Lunch", cal: 600, protein: 40, carb: 50, fat: 20 }] }] } };
    storedAt = "2026-10-08T12:00:00.000+00:00";

    await comeBackToFront();
    expect(await screen.findByText("Laptop Lunch")).toBeInTheDocument();
  }, 20000);

  test("nothing changes when the saved version is the one this device already has", async () => {
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 4000 });
    expect(await fetchNewerState(USER.id)).toBeNull();
  }, 20000);

  test("a save made on this device while it was asking is never replaced by an older copy", async () => {
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 4000 });
    // Server answers with a different version, but this device saves
    // something while the question is in flight.
    const older = stored;
    storedAt = "2026-10-08T09:00:00.000+00:00";
    let answer;
    readGate = new Promise((r) => { answer = r; });
    const asking = fetchNewerState(USER.id);
    await saveState(USER.id, { ...older, marker: "mine" }); // fully saved before the old answer arrives
    answer();
    expect(await asking).toBeNull();
  }, 20000);

  test("unsaved changes on this device always win", async () => {
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 4000 });
    let release;
    upsertGate = new Promise((r) => { release = r; });
    const saving = saveState(USER.id, { ...stored, marker: "mine" });
    storedAt = "2026-10-08T13:00:00.000+00:00";
    expect(await fetchNewerState(USER.id)).toBeNull();
    release();
    await saving;
  }, 20000);
});
