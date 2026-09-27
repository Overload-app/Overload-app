// @vitest-environment jsdom
//
// Component/interaction tests — a different, complementary layer to
// App.test.js's pure-logic tests. Those verify the math and data
// transformations are correct; these verify the actual screens behave
// correctly when a person clicks, types, and submits — the category of
// bug logic tests structurally can't catch (e.g. a button wired to the
// wrong handler, a confirm dialog that doesn't actually block the action,
// an index bug in a delete button).
import { describe, test, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { Login, ProfileTab, Progress, Coach, ConfirmEmailScreen, EmailConfirmedScreen, WorkoutSession, OnboardingSummary, Onboarding, Home, Train, WorkoutHistoryEditor, QuizEditor, dateToISO, todayISO } from "./App.jsx";

// jsdom doesn't implement ResizeObserver, which recharts' <ResponsiveContainer>
// needs — this is a test-environment gap, not something the app is missing.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Only the default <App /> smoke test below needs a live-enough Supabase
// stub to get through the initial session-check effect — every other
// describe block in this file tests a sub-component directly and never
// touches this.
vi.mock("./supabaseClient.js", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
    })),
  },
}));

/* ============================================================
   LOGIN
============================================================ */
describe("<Login />", () => {
  function setup(props = {}) {
    const onSignUp = vi.fn().mockResolvedValue({ ok: true });
    const onSignIn = vi.fn().mockResolvedValue({ ok: true });
    const onForgotPassword = vi.fn().mockResolvedValue({ ok: true });
    const utils = render(<Login onSignUp={onSignUp} onSignIn={onSignIn} onForgotPassword={onForgotPassword} {...props} />);
    return { onSignUp, onSignIn, onForgotPassword, ...utils };
  }

  test("defaults to sign-up mode", () => {
    setup();
    expect(screen.getByText("Create your account")).toBeInTheDocument();
  });

  test("initialMode prop overrides the default", () => {
    setup({ initialMode: "signin" });
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
  });

  test("switching to sign-in mode shows the sign-in heading and hides name/confirm fields", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("Already have an account? Sign in"));
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  test("rejects an invalid email on submit without calling onSignUp", async () => {
    const user = userEvent.setup();
    const { onSignUp } = setup();
    await user.type(screen.getByPlaceholderText("you@example.com"), "not-an-email");
    await user.click(screen.getByText("Create account"));
    expect(await screen.findByText("Enter a valid email.")).toBeInTheDocument();
    expect(onSignUp).not.toHaveBeenCalled();
  });

  test("signup requires a name", async () => {
    const user = userEvent.setup();
    const { onSignUp } = setup();
    await user.type(screen.getByPlaceholderText("you@example.com"), "alex@example.com");
    await user.type(screen.getByPlaceholderText("At least 6 characters"), "password123");
    await user.type(screen.getByPlaceholderText("Re-enter password"), "password123");
    await user.click(screen.getByText("Create account"));
    expect(await screen.findByText("Enter your name.")).toBeInTheDocument();
    expect(onSignUp).not.toHaveBeenCalled();
  });

  test("signup rejects mismatched passwords", async () => {
    const user = userEvent.setup();
    const { onSignUp } = setup();
    await user.type(screen.getByPlaceholderText("Alex"), "Alex");
    await user.type(screen.getByPlaceholderText("you@example.com"), "alex@example.com");
    await user.type(screen.getByPlaceholderText("At least 6 characters"), "password123");
    await user.type(screen.getByPlaceholderText("Re-enter password"), "different456");
    await user.click(screen.getByText("Create account"));
    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
    expect(onSignUp).not.toHaveBeenCalled();
  });

  test("a valid signup calls onSignUp with trimmed, lowercased email", async () => {
    const user = userEvent.setup();
    const { onSignUp } = setup();
    await user.type(screen.getByPlaceholderText("Alex"), "  Alex  ");
    await user.type(screen.getByPlaceholderText("you@example.com"), "  Alex@Example.com  ");
    await user.type(screen.getByPlaceholderText("At least 6 characters"), "password123");
    await user.type(screen.getByPlaceholderText("Re-enter password"), "password123");
    await user.click(screen.getByText("Create account"));
    expect(onSignUp).toHaveBeenCalledWith({ name: "Alex", email: "alex@example.com", password: "password123" });
  });

  // Regression test for a real bug found in the audit: "forgot password"
  // mode shows only the email field, and it had no way to submit via
  // keyboard at all before this was fixed.
  test("pressing Enter in the email field submits in forgot-password mode", async () => {
    const user = userEvent.setup();
    const { onForgotPassword } = setup({ initialMode: "signin" });
    await user.click(screen.getByText("Forgot password?"));
    await user.type(screen.getByPlaceholderText("you@example.com"), "alex@example.com{Enter}");
    expect(onForgotPassword).toHaveBeenCalledWith("alex@example.com");
  });

  test("pressing Enter in the email field does NOT prematurely submit in sign-up mode", async () => {
    const user = userEvent.setup();
    const { onSignUp } = setup();
    await user.type(screen.getByPlaceholderText("you@example.com"), "alex@example.com{Enter}");
    expect(onSignUp).not.toHaveBeenCalled();
  });

  test("pressing Enter in the password field submits in sign-in mode", async () => {
    const user = userEvent.setup();
    const { onSignIn } = setup({ initialMode: "signin" });
    await user.type(screen.getByPlaceholderText("you@example.com"), "alex@example.com");
    await user.type(screen.getByPlaceholderText("At least 6 characters"), "password123{Enter}");
    expect(onSignIn).toHaveBeenCalledWith({ email: "alex@example.com", password: "password123" });
  });

  test("shows the server-provided error message when sign-in fails", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn().mockResolvedValue({ ok: false, error: "Invalid login credentials" });
    render(<Login onSignUp={vi.fn()} onSignIn={onSignIn} onForgotPassword={vi.fn()} initialMode="signin" />);
    await user.type(screen.getByPlaceholderText("you@example.com"), "alex@example.com");
    await user.type(screen.getByPlaceholderText("At least 6 characters"), "wrongpassword");
    await user.click(screen.getByText("Sign in"));
    expect(await screen.findByText("Invalid login credentials")).toBeInTheDocument();
  });
});

/* ============================================================
   PROFILE TAB — reset confirmation flow (the fix from the audit pass:
   this used to wipe the whole account with a single click, no confirmation)
============================================================ */
describe("<ProfileTab /> reset confirmation", () => {
  const mockState = {
    profile: {
      goal: "recomp", currentPhysique: "average", desiredPhysique: "lean and athletic",
      specificGoals: "", experience: "intermediate", equipment: "full", daysPerWeek: 4,
      sessionLength: 60, injuries: ["none"], otherInjuries: "", heightIn: 70, weightLb: 180,
    },
    targets: { calories: 2400, protein: 180, carbs: 250, fat: 70, tdee: 2600 },
  };
  const account = { name: "Alex", email: "alex@example.com" };

  function setup() {
    const resetAll = vi.fn();
    const onLogout = vi.fn();
    const onOpenSubscribe = vi.fn();
    render(
      <ProfileTab
        state={mockState} resetAll={resetAll} account={account} onLogout={onLogout}
        subscribed={true} trialActive={false} trialDaysLeftCount={0} onOpenSubscribe={onOpenSubscribe}
      />
    );
    return { resetAll };
  }

  test("does not call resetAll just from rendering the screen", () => {
    const { resetAll } = setup();
    expect(resetAll).not.toHaveBeenCalled();
  });

  test("clicking 'Retake quiz & reset' shows a confirmation step instead of resetting immediately", async () => {
    const user = userEvent.setup();
    const { resetAll } = setup();
    await user.click(screen.getByText("Retake quiz & reset"));
    expect(await screen.findByText("Yes, permanently delete everything")).toBeInTheDocument();
    expect(resetAll).not.toHaveBeenCalled();
  });

  test("clicking Cancel backs out without ever calling resetAll", async () => {
    const user = userEvent.setup();
    const { resetAll } = setup();
    await user.click(screen.getByText("Retake quiz & reset"));
    await user.click(await screen.findByText("Cancel"));
    expect(screen.getByText("Retake quiz & reset")).toBeInTheDocument();
    expect(resetAll).not.toHaveBeenCalled();
  });

  test("only calls resetAll after the second, explicit confirmation", async () => {
    const user = userEvent.setup();
    const { resetAll } = setup();
    await user.click(screen.getByText("Retake quiz & reset"));
    await user.click(await screen.findByText("Yes, permanently delete everything"));
    expect(resetAll).toHaveBeenCalledTimes(1);
  });
});

describe("<ProfileTab /> review toggles", () => {
  const mockState = {
    profile: {
      goal: "recomp", currentPhysique: "average", desiredPhysique: "lean and athletic",
      specificGoals: "", experience: "intermediate", equipment: "full", daysPerWeek: 4,
      sessionLength: 60, injuries: ["none"], otherInjuries: "", heightIn: 70, weightLb: 180,
    },
    targets: { calories: 2400, protein: 180, carbs: 250, fat: 70, tdee: 2600 },
    reviewsEnabled: { weekly: true, monthly: false },
  };
  const account = { name: "Alex", email: "alex@example.com" };

  test("reflects the current on/off state of each toggle", () => {
    render(
      <ProfileTab
        state={mockState} resetAll={vi.fn()} account={account} onLogout={vi.fn()}
        subscribed={true} trialActive={false} trialDaysLeftCount={0} onOpenSubscribe={vi.fn()} onSetReviewEnabled={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Toggle weekly review")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Toggle monthly review")).toHaveAttribute("aria-checked", "false");
  });

  test("clicking a toggle calls onSetReviewEnabled with the flipped value for just that cadence", async () => {
    const user = userEvent.setup();
    const onSetReviewEnabled = vi.fn();
    render(
      <ProfileTab
        state={mockState} resetAll={vi.fn()} account={account} onLogout={vi.fn()}
        subscribed={true} trialActive={false} trialDaysLeftCount={0} onOpenSubscribe={vi.fn()} onSetReviewEnabled={onSetReviewEnabled}
      />
    );
    await user.click(screen.getByLabelText("Toggle weekly review"));
    expect(onSetReviewEnabled).toHaveBeenCalledWith("weekly", false); // was true
    await user.click(screen.getByLabelText("Toggle monthly review"));
    expect(onSetReviewEnabled).toHaveBeenCalledWith("monthly", true); // was false
  });
});

