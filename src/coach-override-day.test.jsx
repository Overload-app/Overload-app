// @vitest-environment jsdom
//
// Real report, a whole conversation of it: "make my push day full dumbbells and
// only 30 mins for today only" — five replies saying it was done, and it never
// went on Push. Every time it landed on PULL, the next day in the rotation, and
// Pull's title changed to "Chest/Shoulders Day" once the workout started.
//
// This drives the real Coach end to end with a SUCCESSFUL AI reply (the only way
// this path runs at all — in tests fetch otherwise fails and nothing is applied)
// and checks where the change actually lands.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
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
    logs: { workouts: [0, 1, 2, 3].map((i) => ({ date: `2026-09-2${i}`, dayName: "x", durationSec: 1800, exercises: [] })), nutrition: [], bodyweight: [{ date: "2026-09-20", weight: 165 }] },
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

// The Coach's SUCCESSFUL reply: a one-time dumbbell session, for dayIndex 1.
function coachReply() {
  return {
    ok: true,
    json: async () => ({
      content: [{
        type: "tool_use", name: "respond",
        input: {
          reply: "Done — your next Push (Shoulders/Chest Volume) is a 30-minute dumbbell session.",
          program: null, programDayEdit: null,
          todayOverride: [ex("Dumbbell Shoulder Press"), ex("Dumbbell Bench Press"), ex("Dumbbell Lateral Raise"), ex("Dumbbell Fly")],
          todayOverrideDayIndex: 1,
          targets: null, restoreIndex: null, restoreOriginal: false, overrideCeiling: false,
        },
      }],
      usage: { input_tokens: 1500, output_tokens: 400, cache_read_input_tokens: 8000, cache_creation_input_tokens: 0 },
    }),
  };
}

const { default: App } = await import("./App.jsx");

describe("a one-time change asked for on a day that isn't next", () => {
  let fetchSpy;
  beforeEach(() => {
    stored = storedState();
    try { localStorage.clear(); localStorage.setItem("overload_tester_unlocked", "1"); } catch (e) {}
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/claude")) return coachReply();
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });
  afterEach(() => fetchSpy.mockRestore());


  test("it lands on Push, and the confirmation names Push — not Pull", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 4000 });
    await user.click(screen.getByRole("button", { name: /^Coach$/ }));
    const input = screen.getByPlaceholderText("e.g. My shoulder hurts, adjust push day");
    await user.type(input, "make push shoulder/volume all dumbbells and 30 mins for today{enter}");

    // The app's own record of where it went.
    expect(await screen.findByText(/Just for your next Push \(Shoulders\/Chest Volume\) workout/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalled();

    // And on the Train tab, the marker sits on Push — not on Pull.
    await user.click(screen.getByRole("button", { name: /^Train$/ }));
    const pushCard = screen.getByText("Push (Shoulders/Chest Volume)").closest("[style]").parentElement.parentElement;
    const pullCard = screen.getByText("Pull (Back/Biceps + Conditioning)").closest("[style]").parentElement.parentElement;
    expect(within(pushCard).getByText("ONE-TIME CHANGE")).toBeInTheDocument();
    expect(within(pushCard).getByText(/Dumbbell Shoulder Press/)).toBeInTheDocument();
    expect(within(pullCard).queryByText("ONE-TIME CHANGE")).not.toBeInTheDocument();
    // Pull still shows its own real exercises.
    expect(within(pullCard).getByText(/Lat Pulldown/)).toBeInTheDocument();
  }, 20000);

  // The exact symptom: "when i go into pull, the name at the top changes once i
  // start the workout to chest/shoulders day, and it is my 30 min dumbbell workout".
  test("starting Pull gives you Pull — its own name and its own exercises", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 4000 });
    await user.click(screen.getByRole("button", { name: /^Coach$/ }));
    await user.type(screen.getByPlaceholderText("e.g. My shoulder hurts, adjust push day"), "make push shoulder/volume all dumbbells and 30 mins for today{enter}");
    await screen.findByText(/Done — your next Push/, {}, { timeout: 4000 });

    await user.click(screen.getByRole("button", { name: /^Train$/ }));
    await user.click(screen.getByText("Pull (Back/Biceps + Conditioning)"));

    expect(await screen.findByText("Lat Pulldown", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText("Dumbbell Shoulder Press")).not.toBeInTheDocument();
    expect(screen.queryByText(/Chest\/Shoulders Day|Shoulders\/Chest Day/)).not.toBeInTheDocument();
  }, 20000);
});
