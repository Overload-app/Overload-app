import { describe, test, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import restHandler, { validRestAlert, shouldSendRestAlert, sendToSubscriptions, internalCaller, MAX_REST_SECONDS } from "./rest-alert.js";
import cronHandler, { reminderFor, localDateISO, localHour, verifyGithubToken, GITHUB_REPO, OIDC_AUDIENCE, weighInFor, idleWorkoutFor, notificationsFor, localWeekday, nextDayIndex, dueFor, reminderSchedules } from "./push-cron.js";

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
  test("not when they watched the rest finish in the app", () => {
    expect(shouldSendRestAlert({ ...base, inProgressWorkout: { rest: { endAt: 5000, total: 90, seen: true } } }, 5000)).toBe(false);
  });
    test("not when switched off or there's no device to send to", () => {
    expect(shouldSendRestAlert({ ...base, push: { ...base.push, restAlerts: false } }, 5000)).toBe(false);
    expect(shouldSendRestAlert({ ...base, push: { restAlerts: true, subscriptions: [] } }, 5000)).toBe(false);
    expect(shouldSendRestAlert(null, 5000)).toBe(false);
  });
  test("15-minute rests are accepted (waited out in legs)", () => {
    expect(validRestAlert({ endAt: now + 10 * 60_000 }, now)).not.toBeNull();
    expect(MAX_REST_SECONDS).toBe(900);
  });
  test("the next leg of a long rest needs the server secret", () => {
    const req = (h, userId = "u1") => ({ headers: { "x-overload-internal": h }, body: { userId } });
    expect(internalCaller(req("s"), "s")).toBe("u1");
    expect(internalCaller(req("wrong"), "s")).toBeNull();
    expect(internalCaller(req(undefined), undefined)).toBeNull();
    expect(internalCaller(req("s", 5), "s")).toBeNull();
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
  const now = new Date("2026-10-08T18:00:00Z");
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
    const late = new Date("2026-10-08T21:00:00Z");
    // 21:00 UTC is already the next day in Sydney.
    expect(localDateISO("Australia/Sydney", late)).toBe("2026-10-09");
    expect(localDateISO("America/Los_Angeles", late)).toBe("2026-10-08");
    expect(localDateISO("Not/AZone", late)).toBe("2026-10-08");
  });
  test("goes out at 6pm in their own time zone, and only then", () => {
    const ny = state({ push: { reminders: true, subscriptions: [sub], tz: "America/New_York" } });
    expect(reminderFor(ny, new Date("2026-10-08T22:00:00Z"))).not.toBeNull(); // 6pm EDT
    expect(reminderFor(ny, new Date("2026-10-08T18:00:00Z"))).toBeNull(); // 2pm EDT
    expect(localHour("Asia/Kolkata", new Date("2026-10-08T12:35:00Z"))).toBe(18);
    expect(localHour("Not/AZone", new Date("2026-10-08T07:00:00Z"))).toBe(7);
  });
  test("an hourly run reaches each person exactly once a day", () => {
    for (const tz of ["UTC", "America/Los_Angeles", "Europe/London", "Asia/Kolkata", "Australia/Adelaide", "Pacific/Auckland"]) {
      const st = state({ push: { reminders: true, subscriptions: [sub], tz } });
      let sends = 0;
      for (let h = 0; h < 24; h++) if (reminderFor(st, new Date(Date.UTC(2026, 9, 8, h, 7)))) sends++;
      expect(sends, tz).toBe(1);
    }
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

describe("GitHub's hourly tick", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" };
  const nowSec = 1_800_000_000;
  const sign = (claims, kid = "k1", key = privateKey) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const head = enc({ alg: "RS256", kid }), body = enc(claims);
    return `${head}.${body}.${crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
  };
  const good = { iss: "https://token.actions.githubusercontent.com", aud: OIDC_AUDIENCE, repository: GITHUB_REPO, exp: nowSec + 300, nbf: nowSec - 10 };
  const keys = async () => [jwk];

  test("accepts this repo's signed run token", async () => {
    expect(await verifyGithubToken(sign(good), keys, nowSec)).toBe(true);
  });
  test("refuses another repo, another audience, an expired or forged token", async () => {
    expect(await verifyGithubToken(sign({ ...good, repository: "someone/else" }), keys, nowSec)).toBe(false);
    expect(await verifyGithubToken(sign({ ...good, aud: "other" }), keys, nowSec)).toBe(false);
    expect(await verifyGithubToken(sign({ ...good, exp: nowSec - 1 }), keys, nowSec)).toBe(false);
    const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(await verifyGithubToken(sign(good, "k1", other), keys, nowSec)).toBe(false);
    expect(await verifyGithubToken(sign(good, "nope"), keys, nowSec)).toBe(false);
    expect(await verifyGithubToken("garbage", keys, nowSec)).toBe(false);
  });
});

describe("weigh-in and forgotten-workout notifications", () => {
  const sub = { endpoint: "https://push.example/1", keys: {} };
  const base = (push, extra = {}) => ({ push: { subscriptions: [sub], tz: "UTC", ...push }, logs: { workouts: [], bodyweight: [] }, program: { days: [{ name: "Push" }] }, ...extra });
  test("weigh-in goes out at the hour they picked, only if they haven't weighed in", () => {
    const at7 = new Date("2026-10-17T07:07:00Z");
    expect(weighInFor(base({ weighIn: true, weighInHour: 7 }), at7)?.kind).toBe("weighin");
    expect(weighInFor(base({ weighIn: true, weighInHour: 8 }), at7)).toBeNull();
    expect(weighInFor(base({ weighIn: false, weighInHour: 7 }), at7)).toBeNull();
    const weighed = base({ weighIn: true, weighInHour: 7 }, { logs: { workouts: [], bodyweight: [{ date: "2026-10-17", weight: 180 }] } });
    expect(weighInFor(weighed, at7)).toBeNull();
    expect(weighInFor(base({ weighIn: true }), new Date("2026-10-17T08:07:00Z"))?.kind).toBe("weighin"); // default 8am
  });
  test("a workout quiet for 40-100 minutes gets one nudge", () => {
    const now = new Date("2026-10-17T12:07:00Z");
    const open = (minAgo) => base({ idleWorkout: true }, { inProgressWorkout: { dayIdx: 0, savedAt: new Date(now - minAgo * 60000).toISOString() } });
    expect(idleWorkoutFor(open(20), now)).toBeNull();
    expect(idleWorkoutFor(open(45), now)?.body).toContain("Push");
    expect(idleWorkoutFor(open(130), now)).toBeNull();
    expect(idleWorkoutFor(base({ idleWorkout: true }), now)).toBeNull();
  });
  test("an hourly run nudges a forgotten workout exactly once", () => {
    const savedAt = new Date("2026-10-17T10:23:00Z");
    const st = base({ idleWorkout: true }, { inProgressWorkout: { dayIdx: 0, savedAt: savedAt.toISOString() } });
    let n = 0;
    for (let h = 10; h < 16; h++) if (idleWorkoutFor(st, new Date(Date.UTC(2026, 9, 17, h, 7)))) n++;
    expect(n).toBe(1);
  });
  test("each kind can be on or off on its own", () => {
    const at18 = new Date("2026-10-17T18:07:00Z");
    const st = base({ reminders: true, weighIn: true, weighInHour: 18 });
    expect(notificationsFor(st, at18).map((n) => n.kind)).toEqual(["reminder", "weighin"]);
    expect(notificationsFor(base({ reminders: false, weighIn: true, weighInHour: 18 }), at18).map((n) => n.kind)).toEqual(["weighin"]);
  });
});

describe("reminders that survive GitHub skipping runs", () => {
  const sub = { endpoint: "https://push.example/1", keys: {} };
  const st = (push, extra = {}) => ({ push: { subscriptions: [sub], tz: "UTC", ...push }, profile: { daysPerWeek: 5 }, program: { days: [{ name: "Push" }, { name: "Pull" }, { name: "Legs" }] }, logs: { workouts: [], bodyweight: [] }, ...extra });
  const at = (h) => new Date(Date.UTC(2026, 9, 20, h, 37)); // a Tuesday
  test("with catch-up, a late run still sends — once", () => {
    const s1 = st({ reminders: true });
    expect(notificationsFor(s1, at(20), null)).toEqual([]); // old way: exact hour only
    expect(notificationsFor(s1, at(20), new Set()).map((n) => n.kind)).toEqual(["reminder"]);
    expect(notificationsFor(s1, at(21), new Set(["reminder"]))).toEqual([]);
    expect(notificationsFor(s1, at(23), new Set())).toEqual([]); // window over
  });
  test("weigh-in catches up within its window", () => {
    const s1 = st({ weighIn: true, weighInHour: 7 });
    expect(notificationsFor(s1, at(9), new Set()).map((n) => n.kind)).toEqual(["weighin"]);
    expect(notificationsFor(s1, at(9), new Set(["weighin"]))).toEqual([]);
    expect(notificationsFor(s1, at(12), new Set())).toEqual([]);
  });
  test("workout reminders only on the days they picked", () => {
    expect(localWeekday("UTC", at(18))).toBe(2);
    expect(reminderFor(st({ reminders: true, reminderDays: [1, 3, 5] }), at(18))).toBeNull();
    expect(reminderFor(st({ reminders: true, reminderDays: [2] }), at(18))?.kind).toBe("reminder");
    expect(reminderFor(st({ reminders: true, reminderDays: [] }), at(18))?.kind).toBe("reminder");
  });
  test("names the day after the one trained last", () => {
    const days = [{ name: "Push" }, { name: "Pull" }, { name: "Legs" }];
    expect(nextDayIndex(days, [{ date: "2026-10-19", dayName: "Push" }, { date: "2026-10-12", dayName: "Legs" }])).toBe(1);
    const s1 = st({ reminders: true }, { logs: { workouts: [{ date: "2026-10-19", dayName: "Push" }], bodyweight: [] } });
    expect(reminderFor(s1, at(18)).body).toContain("Pull");
  });
});

// Real ask: "schedule food log reminders at certain times, and how often it
// repeats, and you should be able to make multiple. same with workout days."
describe("reminders people schedule themselves", () => {
  const sub = { endpoint: "https://push.example/1", keys: {} };
  const st = (schedules, extra = {}) => ({ push: { subscriptions: [sub], tz: "UTC", schedules }, profile: { daysPerWeek: 5 }, targets: { calories: 2400 }, program: { days: [{ name: "Push" }, { name: "Pull" }] }, logs: { workouts: [], bodyweight: [], nutrition: [] }, ...extra });
  const at = (h) => new Date(Date.UTC(2026, 9, 20, h, 7)); // a Tuesday
  const food = (id, hour, days) => ({ id, type: "food", hour, days });
  test("several food reminders a day, each at its own time", () => {
    const s1 = st([food("f1", 8), food("f2", 12), food("f3", 19)]);
    expect(notificationsFor(s1, at(8), null).map((n) => n.kind)).toEqual(["food"]);
    expect(notificationsFor(s1, at(12), null).map((n) => n.kind)).toEqual(["food"]);
    expect(notificationsFor(s1, at(15), null)).toEqual([]);
    expect(notificationsFor(s1, at(19), null).map((n) => n.kind)).toEqual(["food"]);
  });
  test("each is sent once a day, under its own name", () => {
    const s1 = st([food("f1", 8), food("f2", 12)]);
    expect(dueFor(s1, at(8), new Set()).map((d) => d.keys)).toEqual([["f1"]]);
    expect(dueFor(s1, at(9), new Set(["f1"]))).toEqual([]);
    expect(dueFor(s1, at(12), new Set(["f1"])).map((d) => d.keys)).toEqual([["f2"]]);
  });
  test("a late run that finds two food reminders due sends one notification", () => {
    const s1 = st([food("f1", 12), food("f2", 13)]);
    const due = dueFor(s1, at(13), new Set());
    expect(due).toHaveLength(1);
    expect(due[0].keys).toEqual(["f1", "f2"]);
  });
  test("repeats only on the days picked", () => {
    expect(notificationsFor(st([food("f1", 12, [1, 3, 5])]), at(12), null)).toEqual([]);
    expect(notificationsFor(st([food("f1", 12, [2])]), at(12), null)).toHaveLength(1);
  });
  test("the food reminder says where they're at today", () => {
    const today = { date: "2026-10-20", meals: [{ cal: 600 }, { cal: 450.4 }] };
    expect(notificationsFor(st([food("f1", 12)]), at(12), null)[0].body).toMatch(/Nothing logged yet/);
    expect(notificationsFor(st([food("f1", 12)], { logs: { workouts: [], bodyweight: [], nutrition: [today] } }), at(12), null)[0].body).toContain("1050 of 2400");
  });
  test("several workout reminders, still skipped once they've trained", () => {
    const s1 = st([{ id: "w1", type: "workout", hour: 7, days: [1, 2, 3] }, { id: "w2", type: "workout", hour: 17 }]);
    expect(notificationsFor(s1, at(7), null)[0].body).toContain("Push");
    expect(notificationsFor(s1, at(17), null).map((n) => n.kind)).toEqual(["reminder"]);
    const trained = st(s1.push.schedules, { logs: { workouts: [{ date: "2026-10-20", dayName: "Push" }], bodyweight: [], nutrition: [] } });
    expect(notificationsFor(trained, at(17), null)).toEqual([]);
  });
  test("a saved list replaces the old single reminder, even an empty one", () => {
    const old = { reminders: true, weighIn: true, weighInHour: 7, subscriptions: [sub], tz: "UTC" };
    expect(reminderSchedules(old).map((r) => [r.id, r.type, r.hour])).toEqual([["reminder", "workout", 18], ["weighin", "weighin", 7]]);
    expect(reminderSchedules({ ...old, schedules: [] })).toEqual([]);
    expect(notificationsFor(st([], { push: { ...old, schedules: [] } }), at(18), null)).toEqual([]);
  });
  test("nothing without a device to send to", () => {
    expect(notificationsFor({ ...st([food("f1", 12)]), push: { tz: "UTC", schedules: [food("f1", 12)], subscriptions: [] } }, at(12), null)).toEqual([]);
  });
});