/* ============================================================
   PROGRESS — bodyweight log / delete (built this session)
============================================================ */
describe("<Progress />", () => {
  function buildState(bodyweight) {
    return {
      profile: { weightLb: 180 },
      logs: { bodyweight, workouts: [], nutrition: [] },
    };
  }

  test("logging a weight calls addWeight with the numeric value and clears the input", async () => {
    const user = userEvent.setup();
    const addWeight = vi.fn();
    render(<Progress state={buildState([])} addWeight={addWeight} removeWeight={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Weight \(lb\)/);
    await user.type(input, "182.5");
    await user.click(screen.getByText("Log"));
    expect(addWeight).toHaveBeenCalledWith(182.5);
    expect(input.value).toBe("");
  });

  test("clicking Log with an empty input does nothing", async () => {
    const user = userEvent.setup();
    const addWeight = vi.fn();
    render(<Progress state={buildState([])} addWeight={addWeight} removeWeight={vi.fn()} />);
    await user.click(screen.getByText("Log"));
    expect(addWeight).not.toHaveBeenCalled();
  });

  test("no 'Recent entries' section when nothing has been logged", () => {
    render(<Progress state={buildState([])} addWeight={vi.fn()} removeWeight={vi.fn()} />);
    expect(screen.queryByText("Recent entries")).not.toBeInTheDocument();
  });

  test("deleting an entry calls removeWeight with its real index into the underlying array, not its position in the reversed display list", async () => {
    const user = userEvent.setup();
    const removeWeight = vi.fn();
    const bodyweight = [
      { date: "2026-01-01", weight: 180 }, // index 0 — shown LAST (list is reversed, newest first)
      { date: "2026-01-08", weight: 178 }, // index 1 — shown FIRST
    ];
    render(<Progress state={buildState(bodyweight)} addWeight={vi.fn()} removeWeight={removeWeight} />);

    // The most recent entry (178lb, real index 1) renders first in the list.
    const entries = screen.getAllByText(/lb$/);
    expect(entries[0]).toHaveTextContent("178");
    // entries[0] is the innermost "<weight> lb" div; two levels up is the
    // Card that also contains the delete button.
    const firstCard = entries[0].parentElement.parentElement;
    await user.click(within(firstCard).getByRole("button"));
    expect(removeWeight).toHaveBeenCalledWith(1);
  });

  test("shows a 'View & edit workout history' entry point once at least one workout is logged, and calls onOpenHistory", async () => {
    const user = userEvent.setup();
    const onOpenHistory = vi.fn();
    const state = { profile: { weightLb: 180 }, logs: { bodyweight: [], workouts: [{ date: "2026-08-01", dayName: "Push", exercises: [] }], nutrition: [] } };
    render(<Progress state={state} addWeight={vi.fn()} removeWeight={vi.fn()} onOpenHistory={onOpenHistory} />);
    await user.click(screen.getByText("View & edit workout history"));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  test("hides the workout-history entry point when nothing has been logged yet", () => {
    render(<Progress state={buildState([])} addWeight={vi.fn()} removeWeight={vi.fn()} onOpenHistory={vi.fn()} />);
    expect(screen.queryByText("View & edit workout history")).not.toBeInTheDocument();
  });

  test("shows no Reviews section at all when no review has ever been generated", () => {
    render(<Progress state={buildState([])} addWeight={vi.fn()} removeWeight={vi.fn()} onOpenHistory={vi.fn()} onMarkReviewSeen={vi.fn()} />);
    expect(screen.queryByText("Reviews")).not.toBeInTheDocument();
  });

  test("renders a generated review's overview and advice, and marks it seen", () => {
    const onMarkReviewSeen = vi.fn();
    const state = {
      ...buildState([]),
      reviews: {
        weekly: [{ generatedAt: "2026-08-10T00:00:00.000Z", summary: { workoutCount: 3 }, overview: "Solid week overall.", advice: ["Add a fourth set to bench."], seen: false }],
        monthly: [],
      },
    };
    render(<Progress state={state} addWeight={vi.fn()} removeWeight={vi.fn()} onOpenHistory={vi.fn()} onMarkReviewSeen={onMarkReviewSeen} />);
    expect(screen.getByText("WEEKLY REVIEW")).toBeInTheDocument();
    expect(screen.getByText("Solid week overall.")).toBeInTheDocument();
    expect(screen.getByText("Add a fourth set to bench.")).toBeInTheDocument();
    expect(onMarkReviewSeen).toHaveBeenCalledWith("weekly", 0);
  });

  test("falls back to the deterministic workout count when the AI overview is missing (e.g. a failed/offline generation)", () => {
    const state = {
      ...buildState([]),
      reviews: { weekly: [], monthly: [{ generatedAt: "2026-08-10T00:00:00.000Z", summary: { workoutCount: 2 }, overview: null, advice: [], seen: false }] },
    };
    render(<Progress state={state} addWeight={vi.fn()} removeWeight={vi.fn()} onOpenHistory={vi.fn()} onMarkReviewSeen={vi.fn()} />);
    expect(screen.getByText("2 workouts logged this period.")).toBeInTheDocument();
  });

  function reviewState(entries) {
    return { ...buildState([]), reviews: { weekly: entries, monthly: [] } };
  }

  test("an already-seen review starts collapsed, and the header toggles it open and shut", async () => {
    const user = userEvent.setup();
    const state = reviewState([
      { generatedAt: "2026-08-10T00:00:00.000Z", summary: { workoutCount: 3 }, overview: "Solid week overall.", advice: ["Add a set."], seen: true },
    ]);
    render(<Progress state={state} addWeight={vi.fn()} removeWeight={vi.fn()} onOpenHistory={vi.fn()} onMarkReviewSeen={vi.fn()} />);
    // Collapsed: the label/date row is there, the write-up isn't.
    expect(screen.getByText("WEEKLY REVIEW")).toBeInTheDocument();
    expect(screen.queryByText("Solid week overall.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Expand weekly review/ }));
    expect(screen.getByText("Solid week overall.")).toBeInTheDocument();
    expect(screen.getByText("Add a set.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Collapse weekly review/ }));
    expect(screen.queryByText("Solid week overall.")).not.toBeInTheDocument();
  });

  test("deleting a review needs a confirm, and reports the entry's real index (not its reversed display position)", async () => {
    const user = userEvent.setup();
    const onDeleteReview = vi.fn();
    // Newest renders first, so the top card is index 2 of 3.
    const state = reviewState([
      { generatedAt: "2026-07-27T00:00:00.000Z", summary: {}, overview: "Oldest.", advice: [], seen: true },
      { generatedAt: "2026-08-03T00:00:00.000Z", summary: {}, overview: "Middle.", advice: [], seen: true },
      { generatedAt: "2026-08-10T00:00:00.000Z", summary: {}, overview: "Newest.", advice: [], seen: true },
    ]);
    render(<Progress state={state} addWeight={vi.fn()} removeWeight={vi.fn()} onOpenHistory={vi.fn()} onMarkReviewSeen={vi.fn()} onDeleteReview={onDeleteReview} />);

    await user.click(screen.getByRole("button", { name: "Delete weekly review from 2026-08-10" }));
    // One tap only arms it — nothing deleted yet.
    expect(onDeleteReview).not.toHaveBeenCalled();
    expect(screen.getByText("KEEP")).toBeInTheDocument();

    await user.click(screen.getByText("DELETE"));
    expect(onDeleteReview).toHaveBeenCalledWith("weekly", 2);
  });

  test("backing out of a delete leaves the review alone", async () => {
    const user = userEvent.setup();
    const onDeleteReview = vi.fn();
    const state = reviewState([{ generatedAt: "2026-08-10T00:00:00.000Z", summary: {}, overview: "Keep me.", advice: [], seen: true }]);
    render(<Progress state={state} addWeight={vi.fn()} removeWeight={vi.fn()} onOpenHistory={vi.fn()} onMarkReviewSeen={vi.fn()} onDeleteReview={onDeleteReview} />);
    await user.click(screen.getByRole("button", { name: /^Delete weekly review/ }));
    await user.click(screen.getByText("KEEP"));
    expect(onDeleteReview).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Delete weekly review/ })).toBeInTheDocument();
  });

  test("a brand-new (unseen) review starts open so it actually gets read", () => {
    const state = reviewState([
      { generatedAt: "2026-08-10T00:00:00.000Z", summary: {}, overview: "Read me now.", advice: [], seen: false },
    ]);
    render(<Progress state={state} addWeight={vi.fn()} removeWeight={vi.fn()} onOpenHistory={vi.fn()} onMarkReviewSeen={vi.fn()} />);
    expect(screen.getByText("Read me now.")).toBeInTheDocument();
  });

  test("collapse state survives a parent re-render (the card is not redefined per render)", async () => {
    const user = userEvent.setup();
    const state = reviewState([{ generatedAt: "2026-08-10T00:00:00.000Z", summary: {}, overview: "Sticky open.", advice: [], seen: true }]);
    const { rerender } = render(<Progress state={state} addWeight={vi.fn()} removeWeight={vi.fn()} onOpenHistory={vi.fn()} onMarkReviewSeen={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^Expand weekly review/ }));
    expect(screen.getByText("Sticky open.")).toBeInTheDocument();
    rerender(<Progress state={{ ...state }} addWeight={vi.fn()} removeWeight={vi.fn()} onOpenHistory={vi.fn()} onMarkReviewSeen={vi.fn()} />);
    expect(screen.getByText("Sticky open.")).toBeInTheDocument();
  });

  test("no delete control is offered when the screen wasn't given a delete handler", () => {
    const state = reviewState([{ generatedAt: "2026-08-10T00:00:00.000Z", summary: {}, overview: "x", advice: [], seen: true }]);
    render(<Progress state={state} addWeight={vi.fn()} removeWeight={vi.fn()} onOpenHistory={vi.fn()} onMarkReviewSeen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Delete weekly review/ })).not.toBeInTheDocument();
  });
});

describe("<WorkoutHistoryEditor />", () => {
  function workouts() {
    return [
      { date: "2026-08-01", dayName: "Push", durationSec: 2400, exercises: [{ name: "Bench Press", logged: [{ weight: "135", reps: "8", done: true }] }] },
      { date: "2026-08-08", dayName: "Legs", durationSec: 1800, exercises: [{ name: "Leg Press", logged: [{ weight: "225", reps: "10", done: true }] }] },
    ];
  }

  test("lists workouts most-recent-first and opens a detail view on tap", async () => {
    const user = userEvent.setup();
    render(<WorkoutHistoryEditor workouts={workouts()} onClose={vi.fn()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    const cards = screen.getAllByText(/Push|Legs/);
    expect(cards[0]).toHaveTextContent("Legs"); // most recent (index 1) shown first
    await user.click(screen.getByText("Push"));
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
  });

  test("initialOpenIndex jumps straight to that entry's detail view — real ask: opening from Train's own History list", () => {
    render(<WorkoutHistoryEditor workouts={workouts()} onClose={vi.fn()} onDelete={vi.fn()} onUpdate={vi.fn()} initialOpenIndex={0} />);
    // Real index 0 is "Push" — should be showing the detail view directly,
    // not the top-level list.
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.queryByText("Workout history")).not.toBeInTheDocument();
  });

  test("editing a set's weight and saving calls onUpdate with the real (non-reversed) index and the edited value", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<WorkoutHistoryEditor workouts={workouts()} onClose={vi.fn()} onDelete={vi.fn()} onUpdate={onUpdate} />);
    await user.click(screen.getByText("Push")); // real index 0
    const weightInput = screen.getByLabelText("Bench Press set 1 weight");
    await user.clear(weightInput);
    await user.type(weightInput, "145");
    await user.click(screen.getByText("Save changes"));
    expect(onUpdate).toHaveBeenCalledWith(0, [{ name: "Bench Press", logged: [{ weight: "145", reps: "8", done: true }] }]);
  });

  // Real report: a workout discarded halfway through still recorded
  // whatever partial time had elapsed (18 min), with no way to fix it.
  test("editing the duration and saving calls onUpdate with the new duration in seconds", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<WorkoutHistoryEditor workouts={workouts()} onClose={vi.fn()} onDelete={vi.fn()} onUpdate={onUpdate} />);
    await user.click(screen.getByText("Push")); // real index 0, currently 2400s = 40 min
    const durationInput = screen.getByLabelText("Workout duration in minutes");
    expect(durationInput).toHaveValue(40);
    await user.clear(durationInput);
    await user.type(durationInput, "18");
    await user.click(screen.getByText("Save changes"));
    expect(onUpdate).toHaveBeenCalledWith(0, workouts()[0].exercises, 1080); // 18 min = 1080s
  });

  test("saving without editing anything does not call onUpdate", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<WorkoutHistoryEditor workouts={workouts()} onClose={vi.fn()} onDelete={vi.fn()} onUpdate={onUpdate} />);
    await user.click(screen.getByText("Push"));
    await user.click(screen.getByText("Save changes"));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test("deleting requires confirmation, then calls onDelete with the real index", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<WorkoutHistoryEditor workouts={workouts()} onClose={vi.fn()} onDelete={onDelete} onUpdate={vi.fn()} />);
    await user.click(screen.getByText("Legs")); // real index 1
    await user.click(screen.getByText("Delete"));
    expect(screen.getByText("Delete this workout?")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled(); // not yet — still needs confirmation
    await user.click(screen.getAllByText("Delete")[1]); // the confirm dialog's own Delete button
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  test("canceling the delete confirmation keeps the workout", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<WorkoutHistoryEditor workouts={workouts()} onClose={vi.fn()} onDelete={onDelete} onUpdate={vi.fn()} />);
    await user.click(screen.getByText("Push"));
    await user.click(screen.getByText("Delete"));
    await user.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Delete this workout?")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  test("shows an empty state with no workouts logged", () => {
    render(<WorkoutHistoryEditor workouts={[]} onClose={vi.fn()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    expect(screen.getByText("No workouts logged yet.")).toBeInTheDocument();
  });

  test("closing calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<WorkoutHistoryEditor workouts={workouts()} onClose={onClose} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    await user.click(screen.getByLabelText("Close workout history"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// Real ask: "get rid of the up next thing beside the workout. just make it so
// that it shows what workout you did last time." NEXT was a prediction from a
// rotation count; LAST DONE is a fact about what actually happened.
describe("<Train /> Sessions list marks the day you last did, not the one it predicts is next", () => {
  const program = {
    splitName: "Push / Pull / Legs",
    days: [
      { name: "Push", exercises: [{ name: "Bench Press" }] },
      { name: "Pull", exercises: [{ name: "Barbell Row" }] },
      { name: "Legs", exercises: [{ name: "Squat" }] },
    ],
  };

  test("the day from the most recent logged workout is the one marked", () => {
    const state = {
      program,
      logs: { workouts: [
        { date: "2026-09-20", dayName: "Push", exercises: [] },
        { date: "2026-09-24", dayName: "Pull", exercises: [] },
      ] },
    };
    render(<Train state={state} startWorkout={vi.fn()} setActiveTab={vi.fn()} onOpenHistoryEntry={vi.fn()} />);
    const badge = screen.getByText(/LAST DONE/);
    expect(badge).toHaveTextContent("Sep 24");
    // One badge only — the older Push workout isn't also marked.
    expect(screen.getAllByText(/LAST DONE/)).toHaveLength(1);
  });

  test("the NEXT prediction is gone entirely", () => {
    const state = { program, logs: { workouts: [{ date: "2026-09-24", dayName: "Pull", exercises: [] }] } };
    render(<Train state={state} startWorkout={vi.fn()} setActiveTab={vi.fn()} onOpenHistoryEntry={vi.fn()} />);
    expect(screen.queryByText("NEXT")).not.toBeInTheDocument();
  });

  test("nothing is marked before the first workout is ever logged", () => {
    render(<Train state={{ program, logs: { workouts: [] } }} startWorkout={vi.fn()} setActiveTab={vi.fn()} onOpenHistoryEntry={vi.fn()} />);
    expect(screen.queryByText(/LAST DONE/)).not.toBeInTheDocument();
  });

  test("a logged day no longer in the program marks nothing, rather than mislabelling another day", () => {
    const state = { program, logs: { workouts: [{ date: "2026-09-24", dayName: "Full Body A", exercises: [] }] } };
    render(<Train state={state} startWorkout={vi.fn()} setActiveTab={vi.fn()} onOpenHistoryEntry={vi.fn()} />);
    expect(screen.queryByText(/LAST DONE/)).not.toBeInTheDocument();
  });

  test("tapping a session card still starts that day's workout", async () => {
    const user = userEvent.setup();
    const startWorkout = vi.fn();
    const state = { program, logs: { workouts: [{ date: "2026-09-24", dayName: "Pull", exercises: [] }] } };
    render(<Train state={state} startWorkout={startWorkout} setActiveTab={vi.fn()} onOpenHistoryEntry={vi.fn()} />);
    await user.click(screen.getByText("Legs"));
    expect(startWorkout).toHaveBeenCalledWith(2);
  });
});

describe("<Train /> History list — real ask: edit/delete reachable here too, not just Progress", () => {
  function buildState() {
    return {
      // Distinct from the history entries' dayNames below on purpose — the
      // Sessions list above also renders day names, and "Push"/"Legs"
      // would otherwise collide with the history cards this test targets.
      program: { splitName: "Full Body", days: [{ name: "Full Body A", exercises: [{ name: "Bench Press" }] }] },
      logs: {
        workouts: [
          { date: "2026-08-01", dayName: "Push", durationSec: 2400, exercises: [{ name: "Bench Press" }] }, // real index 0
          { date: "2026-08-08", dayName: "Legs", durationSec: 1800, exercises: [{ name: "Squat" }] }, // real index 1 — shown FIRST (most recent)
        ],
      },
    };
  }

  test("tapping a history card calls onOpenHistoryEntry with its REAL index, not its position in the reversed display list", async () => {
    const user = userEvent.setup();
    const onOpenHistoryEntry = vi.fn();
    render(<Train state={buildState()} startWorkout={vi.fn()} setActiveTab={vi.fn()} onOpenHistoryEntry={onOpenHistoryEntry} />);

    const cards = screen.getAllByText(/^Push$|^Legs$/);
    expect(cards[0]).toHaveTextContent("Legs"); // most recent shown first
    await user.click(cards[0]);
    expect(onOpenHistoryEntry).toHaveBeenCalledWith(1); // real index of "Legs"

    await user.click(screen.getByText("Push"));
    expect(onOpenHistoryEntry).toHaveBeenCalledWith(0); // real index of "Push"
  });
});

/* ============================================================
   COACH CHAT
============================================================ */
describe("<Coach />", () => {
  function setup(props = {}) {
    const onSend = vi.fn();
    const onClearChat = vi.fn();
    const utils = render(
      <Coach messages={[]} loading={false} onSend={onSend} onClearChat={onClearChat} coachUsage={null} dailyLimit={30} {...props} />
    );
    return { onSend, onClearChat, ...utils };
  }

  test("shows the default greeting when there's no chat history yet", () => {
    setup();
    expect(screen.getByText(/Ask me to adjust your program/)).toBeInTheDocument();
  });

  test("typing a message and pressing Enter sends it and clears the input", async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    const input = screen.getByPlaceholderText(/My shoulder hurts/);
    await user.type(input, "Swap my leg day{Enter}");
    expect(onSend).toHaveBeenCalledWith("Swap my leg day");
    expect(input.value).toBe("");
  });

  test("does not send an empty or whitespace-only message", async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    await user.type(screen.getByPlaceholderText(/My shoulder hurts/), "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  test("does not send while a reply is already loading", async () => {
    const user = userEvent.setup();
    const { onSend } = setup({ loading: true });
    await user.type(screen.getByPlaceholderText(/My shoulder hurts/), "Hello{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  test("clearing chat requires confirmation before onClearChat is called", async () => {
    const user = userEvent.setup();
    const { onClearChat } = setup({ messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "hey" }] });
    await user.click(screen.getByText("Clear chat"));
    expect(onClearChat).not.toHaveBeenCalled();
    await user.click(screen.getByText("Confirm clear"));
    expect(onClearChat).toHaveBeenCalledTimes(1);
  });

  test("shows the remaining daily message count once it's low", () => {
    // Use the app's own todayISO() (local calendar day), not toISOString()
    // (UTC) — the component compares against todayISO(), so this avoids a
    // flaky mismatch near midnight depending on timezone.
    setup({ coachUsage: { date: todayISO(), count: 25 } });
    expect(screen.getByText(/5 messages left today/)).toBeInTheDocument();
  });

  test("shows quick-action prompt chips only in the empty state, and tapping one sends it", async () => {
    const user = userEvent.setup();
    const { onSend } = setup({ messages: [] });
    const chip = screen.getByText("Swap squat for leg press");
    expect(chip).toBeInTheDocument();
    await user.click(chip);
    expect(onSend).toHaveBeenCalledWith("Swap squat for leg press");
  });

  test("quick-action chips disappear once a real conversation exists", () => {
    setup({ messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "hey" }] });
    expect(screen.queryByText("Swap squat for leg press")).not.toBeInTheDocument();
  });

  // Coach replies routinely include markdown (bold exercise names,
  // numbered lists laying out a swap) — real report: it rendered as raw
  // text, literal asterisks and no real line breaks.
  test("renders **bold** markdown as an actual <strong> element, not literal asterisks", () => {
    const { container } = setup({ messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "Swapped in **Barbell Hip Thrust** for today." }] });
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong.textContent).toBe("Barbell Hip Thrust");
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  test("renders a numbered list as real <li> elements", () => {
    const text = "Today's session:\n1. Barbell Hip Thrust\n2. Leg Press\n3. Seated Leg Curl";
    const { container } = setup({ messages: [{ role: "user", text: "hi" }, { role: "assistant", text } ]});
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toBe("Barbell Hip Thrust");
    expect(container.querySelector("ol")).not.toBeNull();
  });

  test("renders a bulleted list as a <ul>, distinct from a numbered list", () => {
    const text = "- Cable Pull-Through\n- Romanian Deadlift";
    const { container } = setup({ messages: [{ role: "user", text: "hi" }, { role: "assistant", text }] });
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
  });
});

