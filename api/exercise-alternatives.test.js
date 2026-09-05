import { describe, test, expect } from "vitest";
import { cacheKey, parseAlternatives } from "./exercise-alternatives.js";

describe("cacheKey", () => {
  test("normalizes case and pairs the name with equipment", () => {
    expect(cacheKey("Bench Press", "full")).toBe("bench press|full");
  });

  test("trims surrounding whitespace on the name", () => {
    expect(cacheKey("  Squat  ", "dumbbell")).toBe("squat|dumbbell");
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
