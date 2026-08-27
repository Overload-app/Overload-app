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
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Login, ProfileTab, Progress, Coach, ConfirmEmailScreen, EmailConfirmedScreen, WorkoutSession, OnboardingSummary, Onboarding, Home, WorkoutHistoryEditor, dateToISO, todayISO } from "./App.jsx";

// jsdom doesn't implement ResizeObserver, which recharts' <ResponsiveContainer>
// needs — this is a test-environment gap, not something the app is missing.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

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

  test("continuing calls onContinue", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<OnboardingSummary profile={profile} program={program} targets={targets} onContinue={onContinue} />);
    await user.click(screen.getByText(/Let's go/));
    expect(onContinue).toHaveBeenCalledTimes(1);
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

describe("<WorkoutSession /> resuming reflects a Coach change made while saved", () => {
  test("resuming with a saved snapshot of the OLD exercise still shows the NEW one from a fresh todayOverride", () => {
    // day.exercises is what the parent passes in fresh at mount time — by
    // the point a resume actually happens, this already reflects any
    // Coach-driven todayOverride/program change made while the workout sat
    // saved. initialSets is the stale save from before that change.
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
    expect(screen.queryByText("Trap Bar Deadlift")).not.toBeInTheDocument();
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
    expect(onSwapExercise).toHaveBeenCalledWith(0, "Landmine Press", "today");
  });

  test("'Use this exercise' is disabled until something is typed", async () => {
    const { user } = setup();
    await user.click(screen.getByText("Find alternative"));
    await user.click(screen.getByText("None of these — request my own"));
    expect(screen.getByText("Use this exercise")).toBeDisabled();
    await user.type(screen.getByPlaceholderText("e.g. Cable Fly"), "Landmine Press");
    expect(screen.getByText("Use this exercise")).not.toBeDisabled();
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

describe("<Onboarding /> injuries step — 'Other' merged in, not a separate question", () => {
  // Clicks through every step ahead of injuries (the quiz's last step) with
  // a minimal valid answer at each — proves there's no longer a separate
  // "any other injuries" question between it and "Build my plan".
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

  test("injuries is the final quiz step — no separate 'other injuries' question follows it", async () => {
    const user = userEvent.setup();
    render(<Onboarding onComplete={vi.fn()} />);
    await goToInjuriesStep(user);
    expect(screen.getByText("Any injuries or areas we should train around?")).toBeInTheDocument();
    expect(screen.getByText("Build my plan")).toBeInTheDocument(); // only shown on the last step
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
});
