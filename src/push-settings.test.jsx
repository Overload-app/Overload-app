// @vitest-environment jsdom
//
// The notification switches, on a browser that can't do push and on an
// iPhone that hasn't added the app to its Home Screen.
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

describe("notification switches", () => {
  beforeEach(() => {
    stored = storedState();
    try { localStorage.clear(); localStorage.setItem("overload_tester_unlocked", "1"); } catch (e) {}
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  });
  afterEach(() => vi.restoreAllMocks());

  test("a browser without push says so and stays off", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: /^You$/ }));
    const sw = screen.getByRole("switch", { name: /workout reminders/i });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await user.click(sw);
    expect(await screen.findByRole("alert")).toHaveTextContent(/doesn't support notifications/);
    expect(screen.getByRole("switch", { name: /workout reminders/i })).toHaveAttribute("aria-checked", "false");
    expect(stored.push?.reminders).toBeFalsy();
  }, 20000);

  test("an iPhone in Safari is told to add it to the Home Screen first", async () => {
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: /^You$/ }));
    await user.click(screen.getByRole("switch", { name: /rest alerts/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Add to Home Screen/);
    ua.mockRestore();
  }, 20000);

  test("turning one on saves this device and the time zone", async () => {
    const sub = { endpoint: "https://push.example/abc", keys: { p256dh: "x", auth: "y" } };
    const reg = { pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => ({ toJSON: () => sub })) } };
    Object.defineProperty(navigator, "serviceWorker", { value: { ready: Promise.resolve(reg) }, configurable: true });
    window.PushManager = function () {};
    window.Notification = { permission: "default", requestPermission: vi.fn(async () => "granted") };
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: /^You$/ }));
    await user.click(screen.getByRole("switch", { name: /workout reminders/i }));
    await screen.findByRole("switch", { name: /workout reminders/i, checked: true });
    expect(stored.push.reminders).toBe(true);
    expect(stored.push.subscriptions).toEqual([sub]);
    expect(typeof stored.push.tz).toBe("string");
    // The other switch turns on without asking again for a second device entry.
    await user.click(screen.getByRole("switch", { name: /rest alerts/i }));
    await screen.findByRole("switch", { name: /rest alerts/i, checked: true });
    expect(stored.push.subscriptions.length).toBe(1);
    delete navigator.serviceWorker; delete window.PushManager; delete window.Notification;
  }, 20000);

  test("with rest alerts on, checking off a set asks the server to buzz when rest ends", async () => {
    stored.push = { restAlerts: true, subscriptions: [{ endpoint: "https://push.example/abc" }], tz: "UTC" };
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: /^Train$/ }));
    await user.click(screen.getAllByText("Push")[0]);
    const before = Date.now();
    await user.click((await screen.findAllByLabelText(/Mark set 1 done/))[0]);
    const call = globalThis.fetch.mock.calls.find(([u]) => String(u).includes("/api/rest-alert"));
    expect(call).toBeTruthy();
    const body = JSON.parse(call[1].body);
    expect(body.endAt).toBeGreaterThan(before);
    expect(call[1].headers.Authorization).toBe("Bearer tok");
    // The saved workout carries the same end time the server will check.
    expect(stored.inProgressWorkout.rest.endAt).toBe(body.endAt);
  }, 20000);

  test("with rest alerts off, nothing is sent", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: /^Train$/ }));
    await user.click(screen.getAllByText("Push")[0]);
    await user.click((await screen.findAllByLabelText(/Mark set 1 done/))[0]);
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes("/api/rest-alert"))).toBe(false);
  }, 20000);
});
