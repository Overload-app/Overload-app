import { describe, test, expect, vi, beforeEach } from "vitest";

let created;
vi.mock("stripe", () => ({ default: class { constructor() { this.checkout = { sessions: { create: async (args) => { created = args; return { url: "https://checkout.stripe.test/x" }; } } }; } } }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: async (t) => (t === "good" ? { data: { user: { id: "real-user", email: "real@example.com" } }, error: null } : { data: null, error: { message: "bad" } }) } }),
}));
const { default: handler } = await import("./create-checkout-session.js");
const res = () => ({ statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

describe("create-checkout-session", () => {
  beforeEach(() => {
    created = null;
    Object.assign(process.env, { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_ID: "price_m", STRIPE_PRICE_ID_YEARLY: "price_y", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "s" });
  });

  test("refuses anyone not signed in, without touching Stripe", async () => {
    const r = res();
    await handler({ method: "POST", headers: {}, body: { email: "a@b.c", userId: "someone" } }, r);
    expect(r.statusCode).toBe(401);
    expect(created).toBeNull();
    const r2 = res();
    await handler({ method: "POST", headers: { authorization: "Bearer forged" }, body: {} }, r2);
    expect(r2.statusCode).toBe(401);
  });

  test("uses the signed-in account, never the one named in the request", async () => {
    const r = res();
    await handler({ method: "POST", headers: { authorization: "Bearer good", host: "www.overload-app.com" }, body: { email: "victim@example.com", userId: "victim", plan: "yearly" } }, r);
    expect(r.statusCode).toBe(200);
    expect(created).toMatchObject({ customer_email: "real@example.com", client_reference_id: "real-user", metadata: { userId: "real-user", plan: "yearly" }, line_items: [{ price: "price_y", quantity: 1 }] });
  });

  test("anything but 'yearly' is the monthly plan", async () => {
    const r = res();
    await handler({ method: "POST", headers: { authorization: "Bearer good", host: "x" }, body: { plan: "lifetime-free" } }, r);
    expect(created.line_items[0].price).toBe("price_m");
  });
});
