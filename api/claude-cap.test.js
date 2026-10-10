// The free-trial AI cap, end to end through the endpoint: over the cap gets
// 402 and never reaches Anthropic; subscribers are never capped; and if the
// ai_usage table hasn't been created yet, nobody is blocked.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

let profile, usageRows, usageError, rpcCalls;
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async (t) => (t === "good" ? { data: { user: { id: "u1" } }, error: null } : { data: null, error: { message: "bad" } }) },
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

  test("a subscriber is never capped or recorded", async () => {
    profile = { subscribed: true };
    usageRows = [{ day: today, cents: 999 }];
    const r = res();
    await handler(req(), r);
    expect(r.statusCode).toBe(200);
    expect(rpcCalls).toEqual([]);
  });

  test("before the usage table exists, nobody is blocked", async () => {
    usageError = { code: "PGRST205", message: "relation does not exist" };
    const r = res();
    await handler(req(), r);
    expect(r.statusCode).toBe(200);
    expect(rpcCalls).toEqual([]);
  });
});