/* ============================================================
   EMAIL CONFIRMATION SCREENS
============================================================ */
describe("<ConfirmEmailScreen />", () => {
  test("resending calls onResend with the email and shows a success message", async () => {
    const user = userEvent.setup();
    const onResend = vi.fn().mockResolvedValue({ ok: true });
    render(<ConfirmEmailScreen email="alex@example.com" onResend={onResend} onBackToLogin={vi.fn()} />);
    await user.click(screen.getByText("Resend confirmation email"));
    expect(onResend).toHaveBeenCalledWith("alex@example.com");
    expect(await screen.findByText("Confirmation email resent.")).toBeInTheDocument();
  });

  test("shows the error message when resending fails", async () => {
    const user = userEvent.setup();
    const onResend = vi.fn().mockResolvedValue({ ok: false, error: "Too many requests" });
    render(<ConfirmEmailScreen email="alex@example.com" onResend={onResend} onBackToLogin={vi.fn()} />);
    await user.click(screen.getByText("Resend confirmation email"));
    expect(await screen.findByText("Too many requests")).toBeInTheDocument();
  });
});

describe("<EmailConfirmedScreen />", () => {
  test("clicking Continue calls onContinue", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<EmailConfirmedScreen onContinue={onContinue} />);
    await user.click(screen.getByText("Continue to Overload"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

/* ============================================================
   WORKOUT SESSION — rest timer per-set behavior
   Directly reproduces real beta-tester feedback: "when you skip the workout
   timer, it shuts it off for the rest of the workout." This test settles
   whether that's an actual bug or a UX/discoverability issue by literally
   performing the reported sequence: complete a set, skip its rest timer,
   then complete a DIFFERENT set and check whether a new timer starts.
============================================================ */
describe("<WorkoutSession /> rest timer", () => {
  function setup() {
    const day = {
      name: "Full Body A",
      exercises: [
        { name: "Back Squat", sets: 1, reps: "8-12", rest: 60, tips: ["a", "b", "c", "d"] },
        { name: "Bench Press", sets: 1, reps: "8-12", rest: 60, tips: ["a", "b", "c", "d"] },
      ],
    };
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
  }

  test("marking a set done starts the rest timer", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByText("RESTING")).not.toBeInTheDocument();
    const [squatCheck] = screen.getAllByLabelText("Mark set 1 done and start rest timer");
    await user.click(squatCheck);
    expect(screen.getByText("RESTING")).toBeInTheDocument();
  });

  test("skipping the rest timer only clears THIS set's timer — completing a different set still starts a new one", async () => {
    const user = userEvent.setup();
    setup();

    // Complete set 1 (Back Squat) — timer starts.
    const [squatCheck, benchCheck] = screen.getAllByLabelText("Mark set 1 done and start rest timer");
    await user.click(squatCheck);
    expect(screen.getByText("RESTING")).toBeInTheDocument();

    // Skip it.
    await user.click(screen.getByText(/Skip/));
    expect(screen.queryByText("RESTING")).not.toBeInTheDocument();

    // Complete the OTHER exercise's set — a fresh timer must start. If this
    // fails, skipping really did disable the timer for the rest of the
    // workout, confirming a real bug rather than just a UX gap.
    await user.click(benchCheck);
    expect(screen.getByText("RESTING")).toBeInTheDocument();
  });

  test("unchecking a completed set does not start a rest timer", async () => {
    const user = userEvent.setup();
    setup();
    const [squatCheck] = screen.getAllByLabelText("Mark set 1 done and start rest timer");
    await user.click(squatCheck); // done -> timer starts
    await user.click(screen.getByText(/Skip/)); // clear it
    // Now the button's label has flipped to the "done" variant.
    const undoBtn = screen.getAllByLabelText(/tap to undo/)[0];
    await user.click(undoBtn); // done -> not done
    expect(screen.queryByText("RESTING")).not.toBeInTheDocument();
  });
});

describe("<WorkoutSession /> History & PR", () => {
  const day = {
    name: "Full Body A",
    exercises: [
      { name: "Back Squat", sets: 1, reps: "8-12", rest: 60, tips: ["a", "b", "c", "d"] },
      { name: "Bench Press", sets: 1, reps: "8-12", rest: 60, tips: ["a", "b", "c", "d"] },
    ],
  };
  const logs = {
    workouts: [
      { date: "2026-08-01", exercises: [{ name: "Back Squat", logged: [{ weight: "185", reps: "5", done: true }] }] },
      { date: "2026-08-15", exercises: [{ name: "Back Squat", logged: [{ weight: "195", reps: "5", done: true }, { weight: "205", reps: "3", done: true }] }] },
    ],
  };

  function setup(logsOverride = logs) {
    const user = userEvent.setup();
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={logsOverride} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    return user;
  }

  test("opening it for an exercise with history shows the PR and every set from the last session", async () => {
    const user = setup();
    const [squatHistoryBtn] = screen.getAllByText("History & PR");
    await user.click(squatHistoryBtn);

    // PR is the heaviest set ever (205lb x3), not just the latest session's total.
    // It happens to also be a set from the last session, so it's expected twice:
    // once in the PR card, once in the last-session set breakdown.
    expect(screen.getAllByText("205lb × 3")).toHaveLength(2);
    // Last session (08-15) logged two sets — both should be listed individually.
    expect(screen.getByText("195lb × 5")).toBeInTheDocument();
  });

  test("opening it for an exercise never logged before shows a plain empty state, not a crash", async () => {
    const user = setup();
    const [, benchHistoryBtn] = screen.getAllByText("History & PR");
    await user.click(benchHistoryBtn);
    expect(screen.getByText(/No history yet/)).toBeInTheDocument();
  });

  test("closing the sheet returns to the workout", async () => {
    const user = setup();
    const [squatHistoryBtn] = screen.getAllByText("History & PR");
    await user.click(squatHistoryBtn);
    expect(screen.getByText("PERSONAL RECORD")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Close exercise history"));
    expect(screen.queryByText("PERSONAL RECORD")).not.toBeInTheDocument();
  });
});

describe("<WorkoutSession /> PR celebration", () => {
  const day = {
    name: "Full Body A",
    exercises: [{ name: "Back Squat", sets: 1, reps: "8-12", rest: 60, tips: ["a", "b", "c", "d"] }],
  };

  function setup(logsOverride) {
    const user = userEvent.setup();
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={logsOverride} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    return user;
  }

  test("logging a set heavier than the existing PR shows a celebration toast", async () => {
    const logs = { workouts: [{ date: "2026-08-01", exercises: [{ name: "Back Squat", logged: [{ weight: "185", reps: "5", done: true }] }] }] };
    const user = setup(logs);
    await user.type(screen.getByPlaceholderText("lb"), "205");
    await user.type(screen.getByPlaceholderText("reps"), "5");
    await user.click(screen.getByLabelText("Mark set 1 done and start rest timer"));
    expect(screen.getByText("NEW PR")).toBeInTheDocument();
    expect(screen.getByText("Back Squat · 205lb × 5")).toBeInTheDocument();
  });

  test("logging a set that does NOT beat the existing PR shows no toast", async () => {
    const logs = { workouts: [{ date: "2026-08-01", exercises: [{ name: "Back Squat", logged: [{ weight: "225", reps: "5", done: true }] }] }] };
    const user = setup(logs);
    await user.type(screen.getByPlaceholderText("lb"), "205");
    await user.type(screen.getByPlaceholderText("reps"), "5");
    await user.click(screen.getByLabelText("Mark set 1 done and start rest timer"));
    expect(screen.queryByText("NEW PR")).not.toBeInTheDocument();
  });

  test("with no logged history at all, no toast shows — there's nothing it actually beat", async () => {
    // Real report: this used to celebrate any first-ever log as a "new
    // PR" — but the same "no history found" path also fires when an
    // exercise was simply renamed (a Coach edit, a regenerated program),
    // stranding real history under the old name. Either way there's no
    // genuine prior number being beaten, so no toast is the honest answer.
    const user = setup({ workouts: [] });
    await user.type(screen.getByPlaceholderText("lb"), "135");
    await user.type(screen.getByPlaceholderText("reps"), "8");
    await user.click(screen.getByLabelText("Mark set 1 done and start rest timer"));
    expect(screen.queryByText("NEW PR")).not.toBeInTheDocument();
  });

  test("logging the exact same weight and reps as the existing PR (a tie) shows no toast", async () => {
    const logs = { workouts: [{ date: "2026-08-01", exercises: [{ name: "Back Squat", logged: [{ weight: "185", reps: "5", done: true }] }] }] };
    const user = setup(logs);
    await user.type(screen.getByPlaceholderText("lb"), "185");
    await user.type(screen.getByPlaceholderText("reps"), "5");
    await user.click(screen.getByLabelText("Mark set 1 done and start rest timer"));
    expect(screen.queryByText("NEW PR")).not.toBeInTheDocument();
  });

  test("dismissing the toast hides it immediately", async () => {
    const logs = { workouts: [{ date: "2026-08-01", exercises: [{ name: "Back Squat", logged: [{ weight: "115", reps: "8", done: true }] }] }] };
    const user = setup(logs);
    await user.type(screen.getByPlaceholderText("lb"), "135");
    await user.type(screen.getByPlaceholderText("reps"), "8");
    await user.click(screen.getByLabelText("Mark set 1 done and start rest timer"));
    expect(screen.getByText("NEW PR")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Dismiss PR notification"));
    expect(screen.queryByText("NEW PR")).not.toBeInTheDocument();
  });
});

describe("<WorkoutSession /> editing weight/reps after the checkmark", () => {
  // Real report: "should be able to change the weight or reps after the
  // checkmark has been hit, and it should remember that as the reps or
  // weight actually done." The inputs were never actually locked after
  // marking a set done — this just confirms an edit made AFTER checking
  // the box is what actually gets saved when the workout finishes, not
  // whatever was typed in before the checkmark.
  test("a weight/reps edit made after marking a set done is what onFinish actually receives", async () => {
    const day = { name: "Full Body A", exercises: [{ name: "Bench Press", sets: 1, reps: "8-12", rest: 60, tips: ["a", "b", "c", "d"] }] };
    const onFinish = vi.fn();
    const user = userEvent.setup();
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={onFinish} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    await user.type(screen.getByPlaceholderText("lb"), "135");
    await user.type(screen.getByPlaceholderText("reps"), "8");
    await user.click(screen.getByLabelText("Mark set 1 done and start rest timer"));
    // Edit AFTER the checkmark — should not be locked out.
    await user.clear(screen.getByPlaceholderText("lb"));
    await user.type(screen.getByPlaceholderText("lb"), "145");
    await user.clear(screen.getByPlaceholderText("reps"));
    await user.type(screen.getByPlaceholderText("reps"), "6");

    await user.click(screen.getByText("Finish workout"));
    const savedExercises = onFinish.mock.calls[0][0];
    expect(savedExercises[0].logged[0]).toMatchObject({ weight: "145", reps: "6", done: true });
  });
});

describe("OnboardingSummary", () => {
  const profile = { goal: "build", daysPerWeek: 4, sessionLength: 45 };
  const program = {
    splitName: "Upper / Lower",
    days: [
      { name: "Upper A", exercises: [{ name: "Bench Press" }, { name: "Row" }] },
      { name: "Lower A", exercises: [{ name: "Squat" }] },
    ],
  };
  const targets = { calories: 2600, protein: 180, carbs: 260, fat: 80 };

  test("shows the split name, every day, and each day's exercise count", () => {
    render(<OnboardingSummary profile={profile} program={program} targets={targets} onContinue={() => {}} />);
    expect(screen.getByText("Upper / Lower")).toBeInTheDocument();
    expect(screen.getByText("Upper A")).toBeInTheDocument();
    expect(screen.getByText("Lower A")).toBeInTheDocument();
    expect(screen.getByText("2 exercises")).toBeInTheDocument();
    expect(screen.getByText("1 exercises")).toBeInTheDocument();
  });

  test("shows the calorie target and every macro target", () => {
    render(<OnboardingSummary profile={profile} program={program} targets={targets} onContinue={() => {}} />);
    expect(screen.getByText("2600")).toBeInTheDocument();
    expect(screen.getByText("180g")).toBeInTheDocument();
    expect(screen.getByText("260g")).toBeInTheDocument();
    expect(screen.getByText("80g")).toBeInTheDocument();
  });

  test("mentions the Coach can change any of this", () => {
    render(<OnboardingSummary profile={profile} program={program} targets={targets} onContinue={() => {}} />);
    expect(screen.getByText(/tell your Coach/i)).toBeInTheDocument();
  });

  test("continuing calls onContinue, once the AI disclaimer is acknowledged", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<OnboardingSummary profile={profile} program={program} targets={targets} onContinue={onContinue} />);
    await user.click(screen.getByText(/I understand Overload uses AI/));
    await user.click(screen.getByText(/Let's go/));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  // Real ask: the AI disclaimer should be something actively accepted,
  // not just passive text — "Let's go" is gated on it, not just displayed
  // alongside it.
  test("'Let's go' is disabled until the AI disclaimer is checked, and does nothing if clicked anyway", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<OnboardingSummary profile={profile} program={program} targets={targets} onContinue={onContinue} />);
    expect(screen.getByText(/Let's go/).closest("button")).toBeDisabled();
    await user.click(screen.getByText(/Let's go/));
    expect(onContinue).not.toHaveBeenCalled();
  });

  test("checking then unchecking the disclaimer disables 'Let's go' again", async () => {
    const user = userEvent.setup();
    render(<OnboardingSummary profile={profile} program={program} targets={targets} onContinue={vi.fn()} />);
    const checkbox = screen.getByText(/I understand Overload uses AI/);
    await user.click(checkbox);
    expect(screen.getByText(/Let's go/).closest("button")).not.toBeDisabled();
    await user.click(checkbox);
    expect(screen.getByText(/Let's go/).closest("button")).toBeDisabled();
  });
});

// Regression coverage for a real report: backgrounding the app (phone
// locking, switching apps) paused the rest timer, which then resumed
// counting down from wherever it left off instead of reflecting real
// elapsed time. These prove the fix directly: jump the system clock
// forward WITHOUT firing any interval tick (vi.setSystemTime, unlike
// vi.advanceTimersByTime, never fires the timer queue) — this is what
// actually happens when a mobile browser suspends JS execution in the
// background. A single visibilitychange event (returning to the app)
// should be enough to show the true value in one jump.
describe("<WorkoutSession /> timers survive being backgrounded", () => {
  const day = { name: "Full Body A", exercises: [{ name: "Back Squat", sets: 1, reps: "8-12", rest: 60, tips: ["a", "b", "c", "d"] }] };

  test("the rest timer shows the true remaining time after a background gap, not a stale decremented-by-one value", () => {
    vi.useFakeTimers();
    try {
      render(
        <WorkoutSession
          day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
          onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
          equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
          resumedAt={Date.now()} priorActiveSeconds={0}
        />
      );
      const [squatCheck] = screen.getAllByLabelText("Mark set 1 done and start rest timer");
      fireEvent.click(squatCheck);
      expect(screen.getByText("60")).toBeInTheDocument();

      vi.setSystemTime(Date.now() + 45000); // 45 real seconds pass; no interval fires
      fireEvent(document, new Event("visibilitychange"));

      expect(screen.getByText("15")).toBeInTheDocument();
      expect(screen.queryByText("59")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // visibilitychange has historically been inconsistent on iOS Safari
  // standalone PWAs specifically around a screen lock/unlock — pageshow
  // and window focus are extra fallback triggers for the exact same
  // recompute, so a lock screen is covered even if one event misbehaves.
  test.each(["pageshow", "focus"])("a %s event also catches the timer up after a background gap", (eventName) => {
    vi.useFakeTimers();
    try {
      render(
        <WorkoutSession
          day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
          onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
          equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
          resumedAt={Date.now()} priorActiveSeconds={0}
        />
      );
      const [squatCheck] = screen.getAllByLabelText("Mark set 1 done and start rest timer");
      fireEvent.click(squatCheck);
      expect(screen.getByText("60")).toBeInTheDocument();

      vi.setSystemTime(Date.now() + 45000);
      fireEvent(window, new Event(eventName));

      expect(screen.getByText("15")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test("the live elapsed-workout header catches up correctly after a background gap", () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      render(
        <WorkoutSession
          day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
          onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
          equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
          resumedAt={start} priorActiveSeconds={0}
        />
      );
      expect(screen.getByText("0:00")).toBeInTheDocument();

      vi.setSystemTime(start + 125000); // 2:05 later, no interval ticks
      fireEvent(document, new Event("visibilitychange"));

      expect(screen.getByText("2:05")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test("counts prior active seconds from a resumed (saved-and-reopened) workout, not just this stretch", () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      render(
        <WorkoutSession
          day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
          onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
          equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
          resumedAt={start} priorActiveSeconds={600} // 10 min already logged before this stretch
        />
      );
      expect(screen.getByText("10:00")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // Real ask: "I put 100 reps instead of ten, and then I change it" — and the
  // correction could still be lost. Autosave used to fire only on a checkmark
  // (plus visibilitychange/pagehide, which iOS is known not to fire reliably
  // on a swipe-to-close), so a value fixed after checking a set off wrote
  // nothing: resume brought back the typo, and the typo got logged.
  test("editing a set value autosaves it, debounced, so a correction can't be lost", () => {
    vi.useFakeTimers();
    try {
      const onAutoSave = vi.fn();
      render(
        <WorkoutSession
          day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
          onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()} onAutoSave={onAutoSave}
          equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
        />
      );
      fireEvent.click(screen.getByLabelText("Add 5 pounds to set 1"));
      // Debounced — a digit-by-digit entry mustn't be one full state write per
      // keystroke, so nothing has been saved yet.
      expect(onAutoSave).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(onAutoSave).toHaveBeenCalledTimes(1);
      expect(onAutoSave.mock.calls[0][0][0].logged[0].weight).toBe("5");
    } finally {
      vi.useRealTimers();
    }
  });

  test("several quick edits collapse into one save, carrying the latest value", () => {
    vi.useFakeTimers();
    try {
      const onAutoSave = vi.fn();
      render(
        <WorkoutSession
          day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
          onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()} onAutoSave={onAutoSave}
          equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
        />
      );
      fireEvent.click(screen.getByLabelText("Add 5 pounds to set 1"));
      vi.advanceTimersByTime(300);
      fireEvent.click(screen.getByLabelText("Add 5 pounds to set 1"));
      vi.advanceTimersByTime(1000);
      expect(onAutoSave).toHaveBeenCalledTimes(1);
      expect(onAutoSave.mock.calls[0][0][0].logged[0].weight).toBe("10");
    } finally {
      vi.useRealTimers();
    }
  });

  // A queued edit-save landing after the checkmark's immediate save would
  // overwrite newer data with older data.
  test("checking a set off cancels any pending edit save instead of letting it land afterwards", () => {
    vi.useFakeTimers();
    try {
      const onAutoSave = vi.fn();
      render(
        <WorkoutSession
          day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
          onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()} onAutoSave={onAutoSave}
          equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
        />
      );
      fireEvent.click(screen.getByLabelText("Add 5 pounds to set 1"));
      fireEvent.click(screen.getByLabelText("Mark set 1 done and start rest timer"));
      expect(onAutoSave).toHaveBeenCalledTimes(1);
      expect(onAutoSave.mock.calls[0][0][0].logged[0].done).toBe(true);
      vi.advanceTimersByTime(2000);
      expect(onAutoSave).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("shows no elapsed-time header when resumedAt isn't provided", () => {
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    expect(screen.queryByText("0:00")).not.toBeInTheDocument();
  });
});

describe("<WorkoutSession /> rest timer survives a reload/swipe-away", () => {
  const day = { name: "Full Body A", exercises: [{ name: "Back Squat", sets: 1, reps: "8-12", rest: 60, tips: ["a", "b", "c", "d"] }] };

  // Real ask: "rest timer should still be there even if you swipe out of
  // app or reload." Before this, rest lived only in local component
  // state — gone the instant the component unmounted, unlike the sets
  // themselves which already autosaved. initialRest is what a reload
  // resumes from (the same endAt-based object, handed straight back in —
  // no elapsed-time math needed since it was never paused to begin with).
  test("resumes a running rest countdown from initialRest instead of starting with no timer at all", () => {
    const endAt = Date.now() + 40000;
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        initialRest={{ endAt, total: 60 }}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    expect(screen.getByText("RESTING")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });

  test("starting a rest timer autosaves it (second onAutoSave argument), so a reload has it to restore", async () => {
    const user = userEvent.setup();
    const onAutoSave = vi.fn();
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()} onAutoSave={onAutoSave}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    await user.click(screen.getByLabelText("Mark set 1 done and start rest timer"));

    expect(onAutoSave).toHaveBeenCalledTimes(1);
    const [, savedRest] = onAutoSave.mock.calls[0];
    expect(savedRest).toMatchObject({ total: 60 });
  });

  test("adding 15s or skipping also autosaves the updated rest state", async () => {
    const user = userEvent.setup();
    const onAutoSave = vi.fn();
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()} onAutoSave={onAutoSave}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    await user.click(screen.getByLabelText("Mark set 1 done and start rest timer"));
    onAutoSave.mockClear();

    await user.click(screen.getByLabelText("Add 15 seconds to rest"));
    expect(onAutoSave).toHaveBeenCalledTimes(1);
    expect(onAutoSave.mock.calls[0][1]).toMatchObject({ total: 75 });

    await user.click(screen.getByText(/Skip/));
    expect(onAutoSave).toHaveBeenCalledTimes(2);
    expect(onAutoSave.mock.calls[1][1]).toBeNull();
  });
});

describe("<WorkoutSession /> resuming reflects a Coach change made while saved", () => {
  test("resuming with a saved snapshot of the OLD exercise still shows the NEW one from a fresh todayOverride", () => {
    // day.exercises is what the parent passes in fresh at mount time — by
    // the point a resume actually happens, this already reflects any
    // Coach-driven todayOverride/program change made while the workout sat
    // saved. initialSets is the stale save from before that change.
    const day = { name: "Leg Day", exercises: [{ name: "Barbell Hip Thrust", sets: 1, reps: "6-8", rest: 120, tips: ["a", "b", "c", "d"] }] };
    // Nothing checked off on it, so the swap replaces it outright.
    const staleSavedSets = [
      { name: "Trap Bar Deadlift", reps: "6-8", rest: 120, tips: ["a"], logged: [{ weight: "225", reps: "6", done: false }] },
    ];
    render(
      <WorkoutSession
        day={day} isOverride={true} lastLog={null} logs={{ workouts: [] }} initialSets={staleSavedSets}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    expect(screen.getByText("Barbell Hip Thrust")).toBeInTheDocument();
    expect(screen.queryByText("Trap Bar Deadlift")).not.toBeInTheDocument();
  });

  // Real report: "you just changed my whole workout and lost all my progress
  // that I had already done."
  test("a completed exercise the Coach removed stays on screen, labelled, so the sets still get logged", () => {
    const day = { name: "Leg Day", exercises: [{ name: "Barbell Hip Thrust", sets: 1, reps: "6-8", rest: 120, tips: ["a", "b", "c", "d"] }] };
    const staleSavedSets = [
      { name: "Trap Bar Deadlift", reps: "6-8", rest: 120, tips: ["a"], logged: [{ weight: "225", reps: "6", done: true }] },
    ];
    render(
      <WorkoutSession
        day={day} isOverride={true} lastLog={null} logs={{ workouts: [] }} initialSets={staleSavedSets}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    expect(screen.getByText("Barbell Hip Thrust")).toBeInTheDocument();
    expect(screen.getByText("Trap Bar Deadlift")).toBeInTheDocument();
    expect(screen.getByText(/No longer on this day/)).toBeInTheDocument();
  });
});

describe("<WorkoutSession /> logging UX: pre-fill and quick increment", () => {
  const day = { name: "Full Body A", exercises: [{ name: "Bench Press", sets: 1, reps: "8-12", rest: 90, tips: ["a", "b", "c", "d"] }] };

  test("a fresh set starts pre-filled with last time's weight/reps instead of blank", () => {
    const logs = { workouts: [{ date: "2026-08-01", exercises: [{ name: "Bench Press", logged: [{ weight: "135", reps: "8", done: true }] }] }] };
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={logs} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText("lb").value).toBe("135");
    expect(screen.getByPlaceholderText("reps").value).toBe("8");
  });

  test("an exercise with no history starts blank, same as before this feature existed", () => {
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText("lb").value).toBe("");
  });

  test("the +5 button bumps the current weight by 5 without needing to retype it", async () => {
    const user = userEvent.setup();
    const logs = { workouts: [{ date: "2026-08-01", exercises: [{ name: "Bench Press", logged: [{ weight: "135", reps: "8", done: true }] }] }] };
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={logs} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    await user.click(screen.getByLabelText("Add 5 pounds to set 1"));
    expect(screen.getByPlaceholderText("lb").value).toBe("140");
  });

  test("the +5 button works from blank (treats it as 0) rather than producing NaN", async () => {
    const user = userEvent.setup();
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    await user.click(screen.getByLabelText("Add 5 pounds to set 1"));
    expect(screen.getByPlaceholderText("lb").value).toBe("5");
  });
});

describe("<WorkoutSession /> discard requires a second, explicit confirmation", () => {
  const day = { name: "Full Body A", exercises: [{ name: "Bench Press", sets: 1, reps: "8-12", rest: 90, tips: ["a", "b", "c", "d"] }] };

  function setup(onCancel = vi.fn()) {
    const user = userEvent.setup();
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={onCancel} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    return { user, onCancel };
  }

  // Real ask: discarding used to happen on a single tap with no real "are
  // you sure" — a permanent, unrecoverable loss of everything logged this
  // session shouldn't be one accidental tap away.
  test("tapping 'Discard workout' does NOT immediately discard — shows a second confirmation first", async () => {
    const { user, onCancel } = setup();
    await user.click(screen.getByLabelText("Exit workout"));
    await user.click(screen.getByText("Discard workout"));
    expect(screen.getByText("Discard this workout?")).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  test("only calls onCancel after the second, explicit confirmation", async () => {
    const { user, onCancel } = setup();
    await user.click(screen.getByLabelText("Exit workout"));
    await user.click(screen.getByText("Discard workout"));
    await user.click(screen.getByText("Yes, discard it"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("'Keep training' on the second confirmation backs out without discarding", async () => {
    const { user, onCancel } = setup();
    await user.click(screen.getByLabelText("Exit workout"));
    await user.click(screen.getByText("Discard workout"));
    await user.click(screen.getByText("Keep training"));
    expect(screen.queryByText("Discard this workout?")).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("<WorkoutSession /> autosave on backgrounding (swipe away, lock screen, switch apps)", () => {
  const day = { name: "Full Body A", exercises: [{ name: "Bench Press", sets: 1, reps: "8-12", rest: 90, tips: ["a", "b", "c", "d"] }] };

  // Real report: progress was lost when swiping out of the app — nothing
  // persisted mid-workout except an explicit "Save & exit" tap. This
  // simulates the actual event iOS Safari fires when a PWA is suspended.
  function fireHidden() {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  test("backgrounding the app calls onAutoSave with the current sets, without exiting the workout", async () => {
    const user = userEvent.setup();
    const onAutoSave = vi.fn();
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()} onAutoSave={onAutoSave}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    await user.type(screen.getByPlaceholderText("lb"), "135");
    await user.type(screen.getByPlaceholderText("reps"), "8");

    fireHidden();

    expect(onAutoSave).toHaveBeenCalledTimes(1);
    const savedExercises = onAutoSave.mock.calls[0][0];
    expect(savedExercises[0].logged[0]).toMatchObject({ weight: "135", reps: "8" });
    // Still on the workout screen — this wasn't an exit.
    expect(screen.getByPlaceholderText("lb")).toBeInTheDocument();
  });

  // Real report: progress was STILL lost swiping out without wifi even
  // after the hide-event listener above shipped — iOS is known to not
  // reliably fire pagehide/visibilitychange for a hard app-switcher
  // swipe-to-close specifically. Saving right after the most meaningful
  // in-workout action (marking a set done) means at worst only whatever
  // happened after the LAST checkmark is ever at risk, independent of
  // whether any hide event fires at all.
  test("marking a set done also triggers an autosave immediately, independent of any hide event", async () => {
    const user = userEvent.setup();
    const onAutoSave = vi.fn();
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()} onAutoSave={onAutoSave}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    await user.type(screen.getByPlaceholderText("lb"), "135");
    await user.type(screen.getByPlaceholderText("reps"), "8");
    await user.click(screen.getByLabelText("Mark set 1 done and start rest timer"));

    expect(onAutoSave).toHaveBeenCalledTimes(1);
    const savedExercises = onAutoSave.mock.calls[0][0];
    expect(savedExercises[0].logged[0]).toMatchObject({ weight: "135", reps: "8", done: true });
  });

  test("does nothing when onAutoSave isn't provided (e.g. older callers) — never throws", () => {
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    expect(() => fireHidden()).not.toThrow();
  });
});

describe("<WorkoutSession /> demo GIF lookup", () => {
  const day = { name: "Full Body A", exercises: [{ name: "Back Squat", sets: 1, reps: "8-12", rest: 90, tips: ["a", "b", "c", "d"] }] };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup({ onCacheGif = vi.fn(), gifCache = {}, dayOverride = day } = {}) {
    const user = userEvent.setup();
    render(
      <WorkoutSession
        day={dayOverride} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
        gifCache={gifCache} onCacheGif={onCacheGif}
      />
    );
    return user;
  }

  test("opening 'How to do it' for the first time shows the GIF once the lookup resolves, and caches it by name", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gifUrl: "https://api.workoutxapp.com/v1/gifs/0201.gif", matchCount: 1 }) }));
    const onCacheGif = vi.fn();
    const user = setup({ onCacheGif });

    await user.click(screen.getByText("How to do it"));
    const img = await screen.findByAltText("Back Squat demonstration");
    // Routed through the server-side proxy (api/gif-proxy.js), not linked
    // directly at WorkoutX — a plain <img src> pointed straight at their
    // URL rendered as a broken image, since their asset URLs also need the
    // X-WorkoutX-Key auth header a browser-issued <img> request can't send.
    expect(img.src).toContain("/api/gif-proxy?url=");
    expect(img.src).toContain(encodeURIComponent("https://api.workoutxapp.com/v1/gifs/0201.gif"));
    // Keyed by normalized NAME now, not an exercise-object index — that's
    // the actual fix (see the multi-occurrence test below).
    expect(onCacheGif).toHaveBeenCalledWith("back squat", "https://api.workoutxapp.com/v1/gifs/0201.gif");
  });

  test("clicking the exercise's own name opens the same full info page, not just the 'How to do it' button", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gifUrl: "https://api.workoutxapp.com/v1/gifs/0201.gif", matchCount: 1 }) }));
    const user = setup();

    await user.click(screen.getByText("Back Squat")); // the exercise's own name/heading
    expect(await screen.findByAltText("Back Squat demonstration")).toBeInTheDocument();
    expect(screen.getByText("Form cues")).toBeInTheDocument();
  });

  test("an already-populated gifCache (from a previous session) shows the GIF immediately with no fetch at all", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const user = setup({ gifCache: { "back squat": "https://api.workoutxapp.com/v1/gifs/0201.gif" } });

    await user.click(screen.getByText("How to do it"));
    expect(await screen.findByAltText("Back Squat demonstration")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Real ask: a raw custom exercise name that declined an AI-suggested,
  // confirmed-video alternative should never show a video — even if the
  // shared, name-keyed gifCache happens to already have one for that exact
  // string (e.g. from a different, more specific exercise someone else
  // verified). This is what makes that guarantee actually hold.
  test("an exercise marked noVideoLookup never shows a video, even with one cached under that same name", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", fetchSpy);
    const dayOverride = { name: "Full Body A", exercises: [{ name: "Calf Raise", sets: 1, reps: "8-12", rest: 90, tips: ["a"] }] };
    const initialSets = [{ name: "Calf Raise", reps: "8-12", rest: 90, tips: ["a"], noVideoLookup: true, logged: [{ weight: "", reps: "", done: false }] }];
    render(
      <WorkoutSession
        day={dayOverride} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={initialSets}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
        gifCache={{ "calf raise": "https://api.workoutxapp.com/v1/gifs/9999.gif" }} onCacheGif={vi.fn()}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("How to do it"));
    expect(await screen.findByText("Instructional video unavailable for this exercise.")).toBeInTheDocument();
    expect(screen.queryByAltText("Calf Raise demonstration")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled(); // never even attempts a lookup
  });

  // No Retry here, deliberately — a confirmed "no match" isn't a glitch,
  // so retrying would just spend another shared WorkoutX request (a real
  // account-wide, not per-user, 500/month quota) on the same answer.
  test("a CONFIRMED empty match shows 'unavailable' with no Retry option", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gifUrl: null, matchCount: 0 }) }));
    const user = setup();

    await user.click(screen.getByText("How to do it"));
    expect(await screen.findByText("Instructional video unavailable for this exercise.")).toBeInTheDocument();
    expect(screen.queryByText("Retry")).not.toBeInTheDocument();
  });

  // Regression coverage for the actual real-world bug: a bad/missing key
  // (or any transient failure) used to get cached exactly like a genuine
  // "not in WorkoutX's database" result — permanently, with no way to
  // retry once the real problem was fixed. This is why the fetch had
  // stopped firing at all for exercises tested before the key was wired up.
  test("an UNCONFIRMED failure (bad key, network error) shows a different, retryable message — and is never cached", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "unauthorized" }) }));
    const onCacheGif = vi.fn();
    const user = setup({ onCacheGif });

    await user.click(screen.getByText("How to do it"));
    expect(await screen.findByText("Couldn't check for a demo right now.")).toBeInTheDocument();
    expect(screen.queryByText("Instructional video unavailable for this exercise.")).not.toBeInTheDocument();
    expect(onCacheGif).not.toHaveBeenCalled();
  });

  // Real ask: "if it can't load [the] demo because of wifi, make it say
  // that's why." A genuine connectivity failure (fetch() itself throwing)
  // gets its own specific message instead of the generic transient-error
  // one — same Retry button either way, since both are worth retrying.
  test("a genuine offline failure (fetch throws) says so specifically, not the generic message", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const user = setup();

    await user.click(screen.getByText("How to do it"));
    expect(await screen.findByText("You're offline — connect to check for a demo.")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't check for a demo right now.")).not.toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  test("closing and reopening 'How to do it' does not re-fetch — the result is cached locally too, not just persisted", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gifUrl: "https://api.workoutxapp.com/v1/gifs/0201.gif", matchCount: 1 }) });
    vi.stubGlobal("fetch", fetchSpy);
    const user = setup();

    await user.click(screen.getByText("How to do it")); // open — triggers the fetch
    await screen.findByAltText("Back Squat demonstration");
    await user.click(screen.getByText("How to do it")); // close
    await user.click(screen.getByText("How to do it")); // reopen

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // The actual real-world bug: real usage data showed "Barbell Bench Press"
  // fetched 3 separate times because the same exercise name repeated
  // across the program (extremely common — most splits hit a muscle group
  // more than once a week) had no way to know it had already been looked
  // up. This proves the fix directly: two DIFFERENT exercise entries with
  // the same name, opening both only fetches once.
  test("the same exercise name appearing more than once in the day only fetches once", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gifUrl: "https://api.workoutxapp.com/v1/gifs/0201.gif", matchCount: 1 }) });
    vi.stubGlobal("fetch", fetchSpy);
    const repeatedDay = {
      name: "Full Body A",
      exercises: [
        { name: "Back Squat", sets: 1, reps: "8-12", rest: 90, tips: ["a", "b", "c", "d"] },
        { name: "Back Squat", sets: 1, reps: "8-12", rest: 90, tips: ["a", "b", "c", "d"] },
      ],
    };
    const user = setup({ dayOverride: repeatedDay });

    const [first, second] = screen.getAllByText("How to do it");
    await user.click(first);
    await screen.findAllByAltText("Back Squat demonstration");
    await user.click(second);
    await screen.findAllByAltText("Back Squat demonstration");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Each exercise's info page is a full-screen view now (only one open at
  // a time, by design), but the two SEPARATE exercise objects sharing a
  // name should still each open their own page correctly, reusing the
  // cached GIF instantly the second time with no new fetch.
  test("a second, same-named exercise's info page opens instantly from cache, closing the first", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gifUrl: "https://api.workoutxapp.com/v1/gifs/0201.gif", matchCount: 1 }) }));
    const repeatedDay = {
      name: "Full Body A",
      exercises: [
        { name: "Back Squat", sets: 1, reps: "8-12", rest: 90, tips: ["a", "b", "c", "d"] },
        { name: "Back Squat", sets: 1, reps: "8-12", rest: 90, tips: ["a", "b", "c", "d"] },
      ],
    };
    const user = setup({ dayOverride: repeatedDay });

    const [first, second] = screen.getAllByText("How to do it");
    await user.click(first);
    await screen.findByAltText("Back Squat demonstration");
    await user.click(screen.getByLabelText("Close exercise info"));
    expect(screen.queryByAltText("Back Squat demonstration")).not.toBeInTheDocument();

    await user.click(second);
    expect(await screen.findByAltText("Back Squat demonstration")).toBeInTheDocument();
  });
});

describe("<WorkoutSession /> 'find alternative' — request my own exercise", () => {
  const day = {
    name: "Full Body A",
    exercises: [{ name: "Bench Press", sets: 1, reps: "8-12", rest: 90, tips: ["a", "b", "c", "d"], alternatives: ["Incline Dumbbell Press", "Cable Fly"] }],
  };

  function setup(onSwapExercise = vi.fn()) {
    const user = userEvent.setup();
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={onSwapExercise} onCacheAlternatives={vi.fn()}
      />
    );
    return { user, onSwapExercise };
  }

  test("'None of these' reveals a text field, separate from the suggested alternatives", async () => {
    const { user } = setup();
    await user.click(screen.getByText("Find alternative"));
    expect(screen.getByText("Incline Dumbbell Press")).toBeInTheDocument();
    await user.click(screen.getByText("None of these — request my own"));
    expect(screen.getByPlaceholderText("e.g. Cable Fly")).toBeInTheDocument();
  });

  test("typing a custom exercise and using it goes to the same confirm screen as picking a suggestion", async () => {
    const { user } = setup();
    await user.click(screen.getByText("Find alternative"));
    await user.click(screen.getByText("None of these — request my own"));
    await user.type(screen.getByPlaceholderText("e.g. Cable Fly"), "Landmine Press");
    await user.click(screen.getByText("Use this exercise"));
    // Same confirm screen every alternative goes through — today/permanent choice.
    expect(screen.getByText("Just for today")).toBeInTheDocument();
    expect(screen.getByText("Permanently, going forward")).toBeInTheDocument();
  });

  test("confirming a custom exercise calls onSwapExercise with the typed name", async () => {
    const { user, onSwapExercise } = setup();
    await user.click(screen.getByText("Find alternative"));
    await user.click(screen.getByText("None of these — request my own"));
    await user.type(screen.getByPlaceholderText("e.g. Cable Fly"), "Landmine Press");
    await user.click(screen.getByText("Use this exercise"));
    await user.click(screen.getByText("Just for today"));
    expect(onSwapExercise).toHaveBeenCalledWith(0, "Landmine Press", "today", false);
  });

  test("'Use this exercise' is disabled until something is typed", async () => {
    const { user } = setup();
    await user.click(screen.getByText("Find alternative"));
    await user.click(screen.getByText("None of these — request my own"));
    expect(screen.getByText("Use this exercise")).toBeDisabled();
    await user.type(screen.getByPlaceholderText("e.g. Cable Fly"), "Landmine Press");
    expect(screen.getByText("Use this exercise")).not.toBeDisabled();
  });

  // Real ask: "explain that their own won't have an instructional video."
  describe("checks the real catalog before committing to a typed-in exercise", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test("a confirmed no-match shows a warning and requires a second, explicit tap before swapping", async () => {
      vi.stubGlobal("navigator", { onLine: true });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gifUrl: null, matchCount: 0 }) }));
      const { user, onSwapExercise } = setup();
      await user.click(screen.getByText("Find alternative"));
      await user.click(screen.getByText("None of these — request my own"));
      await user.type(screen.getByPlaceholderText("e.g. Cable Fly"), "Made-Up Exercise");

      await user.click(screen.getByText("Use this exercise"));
      expect(await screen.findByText(/doesn't have an instructional video available/)).toBeInTheDocument();
      expect(screen.queryByText("Just for today")).not.toBeInTheDocument(); // not swapped yet

      await user.click(screen.getByText("Use it anyway"));
      await user.click(screen.getByText("Just for today"));
      expect(onSwapExercise).toHaveBeenCalledWith(0, "Made-Up Exercise", "today", false);
    });

    test("a confirmed real match proceeds straight through with no warning", async () => {
      vi.stubGlobal("navigator", { onLine: true });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gifUrl: "https://api.workoutxapp.com/v1/gifs/0300.gif", matchCount: 1 }) }));
      const { user } = setup();
      await user.click(screen.getByText("Find alternative"));
      await user.click(screen.getByText("None of these — request my own"));
      await user.type(screen.getByPlaceholderText("e.g. Cable Fly"), "Cable Fly");

      await user.click(screen.getByText("Use this exercise"));
      expect(await screen.findByText("Just for today")).toBeInTheDocument();
      expect(screen.queryByText(/doesn't have an instructional video/)).not.toBeInTheDocument();
    });

    test("editing the name after a warning clears it, requiring a fresh check", async () => {
      vi.stubGlobal("navigator", { onLine: true });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gifUrl: null, matchCount: 0 }) }));
      const { user } = setup();
      await user.click(screen.getByText("Find alternative"));
      await user.click(screen.getByText("None of these — request my own"));
      await user.type(screen.getByPlaceholderText("e.g. Cable Fly"), "Made-Up Exercise");
      await user.click(screen.getByText("Use this exercise"));
      await screen.findByText(/doesn't have an instructional video/);

      await user.type(screen.getByPlaceholderText("e.g. Cable Fly"), "!");
      expect(screen.queryByText(/doesn't have an instructional video/)).not.toBeInTheDocument();
      expect(screen.getByText("Use this exercise")).toBeInTheDocument(); // back to the normal label
    });

    // Real ask: "the ai should give you similar exercises so it can use
    // the video" — a generic typed name (e.g. "calf raise") shouldn't
    // silently borrow whichever specific variant WorkoutX's fuzzy matcher
    // happened to guess; it should offer a specific, confirmed alternative
    // instead.
    test("a fuzzy-only match offers a specific AI-suggested alternative instead of proceeding silently", async () => {
      vi.stubGlobal("navigator", { onLine: true });
      vi.stubGlobal("fetch", vi.fn((url) => {
        const u = String(url);
        if (u.includes("/api/exercise-gif")) {
          if (u.includes("Standing")) {
            return Promise.resolve({ ok: true, json: async () => ({ gifUrl: "https://api.workoutxapp.com/v1/gifs/exact.gif", matchCount: 1, source: "cache" }) });
          }
          return Promise.resolve({ ok: true, json: async () => ({ gifUrl: "https://api.workoutxapp.com/v1/gifs/fuzzy.gif", matchCount: 1, source: "fuzzy-cache" }) });
        }
        if (u.includes("/api/exercise-alternatives")) {
          return Promise.resolve({ ok: true, json: async () => ({ alternatives: ["Standing Calf Raise"] }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }));
      const { user } = setup();
      await user.click(screen.getByText("Find alternative"));
      await user.click(screen.getByText("None of these — request my own"));
      await user.type(screen.getByPlaceholderText("e.g. Cable Fly"), "Calf Raise");
      await user.click(screen.getByText("Use this exercise"));

      expect(await screen.findByText('Use "Standing Calf Raise" instead')).toBeInTheDocument();
      expect(screen.queryByText("Just for today")).not.toBeInTheDocument(); // not swapped yet
    });

    test("declining the suggestion keeps the typed name, but marks it to never show a (possibly wrong) video", async () => {
      vi.stubGlobal("navigator", { onLine: true });
      vi.stubGlobal("fetch", vi.fn((url) => {
        const u = String(url);
        if (u.includes("/api/exercise-gif")) {
          if (u.includes("Standing")) {
            return Promise.resolve({ ok: true, json: async () => ({ gifUrl: "https://api.workoutxapp.com/v1/gifs/exact.gif", matchCount: 1, source: "cache" }) });
          }
          return Promise.resolve({ ok: true, json: async () => ({ gifUrl: "https://api.workoutxapp.com/v1/gifs/fuzzy.gif", matchCount: 1, source: "fuzzy-cache" }) });
        }
        if (u.includes("/api/exercise-alternatives")) {
          return Promise.resolve({ ok: true, json: async () => ({ alternatives: ["Standing Calf Raise"] }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }));
      const { user, onSwapExercise } = setup();
      await user.click(screen.getByText("Find alternative"));
      await user.click(screen.getByText("None of these — request my own"));
      await user.type(screen.getByPlaceholderText("e.g. Cable Fly"), "Calf Raise");
      await user.click(screen.getByText("Use this exercise"));
      await screen.findByText('Use "Standing Calf Raise" instead');

      await user.click(screen.getByText('Use "Calf Raise" as typed'));
      await user.click(screen.getByText("Just for today"));
      expect(onSwapExercise).toHaveBeenCalledWith(0, "Calf Raise", "today", true);
    });
  });
});

describe("<WorkoutSession /> 'find alternative' — instant quick suggestions, background upgrade", () => {
  // "Bench Press" has no baked-in alternatives, but IS classifiable by the
  // offline pool (chest) — real ask: "takes a little too long to find
  // alternative workout." This should show something usable immediately,
  // not wait on the live AI round-trip.
  const day = { name: "Full Body A", exercises: [{ name: "Bench Press", sets: 1, reps: "8-12", rest: 90, tips: ["a", "b", "c", "d"] }] };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup() {
    const user = userEvent.setup();
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    return user;
  }

  test("shows real pool-based suggestions immediately, before the live lookup ever resolves", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    // Never resolves within this test — proves the list isn't waiting on it.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const user = setup();

    await user.click(screen.getByText("Find alternative"));
    // No "Finding similar exercises…" blocking spinner anymore.
    expect(screen.queryByText(/Finding similar exercises/)).not.toBeInTheDocument();
    expect(screen.getByText("Incline Dumbbell Press")).toBeInTheDocument();
    expect(screen.getByText("Finding more tailored suggestions…")).toBeInTheDocument();
  });

  test("silently upgrades to the AI's suggestions once the background lookup resolves", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ alternatives: ["Landmine Press"] }),
    }));
    const user = setup();

    await user.click(screen.getByText("Find alternative"));
    // Quick suggestion shows first, then the list upgrades in place —
    // findBy rather than a synchronous check since a fast-resolving mock
    // can settle within the same act() cycle as the click itself.
    expect(await screen.findByText(/Incline Dumbbell Press|Landmine Press/)).toBeInTheDocument();
    expect(await screen.findByText("Landmine Press")).toBeInTheDocument(); // upgraded in place
    expect(screen.queryByText("Finding more tailored suggestions…")).not.toBeInTheDocument();
  });

  test("a background lookup that goes offline just keeps the quick suggestions on screen, no error shown", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const user = setup();

    await user.click(screen.getByText("Find alternative"));
    expect(screen.getByText("Incline Dumbbell Press")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Finding more tailored suggestions…")).not.toBeInTheDocument());
    expect(screen.getByText("Incline Dumbbell Press")).toBeInTheDocument(); // still there, undisturbed
    expect(screen.queryByText(/Needs a connection/)).not.toBeInTheDocument();
  });
});

