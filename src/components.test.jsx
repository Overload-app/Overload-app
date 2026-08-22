// @vitest-environment jsdom
//
// Component/interaction tests — a different, complementary layer to
// App.test.js's pure-logic tests. Those verify the math and data
// transformations are correct; these verify the actual screens behave
// correctly when a person clicks, types, and submits — the category of
// bug logic tests structurally can't catch (e.g. a button wired to the
// wrong handler, a confirm dialog that doesn't actually block the action,
// an index bug in a delete button).
import { describe, test, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Login, ProfileTab, Progress, Coach, ConfirmEmailScreen, EmailConfirmedScreen, todayISO } from "./App.jsx";

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
