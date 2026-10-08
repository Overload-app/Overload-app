// @vitest-environment jsdom
//
// Real ask: rest-timer alerts. The chime is scheduled on the audio clock at
// the moment a set is checked off (the tap browsers require before playing
// sound), moved when +15s is tapped, and cancelled on skip or leaving.
import { describe, test, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("./restChime.js", () => ({
  scheduleRestChime: vi.fn(),
  cancelRestChime: vi.fn(),
  buzzRestDone: vi.fn(),
  isRestChimeMuted: vi.fn(() => false),
  setRestChimeMuted: vi.fn(),
}));
vi.mock("./supabaseClient.js", () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) },
    from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }), insert: vi.fn().mockResolvedValue({}), upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockReturnThis() })),
  },
}));
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const chime = await import("./restChime.js");
const { WorkoutSession } = await import("./App.jsx");

const day = { name: "Push", exercises: [{ name: "Bench Press", sets: 2, reps: "8", rest: 90, tips: ["a"] }] };
function open() {
  return render(
    <WorkoutSession day={day} isOverride={false} lastLog={null} logs={{ workouts: [] }} initialSets={null}
      onFinish={vi.fn()} onCancel={vi.fn()} onSaveExit={vi.fn()} onAutoSave={vi.fn()}
      equipment="full" injuries={[]} onSwapExercise={vi.fn()} onCacheAlternatives={vi.fn()} />
  );
}

describe("rest-timer chime", () => {
  beforeEach(() => vi.clearAllMocks());

  test("checking off a set schedules the chime for the end of that exercise's rest", () => {
    open();
    fireEvent.click(screen.getByLabelText("Mark set 1 done and start rest timer"));
    expect(chime.scheduleRestChime).toHaveBeenCalledWith(90);
  });

  test("+15s moves the chime later", () => {
    open();
    fireEvent.click(screen.getByLabelText("Mark set 1 done and start rest timer"));
    fireEvent.click(screen.getByLabelText("Add 15 seconds to rest"));
    const [secs] = chime.scheduleRestChime.mock.calls.at(-1);
    expect(secs).toBeGreaterThan(100);
    expect(secs).toBeLessThanOrEqual(105);
  });

  test("skipping the rest cancels the chime", () => {
    open();
    fireEvent.click(screen.getByLabelText("Mark set 1 done and start rest timer"));
    fireEvent.click(screen.getByText(/Skip/));
    expect(chime.cancelRestChime).toHaveBeenCalled();
  });

  test("leaving the workout screen cancels a pending chime", () => {
    const { unmount } = open();
    fireEvent.click(screen.getByLabelText("Mark set 1 done and start rest timer"));
    chime.cancelRestChime.mockClear();
    unmount();
    expect(chime.cancelRestChime).toHaveBeenCalled();
  });

  test("the sound can be switched off from the timer itself, and it remembers", () => {
    open();
    fireEvent.click(screen.getByLabelText("Mark set 1 done and start rest timer"));
    fireEvent.click(screen.getByLabelText("Turn rest sound off"));
    expect(chime.setRestChimeMuted).toHaveBeenCalledWith(true);
    expect(screen.getByLabelText("Turn rest sound on")).toBeInTheDocument();
  });
});