describe("<WorkoutSession /> 'find alternative' — empty result and retry", () => {
  // No baked-in alternatives here — forces the live lookup path. Named so
  // the offline pool fallback (alternativesFor) ALSO can't classify it —
  // otherwise it'd quietly succeed via that fallback and never actually
  // reach the truly-empty state this test means to cover.
  const day = { name: "Full Body A", exercises: [{ name: "Landmine Twist", sets: 1, reps: "8-12", rest: 90, tips: ["a", "b", "c", "d"] }] };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup() {
    const user = userEvent.setup();
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    return user;
  }

  // Real report: this used to read "No alternatives available for this
  // exercise with your current equipment" — sounding like a hard,
  // permanent equipment limitation, when an empty live lookup is often
  // just a transient AI hiccup. The "request my own" option was already
  // there either way; this covers the softer wording and the new retry.
  test("an empty live lookup shows a softer message with a working Retry, not a hard equipment claim", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alternatives: [] }) }));
    const user = setup();

    await user.click(screen.getByText("Find alternative"));
    expect(await screen.findByText("Couldn't find a suggested alternative for this one.")).toBeInTheDocument();
    expect(screen.queryByText(/No alternatives available/)).not.toBeInTheDocument();
    expect(screen.getByText("None of these — request my own")).toBeInTheDocument(); // still there either way
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  test("clicking Try again re-runs the lookup and shows real suggestions if the retry succeeds", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ alternatives: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ alternatives: ["Incline Dumbbell Press"] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const user = setup();

    await user.click(screen.getByText("Find alternative"));
    await screen.findByText("Try again");
    await user.click(screen.getByText("Try again"));
    expect(await screen.findByText("Incline Dumbbell Press")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // Real ask: "if there's no wifi and the ai can't think of it, it says
  // needs wifi to find alternatives... and leave the option to choose
  // your own." A genuine connectivity failure must NOT quietly fall back
  // to the offline pool (a coarser, sometimes-duplicate-prone guess) —
  // it should say plainly that it needs a connection, while "request my
  // own" stays available either way.
  test("a genuine offline failure says it needs a connection, and does NOT fall back to the offline pool", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const user = setup();

    await user.click(screen.getByText("Find alternative"));
    expect(await screen.findByText("Needs a connection to find alternatives — you're offline right now.")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't find a suggested alternative for this one.")).not.toBeInTheDocument();
    expect(screen.getByText("None of these — request my own")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  test("a non-connectivity failure (bad response) still falls back to the offline pool as before", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    // "Landmine Twist" is deliberately unclassifiable by the offline pool
    // too, so this exercise specifically has nothing to fall back to —
    // proving the empty state here is the generic message, not the
    // offline-specific one, even though fetch itself never threw.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "server error" }) }));
    const user = setup();

    await user.click(screen.getByText("Find alternative"));
    expect(await screen.findByText("Couldn't find a suggested alternative for this one.")).toBeInTheDocument();
    expect(screen.queryByText(/Needs a connection/)).not.toBeInTheDocument();
  });
});

describe("<WorkoutSession /> 'Talk to the Coach' from the alternatives picker", () => {
  const day = { name: "Full Body A", exercises: [{ name: "Bench Press", sets: 1, reps: "8-12", rest: 90, tips: ["a", "b", "c", "d"], alternatives: ["Incline Dumbbell Press", "Cable Fly"] }] };

  test("shows the prompt once real alternatives are showing, and hands the current sets to onGoToCoach", async () => {
    const user = userEvent.setup();
    const onGoToCoach = vi.fn();
    render(
      <WorkoutSession
        day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
        onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()} onGoToCoach={onGoToCoach}
        equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()}
      />
    );
    await user.click(screen.getByText("Find alternative"));
    const prompt = await screen.findByText("Talk to the Coach about other options");
    await user.click(prompt);
    expect(onGoToCoach).toHaveBeenCalledTimes(1);
    expect(Array.isArray(onGoToCoach.mock.calls[0][0])).toBe(true); // the current sets array
  });
});

