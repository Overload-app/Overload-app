// @vitest-environment jsdom
//
// Real report, with a screenshot of the crash screen, and it locked the app's
// own owner out of their account: "this is what happens when i tried to reset
// and redo the quiz" — then "it's now stuck on the quiz screen when i reload."
//
// Root cause: with no state yet (a reset account, or any brand-new signup),
// onboarding's AI program generation reported its token usage through
// recordAiUsage -> persist -> updater(null) -> null.aiUsage. That TypeError was
// thrown during render, so the ErrorBoundary took over and nothing was saved.
//
// Every other test missed it for one reason: in tests the AI call fails, so the
// offline fallback runs and no usage is ever reported. This one makes the call
// SUCCEED, with a real usage block, which is the only way the bug shows.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const USER = { id: "u1", email: "t@example.com", user_metadata: { name: "Tester" } };

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
        // No saved state at all: exactly a just-reset or brand-new account.
        if (table === "app_state") return { data: null, error: null };
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

// A SUCCESSFUL program generation, including the usage block that triggered it.
function aiProgramResponse() {
  const ex = (name) => ({ name, sets: 3, reps: "8-12", rest: 75, tips: ["a", "b", "c", "d"], alternatives: ["x", "y", "z"] });
  return {
    ok: true,
    json: async () => ({
      content: [{
        type: "tool_use", name: "respond",
        input: { splitName: "Full Body", days: [
          { name: "Full Body A", exercises: [ex("Bench Press"), ex("Barbell Row"), ex("Barbell Squat"), ex("Plank")] },
          { name: "Full Body B", exercises: [ex("Overhead Press"), ex("Lat Pulldown"), ex("Romanian Deadlift"), ex("Leg Raise")] },
          { name: "Full Body C", exercises: [ex("Incline Dumbbell Press"), ex("Seated Cable Row"), ex("Leg Press"), ex("Cable Crunch")] },
        ] },
      }],
      usage: { input_tokens: 2400, output_tokens: 1800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }),
  };
}

const { default: App } = await import("./App.jsx");

async function walkQuiz(user) {
  await user.click(await screen.findByText("Start the quiz", {}, { timeout: 4000 }));
  await user.click(screen.getByText("Male"));
  await user.click(screen.getByText("Next"));
  await user.type(screen.getByPlaceholderText("e.g. 28"), "28");
  await user.click(screen.getByText("Next"));
  await user.click(screen.getByText("Next")); // height
  await user.type(screen.getByPlaceholderText("e.g. 165"), "180");
  await user.click(screen.getByText("Next"));
  await user.click(screen.getByText("Lose Fat"));
  await user.click(screen.getByText("Next"));
  await user.click(screen.getByText("Average build, some muscle"));
  await user.click(screen.getByText("Next"));
  await user.click(screen.getByText("Next")); // desiredPhysique
  await user.click(screen.getByText("Next")); // specificGoals
  await user.click(screen.getByText("Beginner (0-1 yr)"));
  await user.click(screen.getByText("Next"));
  await user.click(screen.getByText("Full Gym"));
  await user.click(screen.getByText("Next"));
  await user.click(screen.getByText("3 days"));
  await user.click(screen.getByText("Next"));
  await user.click(screen.getByText("~30 min"));
  await user.click(screen.getByText("Next"));
  await user.click(screen.getByText("Desk job, little walking"));
  await user.click(screen.getByText("Next"));
  await user.click(screen.getByText("None"));     // injuries
  await user.click(screen.getByText("Next"));
  await user.click(screen.getByText("Next"));     // notes
  await user.click(screen.getByText("Next"));     // food restrictions
  await user.click(screen.getByText("Next"));     // food preferences
  await user.click(screen.getByText("Build my plan"));
}

describe("finishing the quiz with no saved state (reset, or a brand-new signup)", () => {
  let fetchSpy;
  beforeEach(() => {
    try { localStorage.clear(); } catch (e) {}
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/claude")) return aiProgramResponse();
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });
  afterEach(() => fetchSpy.mockRestore());

  test("a successful AI program generation does not crash the app", async () => {
    const user = userEvent.setup();
    render(<App />);
    await walkQuiz(user);
    // It used to land on the crash screen here, every time.
    expect(await screen.findByText(/Let's go/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
    // And it really was the AI's program, not the offline fallback.
    expect(fetchSpy).toHaveBeenCalled();
  }, 20000);
});
