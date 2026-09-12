import { describe, test, expect } from "vitest";
import { bearerToken } from "./create-portal-session.js";

// This endpoint used to take a userId straight from the request body with no
// check that the caller was that person, so anyone holding someone else's
// user id could open a Stripe billing portal for them — invoices, payment
// method, and the ability to cancel their subscription.
describe("create-portal-session bearerToken", () => {
  test("reads the token from the Authorization header", () => {
    expect(bearerToken({ headers: { authorization: "Bearer abc.def" } })).toBe("abc.def");
  });

  test("returns null with no usable token, so the handler can refuse", () => {
    expect(bearerToken({ headers: {} })).toBeNull();
    expect(bearerToken({ headers: { authorization: "Basic xyz" } })).toBeNull();
  });
});