describe("<Home /> Coach insight card", () => {
  function baseState(overrides = {}) {
    return {
      program: { splitName: "Full Body", days: [{ name: "Full Body A", exercises: [{ name: "Back Squat" }] }] },
      targets: { calories: 2200, protein: 160, carbs: 220, fat: 70 },
      logs: { workouts: [], nutrition: [] },
      profile: { daysPerWeek: 3, sessionLength: 45 },
      ...overrides,
    };
  }

  // Adherence/schedule nudges were removed entirely (explicit user
  // preference — see detectCoachInsight in App.jsx), so this card is now
  // exercised via a duration-overrun insight instead, the next one in
  // detectCoachInsight's priority order.
  function durationOverrunState() {
    const daysAgo = (n) => dateToISO(new Date(Date.now() - n * 86400000));
    return baseState({
      profile: { daysPerWeek: 4, sessionLength: 30 },
      logs: {
        workouts: [
          { date: daysAgo(1), exercises: [], durationSec: 2700 },
          { date: daysAgo(8), exercises: [], durationSec: 2700 },
          { date: daysAgo(15), exercises: [], durationSec: 2700 },
        ],
        nutrition: [],
      },
    });
  }

  test("shows a Coach insight card when one applies, and Ask Coach sends it through", async () => {
    const user = userEvent.setup();
    const onAskCoach = vi.fn();
    render(<Home state={durationOverrunState()} setActiveTab={vi.fn()} startWorkout={vi.fn()} onAskCoach={onAskCoach} />);
    expect(screen.getByText("COACH NOTICED")).toBeInTheDocument();
    await user.click(screen.getByText("Ask Coach"));
    expect(onAskCoach).toHaveBeenCalledTimes(1);
    expect(typeof onAskCoach.mock.calls[0][0]).toBe("string");
  });

  test("dismissing the insight card hides it", async () => {
    const user = userEvent.setup();
    render(<Home state={durationOverrunState()} setActiveTab={vi.fn()} startWorkout={vi.fn()} onAskCoach={vi.fn()} />);
    expect(screen.getByText("COACH NOTICED")).toBeInTheDocument();
    await user.click(screen.getByText("Dismiss"));
    expect(screen.queryByText("COACH NOTICED")).not.toBeInTheDocument();
  });

  test("shows no insight card for a healthy state with nothing to flag", () => {
    render(<Home state={baseState()} setActiveTab={vi.fn()} startWorkout={vi.fn()} onAskCoach={vi.fn()} />);
    expect(screen.queryByText("COACH NOTICED")).not.toBeInTheDocument();
  });

  // Real report: the "Next workout" preview kept showing the stale
  // scheduled day (name AND exercise count) after a Coach todayOverride
  // swap, so a person saw "Push" on Home and found a leg session once
  // they actually started the workout.
  test("the next-workout preview reflects a Coach todayOverride, not the stale scheduled day", () => {
    const state = baseState({
      program: { splitName: "Push / Pull / Legs", days: [{ name: "Push", exercises: [{ name: "Bench Press" }, { name: "Overhead Press" }] }] },
      todayOverride: [{ name: "Back Squat" }, { name: "Romanian Deadlift" }, { name: "Leg Press" }],
    });
    render(<Home state={state} setActiveTab={vi.fn()} startWorkout={vi.fn()} onAskCoach={vi.fn()} />);
    expect(screen.getByText("Leg Day")).toBeInTheDocument();
    expect(screen.queryByText("Push")).not.toBeInTheDocument();
    expect(screen.getByText("3 exercises")).toBeInTheDocument();
  });
});

