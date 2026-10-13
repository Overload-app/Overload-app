import { describe, test, expect, vi, beforeEach } from "vitest";

let rows, inserted, dbError;
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: async () => (dbError ? { data: null, error: dbError } : { data: rows.map((d) => ({ device_id: d })), error: null }),
        insert: async (row) => { inserted.push(row); rows.push(row.device_id); return { error: null }; },
      };
      return q;
    },
  }),
}));
const mod = await import("./tester-unlock.js");
const { default: handler, TESTER_PASSWORD_HASHES, hashPassword, deviceDecision, passwordMatches } = mod;

const res = () => ({ statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
// The real passwords aren't in the repo, so these tests swap in a known one.
const KNOWN = "test-only-password-1";

describe("tester-unlock", () => {
  beforeEach(() => {
    rows = []; inserted = []; dbError = null;
    process.env.SUPABASE_URL = "https://x.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "s";
    TESTER_PASSWORD_HASHES["1"] = hashPassword(KNOWN);
  });
  const call = async (body, ip = `ip-${Math.random()}`) => { const r = res(); await handler({ method: "POST", headers: { "x-forwarded-for": ip }, body }, r); return r; };

  test("there are 15 testers, stored only as hashes", () => {
    expect(Object.keys(TESTER_PASSWORD_HASHES).length).toBe(15);
    Object.values(TESTER_PASSWORD_HASHES).forEach((h) => expect(h).toMatch(/^[0-9a-f]{64}$/));
  });
  test("the wrong password, or another tester's, is refused", async () => {
    expect((await call({ tester: 1, password: "nope", deviceId: "d1" })).statusCode).toBe(401);
    expect((await call({ tester: 2, password: KNOWN, deviceId: "d1" })).statusCode).toBe(401);
    expect(passwordMatches(99, KNOWN)).toBe(false);
  });
  test("first use claims the device; the same device keeps working", async () => {
    expect((await call({ tester: 1, password: KNOWN, deviceId: "phone" })).statusCode).toBe(200);
    expect(inserted).toEqual([expect.objectContaining({ tester: 1, device_id: "phone" })]);
    expect((await call({ tester: 1, password: KNOWN, deviceId: "phone" })).statusCode).toBe(200);
    expect(inserted.length).toBe(1);
  });
  test("a second device (e.g. the Home Screen app) is allowed, a third is refused", async () => {
    await call({ tester: 1, password: KNOWN, deviceId: "safari" });
    expect((await call({ tester: 1, password: KNOWN, deviceId: "homescreen" })).statusCode).toBe(200);
    const third = await call({ tester: 1, password: KNOWN, deviceId: "friends-phone" });
    expect(third.statusCode).toBe(403);
    expect(third.body.error).toMatch(/another device/);
  });
  test("before the table exists, the password still works", async () => {
    dbError = { message: "relation does not exist" };
    expect((await call({ tester: 1, password: KNOWN, deviceId: "x" })).statusCode).toBe(200);
  });
  test("guessing in a loop gets slowed down", async () => {
    for (let i = 0; i < 10; i++) await call({ tester: 1, password: "guess" + i, deviceId: "d" }, "same-ip");
    expect((await call({ tester: 1, password: KNOWN, deviceId: "d" }, "same-ip")).statusCode).toBe(429);
  });
  test("deviceDecision", () => {
    expect(deviceDecision([], "a")).toBe("add");
    expect(deviceDecision(["a"], "a")).toBe("known");
    expect(deviceDecision(["a", "b"], "c")).toBe("full");
  });
});
