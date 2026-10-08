// @vitest-environment jsdom
//
// The money path. Trial maths and the AI budget were unit-tested on their
// own, but nothing checked that the app actually GATES on them: an expired,
// unsubscribed account must land on the paywall, not the app, and a trial
// account over its AI budget must be stopped before any request is made. A
// silent break here means people using the app free forever.
import { describe, test, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const USER = { id: "u1", email: "t@example.com", user_metadata: { name: "Tester" } };
let stored, profileRow;

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
        if (table === "profiles") return { data: profileRow, error: null };
        return { data: null, error: null };
      }),
      insert: vi.fn(async () => ({ data: null, error: null })),
      upsert: vi.fn(async (row) => { if (row && "state" in row) stored = row.state; return { data: null, error: null }; }),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    })),
  },
}));
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const ex = (name) => ({ name, sets: 3, reps: "8-12", rest: 90, tips: ["a"] });
function state(extra = {}) {
  return {
    profile: { sex: "male", age: 24, heightIn: 70, weightLb: 175, goal: "build", experience: "intermediate", equipment: "full", daysPerWeek: 3, sessionLength: 60, activity: "light", injuries: ["none"] },
    program: { splitName: "PPL", days: [{ name: "Push", exercises: [ex("Bench Press")] }, { name: "Pull", exercises: [ex("Barbell Row")] }, { name: "Legs", exercises: [ex("Squat")] }] },
    targets: { calories: 2800, protein: 175, carbs: 330, fat: 78 },
    logs: { workouts: [], nutrition: [], bodyweight: [] },
    reviews: { weekly: [], monthly: [] }, reviewsEnabled: { weekly: false, monthly: false },
    coachChat: [{ role: "assistant", text: "Hey" }], programHistory: [], gifCache: {},
    accountCreatedAt: "2026-09-01T00:00:00.000Z",
    ...extra,
  };
}
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const { default: App } = await import("./App.jsx");

describe("who gets in", () => {
  let fetchSpy;
  beforeEach(() => {
    stored = state();
    try { localStorage.clear(); localStorage.setItem("overload_tester_unlocked", "1"); } catch (e) {}
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  });

  test("a subscriber gets the app", async () => {
    profileRow = { id: "u1", name: "Tester", subscribed: true, trial_started_at: null };
    render(<App />);
    expect(await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 })).toBeInTheDocument();
  });

  test("someone two days into the 7-day trial gets the app", async () => {
    profileRow = { id: "u1", name: "Tester", subscribed: false, trial_started_at: daysAgo(2) };
    render(<App />);
    expect(await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 })).toBeInTheDocument();
  });

  test("an expired trial with no subscription gets the paywall, not the app", async () => {
    profileRow = { id: "u1", name: "Tester", subscribed: false, trial_started_at: daysAgo(8) };
    render(<App />);
    expect(await screen.findByText("Your trial has ended", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Train$/ })).not.toBeInTheDocument();
  });

  test("someone who never started a trial gets the paywall with the trial offer", async () => {
    profileRow = { id: "u1", name: "Tester", subscribed: false, trial_started_at: null };
    render(<App />);
    expect(await screen.findByText("Unlock your plan", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Train$/ })).not.toBeInTheDocument();
  });

  test("a trial account over its AI budget is stopped before any AI request is made", async () => {
    profileRow = { id: "u1", name: "Tester", subscribed: false, trial_started_at: daysAgo(2) };
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    stored = state({ aiUsage: { day: iso, dailyCostCents: 999, month: iso.slice(0, 7), monthlyCostCents: 999 } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^Train$/ }, { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: /^Coach$/ }));
    await user.type(screen.getByPlaceholderText("e.g. My shoulder hurts, adjust push day"), "hi{enter}");
    await waitFor(() => expect(screen.queryByLabelText("Coach is typing")).not.toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText(/used up this trial's AI limit/)).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/api/claude"))).toBe(false);
  });
});
