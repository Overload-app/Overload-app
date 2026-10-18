// The free-trial AI cap, end to end through the endpoint: over the cap gets
// 402 and never reaches Anthropic; subscribers are never capped; and if the
// ai_usage table hasn't been created yet, nobody is blocked.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

let profile, usageRows, usageError, rpcCalls;
let currentEmail = "someone@example.com";
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async (t) => (t === "good" ? { data: { user: { id: "u1", email: currentEmail } }, error: null } : { data: null, error: { message: "bad" } }) },
    from: (table) => {
      const q = {
        select: () => q, eq: () => q,
        gte: async () => (usageError ? { data: null, error: usageError } : { data: usageRows, error: null }),
        maybeSingle: async () => ({ data: table === "profiles" ? profile : null, error: null }),
      };
      return q;
    },
    rpc: async (name, args) => { rpcCalls.push({ name, args }); return { error: null }; },
  }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p) => p }));

const { default: handler } = await import("./claude.js");
const today = new Date().toISOString().slice(0, 10);
const res = () => ({ statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const req = () => ({ method: "POST", headers: { authorization: "Bearer good" }, body: { messages: [{ role: "user", content: "hi" }] } });

describe("free-trial AI cap at the endpoint", () => {
  let fetchSpy;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "k"; process.env.SUPABASE_URL = "https://x.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "s";
    profile = { subscribed: false }; usageRows = []; usageError = null; rpcCalls = [];
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ content: [], usage: { input_tokens: 1000, output_tokens: 500 } }) });
  });
  afterEach(() => fetchSpy.mockRestore());

  test("a trial account over today's cap is refused before any AI call", async () => {
    usageRows = [{ day: today, cents: 15.2 }];
    const r = res();
    await handler(req(), r);
    expect(r.statusCode).toBe(402);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a trial account under the cap goes through, and the cost is recorded", async () => {
    usageRows = [{ day: today, cents: 3 }];
    const r = res();
    await handler(req(), r);
    expect(r.statusCode).toBe(200);
    expect(rpcCalls).toEqual([{ name: "add_ai_usage", args: { p_user: "u1", p_day: today, p_cents: expect.closeTo(0.7, 5) } }]);
  });

  test("a subscriber under 25c today goes through and is recorded", async () => {
    profile = { subscribed: true };
    usageRows = [{ day: today, cents: 20 }];
    const r = res();
    await handler(req(), r);
    expect(r.statusCode).toBe(200);
    expect(rpcCalls.length).toBe(1);
  });

  test("a subscriber past 25c today hits the fair-use limit until tomorrow", async () => {
    profile = { subscribed: true };
    usageRows = [{ day: today, cents: 25.4 }, { day: "2026-01-01", cents: 500 }];
    const r = res();
    await handler(req(), r);
    expect(r.statusCode).toBe(402);
    expect(r.body.error).toBe("daily-ai-limit");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("an account in UNCAPPED_EMAILS (the owner) is never capped or recorded", async () => {
    process.env.UNCAPPED_EMAILS = "Owner@Example.com, other@x.com";
    currentEmail = "owner@example.com";
    profile = { subscribed: true };
    usageRows = [{ day: today, cents: 999 }];
    const r = res();
    await handler(req(), r);
    expect(r.statusCode).toBe(200);
    expect(rpcCalls).toEqual([]);
    delete process.env.UNCAPPED_EMAILS;
    currentEmail = "someone@example.com";
  });

  test("the cheaper model is allowed, anything else becomes the main model, and a refused cheap call retries on the main one", async () => {
    const { buildUpstreamBody, LIGHT_MODEL, MODEL } = await import("./claude.js");
    expect(buildUpstreamBody({ model: LIGHT_MODEL }).model).toBe(LIGHT_MODEL);
    expect(buildUpstreamBody({ model: "claude-opus-5-5" }).model).toBe(MODEL);
    fetchSpy.mockReset();
    fetchSpy
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: "bad model" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ content: [], usage: { input_tokens: 10, output_tokens: 5 } }) });
    profile = { subscribed: true }; usageRows = [];
    const r = res();
    await handler({ method: "POST", headers: { authorization: "Bearer good" }, body: { model: LIGHT_MODEL, messages: [{ role: "user", content: "hi" }] } }, r);
    expect(r.statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body).model).toBe(MODEL);
  });

  test("the cheaper model is priced as such", async () => {
    const { usageCostCents, LIGHT_MODEL } = await import("./claude.js");
    const usage = { input_tokens: 1_000_000, output_tokens: 0 };
    expect(usageCostCents(usage)).toBeCloseTo(200, 5);
    expect(usageCostCents(usage, LIGHT_MODEL)).toBeCloseTo(10, 5);
  });

  test("before the usage table exists, nobody is blocked", async () => {
    usageError = { code: "PGRST205", message: "relation does not exist" };
    const r = res();
    await handler(req(), r);
    expect(r.statusCode).toBe(200);
    expect(rpcCalls).toEqual([]);
  });
});
