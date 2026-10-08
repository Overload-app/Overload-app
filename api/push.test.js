import { describe, test, expect, beforeEach, afterEach } from "vitest";
import restHandler, { validRestAlert, shouldSendRestAlert, sendToSubscriptions, MAX_REST_SECONDS } from "./rest-alert.js";
import cronHandler, { reminderFor, localDateISO } from "./push-cron.js";

const mockRes = () => ({ statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

describe("rest alerts", () => {
  const now = 1_700_000_000_000;
  test("accepts a rest ending within the next few minutes", () => {
    expect(validRestAlert({ endAt: now + 90_000 }, now)).toEqual({ endAt: now + 90_000 });
  });
  test("refuses one already over, too far away, or missing", () => {
    expect(validRestAlert({ endAt: now - 1 }, now)).toBeNull();
    expect(validRestAlert({ endAt: now + (MAX_REST_SECONDS + 1) * 1000 }, now)).toBeNull();
    expect(validRestAlert({}, now)).toBeNull();
    expect(validRestAlert(null, now)).toBeNull();
  });

  const sub = { endpoint: "https://push.example/1", keys: {} };
  const base = { push: { restAlerts: true, subscriptions: [sub] }, inProgressWorkout: { rest: { endAt: 5000, total: 90 } } };
  test("sends only while that same rest is still the current one", () => {
    expect(shouldSendRestAlert(base, 5000)).toBe(true);
    // +15s moved it, Skip cleared it, finishing removed the workout.
    expect(shouldSendRestAlert({ ...base, inProgressWorkout: { rest: { endAt: 20000 } } }, 5000)).toBe(false);
    expect(shouldSendRestAlert({ ...base, inProgressWorkout: { rest: null } }, 5000)).toBe(false);
    expect(shouldSendRestAlert({ ...base, inProgressWorkout: null }, 5000)).toBe(false);
  });
  test("not when switched off or there's no device to send to", () => {
    expect(shouldSendRestAlert({ ...base, push: { ...base.push, restAlerts: false } }, 5000)).toBe(false);
    expect(shouldSendRestAlert({ ...base, push: { restAlerts: true, subscriptions: [] } }, 5000)).toBe(false);
    expect(shouldSendRestAlert(null, 5000)).toBe(false);
  });
  test("one dead device doesn't stop the others", async () => {
    const sent = await sendToSubscriptions([sub, { endpoint: "gone" }], { title: "x" }, (s) => (s.endpoint === "gone" ? Promise.reject(new Error("410")) : Promise.resolve()));
    expect(sent).toBe(1);
  });

  describe("endpoint", () => {
    const saved = { ...process.env };
    beforeEach(() => { process.env.VAPID_PRIVATE_KEY = "x"; process.env.SUPABASE_URL = "https://example.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "x"; });
    afterEach(() => { process.env = { ...saved }; });
    test("refuses anything but POST", async () => {
      const res = mockRes();
      await restHandler({ method: "GET", headers: {} }, res);
      expect(res.statusCode).toBe(405);
    });
    test("refuses without a sign-in", async () => {
      const res = mockRes();
      await restHandler({ method: "POST", headers: {}, body: { endAt: Date.now() + 60000 } }, res);
      expect(res.statusCode).toBe(401);
    });
  });
});

describe("workout reminders", () => {
  const now = new Date("2026-10-08T21:00:00Z");
  const sub = { endpoint: "https://push.example/1", keys: {} };
  const state = (over = {}) => ({
    push: { reminders: true, subscriptions: [sub], tz: "UTC" },
    profile: { daysPerWeek: 4 },
    program: { days: [{ name: "Push" }, { name: "Pull" }, { name: "Legs" }, { name: "Upper" }] },
    logs: { workouts: [{ date: "2026-10-06" }] },
    ...over,
  });

  test("names the next scheduled day", () => {
    expect(reminderFor(state(), now).body).toContain("Pull");
  });
  test("nothing once they've trained today", () => {
    expect(reminderFor(state({ logs: { workouts: [{ date: "2026-10-08" }] } }), now)).toBeNull();
  });
  test("nothing once the week's sessions are done", () => {
    const workouts = ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-07"].map((date) => ({ date }));
    expect(reminderFor(state({ logs: { workouts } }), now)).toBeNull();
  });
  test("nothing when switched off, no device, or no program", () => {
    expect(reminderFor(state({ push: { reminders: false, subscriptions: [sub] } }), now)).toBeNull();
    expect(reminderFor(state({ push: { reminders: true, subscriptions: [] } }), now)).toBeNull();
    expect(reminderFor(state({ program: { days: [] } }), now)).toBeNull();
  });
  test("'today' is their day, not the server's", () => {
    // 21:00 UTC is already the next day in Sydney.
    expect(localDateISO("Australia/Sydney", now)).toBe("2026-10-09");
    expect(localDateISO("America/Los_Angeles", now)).toBe("2026-10-08");
    expect(localDateISO("Not/AZone", now)).toBe("2026-10-08");
  });

  test("the daily job refuses anyone without the cron secret", async () => {
    const saved = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "s3cret";
    const res = mockRes();
    await cronHandler({ method: "GET", headers: { authorization: "Bearer wrong" } }, res);
    expect(res.statusCode).toBe(401);
    const res2 = mockRes();
    await cronHandler({ method: "GET", headers: {} }, res2);
    expect(res2.statusCode).toBe(401);
    process.env.CRON_SECRET = saved;
  });
});