describe("<Home /> review-ready banner", () => {
  function baseState(overrides = {}) {
    return {
      program: { splitName: "Full Body", days: [{ name: "Full Body A", exercises: [{ name: "Back Squat" }] }] },
      targets: { calories: 2200, protein: 160, carbs: 220, fat: 70 },
      logs: { workouts: [], nutrition: [] },
      profile: { daysPerWeek: 3, sessionLength: 45 },
      reviews: { weekly: [], monthly: [] },
      ...overrides,
    };
  }

  test("shows nothing when there are no reviews at all", () => {
    render(<Home state={baseState()} setActiveTab={vi.fn()} startWorkout={vi.fn()} onAskCoach={vi.fn()} />);
    expect(screen.queryByText(/review is ready|reviews are ready/)).not.toBeInTheDocument();
  });

  test("shows nothing when every generated review has already been seen", () => {
    const state = baseState({ reviews: { weekly: [{ generatedAt: "2026-08-01", summary: {}, overview: "x", advice: [], seen: true }], monthly: [] } });
    render(<Home state={state} setActiveTab={vi.fn()} startWorkout={vi.fn()} onAskCoach={vi.fn()} />);
    expect(screen.queryByText(/review is ready/)).not.toBeInTheDocument();
  });

  test("shows a banner and switches to Progress when an unseen review exists", async () => {
    const user = userEvent.setup();
    const setActiveTab = vi.fn();
    const state = baseState({ reviews: { weekly: [{ generatedAt: "2026-08-01", summary: {}, overview: "x", advice: [], seen: false }], monthly: [] } });
    render(<Home state={state} setActiveTab={setActiveTab} startWorkout={vi.fn()} onAskCoach={vi.fn()} />);
    const banner = screen.getByText(/Your weekly review is ready/);
    expect(banner).toBeInTheDocument();
    await user.click(banner);
    expect(setActiveTab).toHaveBeenCalledWith("progress");
  });
});

