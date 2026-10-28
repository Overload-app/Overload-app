// @vitest-environment jsdom
//
// Real report from a tester: "the rest timer is inconsistent whether it dings
// or not." iPhone leaves the sound "interrupted" after a call, a video, Siri
// or switching apps; only "suspended" used to be woken, so one interruption
// silenced every rest after it.
import { describe, test, expect, vi, beforeEach } from "vitest";

const made = [];
class FakeContext {
  constructor() { this.state = "running"; this.currentTime = 100; this.destination = {}; this.started = []; made.push(this); }
  resume() { this.resumed = (this.resumed || 0) + 1; this.state = "running"; return Promise.resolve(); }
  createOscillator() { const ctx = this; return { frequency: {}, connect() {}, start(at) { ctx.started.push(at); }, stop() {} }; }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
}

let chime;
beforeEach(async () => {
  vi.resetModules();
  made.length = 0;
  window.AudioContext = FakeContext;
  localStorage.clear();
  chime = await import("./restChime.js");
});

describe("rest chime on iPhone", () => {
  test("after an interruption the sound is woken, and the chime is set for the end of the rest", () => {
    chime.scheduleRestChime(90);
    const ctx = made[0];
    ctx.state = "interrupted";
    chime.scheduleRestChime(60);
    expect(ctx.resumed).toBe(1);
    expect(ctx.started.at(-2)).toBe(160);
  });

  test("a closed sound is replaced rather than left silent", () => {
    chime.scheduleRestChime(30);
    made[0].state = "closed";
    chime.scheduleRestChime(30);
    expect(made).toHaveLength(2);
    expect(made[1].started.length).toBe(2);
  });

  test("coming back to the app mid-rest sets the chime up again for the time left", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    chime.scheduleRestChime(90);
    const before = made[0].started.length;
    vi.setSystemTime(new Date("2026-10-27T12:00:30Z"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(made[0].started.length).toBe(before + 2);
    expect(made[0].started.at(-2)).toBeCloseTo(160, 0);
    vi.useRealTimers();
  });

  test("nothing is set up again after the rest was skipped", () => {
    chime.scheduleRestChime(90);
    chime.cancelRestChime();
    const before = made[0].started.length;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(made[0].started.length).toBe(before);
  });

  test("if the sound was asleep when the rest ended, it plays then", async () => {
    chime.scheduleRestChime(90);
    made[0].state = "interrupted";
    chime.buzzRestDone();
    await new Promise((r) => setTimeout(r, 0));
    expect(made[0].started.at(-2)).toBe(100);
  });

  test("muted stays muted", () => {
    chime.setRestChimeMuted(true);
    chime.scheduleRestChime(90);
    expect(made).toHaveLength(0);
  });
});
