import { describe, test, expect } from "vitest";
import { searchCandidates, bestFuzzyMatch } from "./exercise-gif.js";

describe("searchCandidates", () => {
  test("a plain name with no qualifiers or equipment prefix has just itself as a candidate", () => {
    expect(searchCandidates("Leg Press")).toEqual(["Leg Press"]);
  });

  test("strips a parenthetical qualifier as a fallback candidate", () => {
    expect(searchCandidates("Leg Press (Low)")).toEqual(["Leg Press (Low)", "Leg Press"]);
  });

  test("strips a leading equipment word as a further fallback", () => {
    expect(searchCandidates("Barbell Romanian Deadlift")).toEqual(["Barbell Romanian Deadlift", "Romanian Deadlift"]);
  });

  test("strips both a parenthetical AND a leading equipment word, in order", () => {
    expect(searchCandidates("Dumbbell Romanian Deadlift (Partial Range)")).toEqual([
      "Dumbbell Romanian Deadlift (Partial Range)",
      "Dumbbell Romanian Deadlift",
      "Romanian Deadlift",
    ]);
  });

  test("never adds a duplicate candidate", () => {
    // Equipment-prefix stripping would otherwise produce "Squat" twice here.
    expect(searchCandidates("Barbell Squat")).toEqual(["Barbell Squat", "Squat"]);
  });
});

describe("bestFuzzyMatch", () => {
  const catalog = [
    { name_key: "cable fly", gif_url: "https://api.workoutxapp.com/v1/gifs/0100.gif" },
    { name_key: "barbell overhead press", gif_url: "https://api.workoutxapp.com/v1/gifs/0200.gif" },
    { name_key: "triceps pushdown", gif_url: "https://api.workoutxapp.com/v1/gifs/0300.gif" },
    { name_key: "dumbbell romanian deadlift", gif_url: "https://api.workoutxapp.com/v1/gifs/0400.gif" },
  ];

  test("matches despite a minor plural difference (tricep vs triceps)", () => {
    expect(bestFuzzyMatch("Tricep Pushdown", catalog)?.name_key).toBe("triceps pushdown");
  });

  test("matches when the query is missing the catalog's equipment prefix", () => {
    expect(bestFuzzyMatch("Overhead Press", catalog)?.name_key).toBe("barbell overhead press");
    expect(bestFuzzyMatch("Romanian Deadlift", catalog)?.name_key).toBe("dumbbell romanian deadlift");
  });

  test("refuses a low-confidence guess rather than risk the wrong exercise's video", () => {
    // Shares only "fly" — a real but generic word that could mean several
    // different exercises. Not confident enough to auto-select.
    expect(bestFuzzyMatch("Chest Fly", catalog)).toBeNull();
  });

  test("returns null when nothing overlaps at all", () => {
    expect(bestFuzzyMatch("Nordic Curl", catalog)).toBeNull();
  });

  test("returns null for an empty candidate list", () => {
    expect(bestFuzzyMatch("Cable Fly", [])).toBeNull();
  });
});