describe("<Onboarding /> injuries step — 'Other' merged in, not a separate question", () => {
  // Clicks through every step ahead of injuries with a minimal valid
  // answer at each — proves there's no longer a separate "any other
  // injuries" question between it and the notes step that now follows it.
  async function goToInjuriesStep(user) {
    await user.click(screen.getByText("Start the quiz"));
    await user.click(screen.getByText("Male"));
    await user.click(screen.getByText("Next"));
    await user.type(screen.getByPlaceholderText("e.g. 28"), "28");
    await user.click(screen.getByText("Next"));
    await user.click(screen.getByText("Next")); // height — defaults are fine
    await user.type(screen.getByPlaceholderText("e.g. 165"), "180");
    await user.click(screen.getByText("Next"));
    await user.click(screen.getByText("Lose Fat"));
    await user.click(screen.getByText("Next"));
    await user.click(screen.getByText("Average build, some muscle"));
    await user.click(screen.getByText("Next"));
    await user.click(screen.getByText("Next")); // desiredPhysique — optional
    await user.click(screen.getByText("Next")); // specificGoals — optional
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
  }

  // The two food questions sit between notes and review cadence — see
  // QUIZ_STEPS. Both are skippable, so walking past them is two taps.
  async function skipFoodSteps(user) {
    expect(screen.getByText("Any foods you can't or won't eat?")).toBeInTheDocument();
    await user.click(screen.getByText("Next"));
    expect(screen.getByText("What do you actually like to eat?")).toBeInTheDocument();
    await user.click(screen.getByText("Next"));
  }

  test("no separate 'other injuries' question follows the injuries step", async () => {
    const user = userEvent.setup();
    render(<Onboarding onComplete={vi.fn()} />);
    await goToInjuriesStep(user);
    expect(screen.getByText("Any injuries or areas we should train around?")).toBeInTheDocument();
  });

  test("selecting 'Other' reveals an inline text box right there, instead of a whole separate step", async () => {
    const user = userEvent.setup();
    render(<Onboarding onComplete={vi.fn()} />);
    await goToInjuriesStep(user);
    expect(screen.queryByPlaceholderText(/Describe in your own words/)).not.toBeInTheDocument();
    await user.click(screen.getByText("Other"));
    expect(screen.getByPlaceholderText(/Describe in your own words/)).toBeInTheDocument();
  });

  test("unchecking 'Other' clears whatever was typed and hides the box again", async () => {
    const user = userEvent.setup();
    render(<Onboarding onComplete={vi.fn()} />);
    await goToInjuriesStep(user);
    await user.click(screen.getByText("Other"));
    const box = screen.getByPlaceholderText(/Describe in your own words/);
    await user.type(box, "torn labrum");
    expect(box.value).toBe("torn labrum");

    await user.click(screen.getByText("Other")); // uncheck
    expect(screen.queryByPlaceholderText(/Describe in your own words/)).not.toBeInTheDocument();

    await user.click(screen.getByText("Other")); // re-check
    expect(screen.getByPlaceholderText(/Describe in your own words/).value).toBe("");
  });

  test("notes is optional — the next step (review cadence) shows without typing anything", async () => {
    const user = userEvent.setup();
    render(<Onboarding onComplete={vi.fn()} />);
    await goToInjuriesStep(user);
    await user.click(screen.getByText("None"));
    await user.click(screen.getByText("Next"));
    expect(screen.getByText("Anything else your coach should know?")).toBeInTheDocument();
    await user.click(screen.getByText("Next"));
    await skipFoodSteps(user);
    expect(screen.getByText("Want periodic AI check-ins on your progress?")).toBeInTheDocument();
  });

  test("review cadence is the actual final step, and it's optional too — 'Build my plan' shows without picking either", async () => {
    const user = userEvent.setup();
    render(<Onboarding onComplete={vi.fn()} />);
    await goToInjuriesStep(user);
    await user.click(screen.getByText("None"));
    await user.click(screen.getByText("Next")); // -> notes
    await user.click(screen.getByText("Next")); // -> food restrictions
    await skipFoodSteps(user);
    expect(screen.getByText("Build my plan")).toBeInTheDocument();
  });

  // Real report: "the AI suggestions for what to eat aren't great" — nothing
  // in the app knew anything about what the person eats.
  test("both food questions are skippable, so they can't cost a signup", async () => {
    const user = userEvent.setup();
    render(<Onboarding onComplete={vi.fn()} />);
    await goToInjuriesStep(user);
    await user.click(screen.getByText("None"));
    await user.click(screen.getByText("Next")); // -> notes
    await user.click(screen.getByText("Next")); // -> food restrictions
    // Nothing selected, nothing typed, and Next is still available on both.
    await skipFoodSteps(user);
    expect(screen.getByText("Want periodic AI check-ins on your progress?")).toBeInTheDocument();
  });

  test("the food-restrictions step uses its own 'No restrictions' wording, not 'None'", async () => {
    const user = userEvent.setup();
    render(<Onboarding onComplete={vi.fn()} />);
    await goToInjuriesStep(user);
    await user.click(screen.getByText("None"));
    await user.click(screen.getByText("Next")); // -> notes
    await user.click(screen.getByText("Next")); // -> food restrictions
    // Sharing the label "None" with the injuries step would make either the
    // app's own copy or a test ambiguous about which question is answered.
    expect(screen.getByText("No restrictions")).toBeInTheDocument();
    expect(screen.queryByText("None")).not.toBeInTheDocument();
  });

  test("'Other' on the food step reveals its own box, separate from the injuries one", async () => {
    const user = userEvent.setup();
    render(<Onboarding onComplete={vi.fn()} />);
    await goToInjuriesStep(user);
    await user.click(screen.getByText("None"));
    await user.click(screen.getByText("Next")); // -> notes
    await user.click(screen.getByText("Next")); // -> food restrictions
    expect(screen.queryByPlaceholderText(/shellfish allergy/)).not.toBeInTheDocument();
    await user.click(screen.getByText("Other"));
    const box = screen.getByPlaceholderText(/shellfish allergy/);
    await user.type(box, "lactose intolerant");
    expect(box.value).toBe("lactose intolerant");
    await user.click(screen.getByText("Other")); // uncheck clears it
    expect(screen.queryByPlaceholderText(/shellfish allergy/)).not.toBeInTheDocument();
  });

  test("whatever's typed in the notes step ends up on the built profile", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} />);
    await goToInjuriesStep(user);
    await user.click(screen.getByText("None"));
    await user.click(screen.getByText("Next"));
    await user.type(screen.getByPlaceholderText(/Prefer an upper\/lower split/), "No pull-up bar at my gym");
    await user.click(screen.getByText("Next"));
    await skipFoodSteps(user);
    await user.click(screen.getByText("Build my plan"));
    // Program building falls back to the offline generator in this test
    // env (no real network) and lands on the summary screen next, same as
    // the rest of this quiz flow.
    expect(await screen.findByText(/Let's go/)).toBeInTheDocument();
  });

  test("picking weekly and/or monthly review checkboxes doesn't block finishing the quiz", async () => {
    const user = userEvent.setup();
    render(<Onboarding onComplete={vi.fn()} />);
    await goToInjuriesStep(user);
    await user.click(screen.getByText("None"));
    await user.click(screen.getByText("Next")); // -> notes
    await user.click(screen.getByText("Next")); // -> food restrictions
    await skipFoodSteps(user);
    await user.click(screen.getByText("Weekly review"));
    await user.click(screen.getByText("Monthly review"));
    expect(screen.getByText("Build my plan")).toBeInTheDocument();
  });
});

