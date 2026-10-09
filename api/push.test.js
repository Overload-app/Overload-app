import { describe, test, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import restHandler, { validRestAlert, shouldSendRestAlert, sendToSubscriptions, internalCaller, MAX_REST_SECONDS } from "./rest-alert.js";
import cronHandler, { reminderFor, localDateISO, localHour, verifyGithubToken, GITHUB_REPO, OIDC_AUDIENCE } from "./push-cron.js";

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
