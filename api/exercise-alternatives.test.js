import { describe, test, expect } from "vitest";
import handler, { cacheKey, parseAlternatives, bearerToken } from "./exercise-alternatives.js";

describe("cacheKey", () => {
  test("normalizes case and pairs the name with equipment", () => {
    expect(cacheKey("Bench Press", "full")).toBe("v2|bench press|full");
  });

  test("trims surrounding whitespace on the name", () => {
    expect(cacheKey("  Squat  ", "dumbbell")).toBe("v2|squat|dumbbell");
  });

  // The prompt gained a "video-confirmed exercises only" constraint, so
  // answers cached before it must not keep being served.
  test("the key is versioned, so rows cached under the old unconstrained prompt aren't reused", () => {
    expect(cacheKey("Bench Press", "full").startsWith("v2|")).toBe(true);
  });

  test("the same exercise under different equipment gets different keys", () => {
    expect(cacheKey("Squat", "full")).not.toBe(cacheKey("Squat", "bodyweight"));
  });
});

describe("parseAlternatives", () => {
  test("extracts the alternatives array from a clean JSON response", () => {
    expect(parseAlternatives('{"alternatives": ["Leg Press", "Hack Squat", "Goblet Squat"]}')).toEqual([
      "Leg Press", "Hack Squat", "Goblet Squat",
    ]);
  });

  test("strips markdown fences the model sometimes adds anyway", () => {
    expect(parseAlternatives('```json\n{"alternatives": ["Leg Press"]}\n```')).toEqual(["Leg Press"]);
  });

  test("pulls the JSON object out even with a stray sentence around it", () => {
    expect(parseAlternatives('Sure, here you go: {"alternatives": ["Leg Press"]} Hope that helps!')).toEqual(["Leg Press"]);
  });

  test("returns an empty array when the field is missing, rather than throwing", () => {
    expect(parseAlternatives('{"somethingElse": true}')).toEqual([]);
  });
});

// Found in a pre-launch security pass: this endpoint called Claude for anyone
// who found its address, and varying the exercise name walked past the cache.
describe("requires a signed-in session", () => {
  function fakeRes() {
    return { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  }

  test("a request with no session token is refused before anything is called", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    const res = fakeRes();
    await handler({ method: "GET", headers: {}, query: { name: "Bench Press" } }, res);
    expect(res.statusCode).toBe(401);
  });

  test("bearerToken reads the Authorization header", () => {
    expect(bearerToken({ headers: { authorization: "Bearer abc" } })).toBe("abc");
    expect(bearerToken({ headers: {} })).toBe(null);
  });
});