// Real ask: "make it so people can go back and edit their quiz results without
// resetting all their progress. if they change their quiz results that makes
// their diet or workout need to change, then they will confirm or deny/reject
// those changes."
describe("<QuizEditor />", () => {
  const profile = {
    sex: "male", age: 28, heightIn: 70, weightLb: 165, goal: "build",
    currentPhysique: "average", desiredPhysique: "lean and athletic", specificGoals: "",
    experience: "intermediate", equipment: "full", daysPerWeek: 3, sessionLength: 60,
    activity: "light", injuries: ["none"], otherInjuries: "", diet: [], otherDiet: "",
    foodPrefs: "", notes: "",
  };
  const targets = { calories: 2600, protein: 165, carbs: 300, fat: 72 };

  function open(overrides = {}) {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<QuizEditor profile={{ ...profile, ...overrides }} targets={targets} onSave={onSave} onCancel={onCancel} />);
    return { onSave, onCancel };
  }

  test("every question is on one screen, pre-filled — not an 18-step wizard again", () => {
    open();
    expect(screen.getByText("What's your main goal?")).toBeInTheDocument();
    expect(screen.getByText("What equipment do you have?")).toBeInTheDocument();
    expect(screen.getByLabelText("What's your current weight?").value).toBe("165");
    expect(screen.getByLabelText("Height ft").value).toBe("5");
    expect(screen.getByLabelText("Height in").value).toBe("10");
    // The review-cadence question isn't a profile answer — it has its own
    // toggles in Settings and shouldn't be duplicated here.
    expect(screen.queryByText("Want periodic AI check-ins on your progress?")).not.toBeInTheDocument();
  });

  test("with nothing edited there's nothing to review", () => {
    open();
    expect(screen.getByText("No changes yet")).toBeInTheDocument();
  });

  test("editing weight offers the new numbers, and saves them when accepted", async () => {
    const user = userEvent.setup();
    const { onSave } = open();
    const weight = screen.getByLabelText("What's your current weight?");
    await user.clear(weight);
    await user.type(weight, "185");
    await user.click(screen.getByText("Review changes"));

    expect(screen.getByText(/You changed your weight/)).toBeInTheDocument();
    expect(screen.getByText("2600")).toBeInTheDocument(); // the old number, struck through
    await user.click(screen.getByText("Save changes"));
    expect(onSave).toHaveBeenCalledTimes(1);
    const [savedProfile, choices] = onSave.mock.calls[0];
    expect(savedProfile.weightLb).toBe(185);
    expect(choices.applyTargets).toBe(true);
    expect(choices.rebuildProgram).toBe(false);
  });

  test("rejecting the new numbers still saves the answer — that part isn't optional", async () => {
    const user = userEvent.setup();
    const { onSave } = open();
    const weight = screen.getByLabelText("What's your current weight?");
    await user.clear(weight);
    await user.type(weight, "185");
    await user.click(screen.getByText("Review changes"));
    await user.click(screen.getByText("Keep mine"));
    await user.click(screen.getByText("Save changes"));

    const [savedProfile, choices] = onSave.mock.calls[0];
    expect(savedProfile.weightLb).toBe(185); // the fact is saved
    expect(choices.applyTargets).toBe(false); // the derived numbers are not
  });

  test("changing equipment offers a program rebuild, and defaults to NOT rebuilding", async () => {
    const user = userEvent.setup();
    const { onSave } = open();
    await user.click(screen.getByText("Dumbbells Only"));
    await user.click(screen.getByText("Review changes"));

    expect(screen.getByText(/You changed your equipment/)).toBeInTheDocument();
    // Replacing someone's program is the destructive option, so it is never
    // the pre-selected one.
    await user.click(screen.getByText("Save changes"));
    expect(onSave.mock.calls[0][1].rebuildProgram).toBe(false);
  });

  test("accepting the rebuild passes that through", async () => {
    const user = userEvent.setup();
    const { onSave } = open();
    await user.click(screen.getByText("Dumbbells Only"));
    await user.click(screen.getByText("Review changes"));
    await user.click(screen.getByText("Rebuild it"));
    await user.click(screen.getByText("Save changes"));
    expect(onSave.mock.calls[0][1].rebuildProgram).toBe(true);
  });

  test("the review screen promises logged data is safe, because that's the actual worry", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByText("Lose Fat"));
    await user.click(screen.getByText("Review changes"));
    expect(screen.getByText(/weigh-ins, meals and workout history all stay exactly as they are/)).toBeInTheDocument();
  });

  test("a change with no knock-on effect says so instead of inventing one", async () => {
    const user = userEvent.setup();
    const { onSave } = open();
    await user.type(screen.getByLabelText("Anything else your coach should know?"), "no cable machine at my gym");
    await user.click(screen.getByText("Review changes"));
    expect(screen.getByText(/Nothing else needs to change/)).toBeInTheDocument();
    await user.click(screen.getByText("Save changes"));
    expect(onSave.mock.calls[0][1]).toEqual({ applyTargets: false, rebuildProgram: false });
  });

  test("Back returns to the form with edits intact", async () => {
    const user = userEvent.setup();
    open();
    const weight = screen.getByLabelText("What's your current weight?");
    await user.clear(weight);
    await user.type(weight, "185");
    await user.click(screen.getByText("Review changes"));
    await user.click(screen.getByText("Back"));
    expect(screen.getByLabelText("What's your current weight?").value).toBe("185");
  });

  test("Cancel discards without saving anything", async () => {
    const user = userEvent.setup();
    const { onSave, onCancel } = open();
    await user.click(screen.getByText("Dumbbells Only"));
    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  test("dietary restrictions are editable here too, including the Other box", async () => {
    const user = userEvent.setup();
    const { onSave } = open();
    await user.click(screen.getByText("No dairy"));
    await user.click(screen.getByText("Review changes"));
    await user.click(screen.getByText("Save changes"));
    expect(onSave.mock.calls[0][0].diet).toContain("dairy_free");
  });
});

/* ============================================================
   ROOT APP SMOKE TEST
   Every other test in this file renders a sub-component directly, so
   none of them exercise the top-level App component's own hook body at
   all. That gap let a real bug ship straight to production: a useEffect
   near the top of App() read the `state` variable (both in its body and
   its dependency array) before the `const [state, setState] = useState()`
   line further down had run — a plain "Cannot access 'state' before
   initialization" ReferenceError, thrown on every single render, for
   every user, unconditionally. It reached users because nothing in this
   suite ever mounted <App /> itself to notice.
============================================================ */
describe("<App /> smoke test", () => {
  test("mounts a logged-out session without hitting the ErrorBoundary fallback", async () => {
    render(<App />);
    // A real render-phase crash here shows the ErrorBoundary's fallback
    // screen — assert we land on the real sign-up screen instead.
    expect(await screen.findByText("Create your account")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
  });
});
