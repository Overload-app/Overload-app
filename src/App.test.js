import { describe, test, expect } from "vitest";
import {
  calcTargets,
  parseJSONLoose,
  filterPool,
  injuryDescription,
  tipsForExercise,
  alternativesFor,
  buildProgram,
  inferMuscleGroup,
} from "./App.jsx";

// Baseline profile fields calcTargets/buildProgram actually read — kept
// minimal and overridden per test so each test's intent is obvious from
// what it overrides.
const baseProfile = {
  sex: "male",
  age: 30,
  heightIn: 70,
  weightLb: 180,
  activity: "moderate",
  goal: "recomp",
  equipment: "full",
  daysPerWeek: 4,
  sessionLength: 60,
  experience: "intermediate",
  injuries: ["none"],
};

describe("calcTargets", () => {
  test("protein always equals bodyweight in lb", () => {
    const t = calcTargets({ ...baseProfile, weightLb: 165 });
    expect(t.protein).toBe(165);
  });

  test("fat loss < recomp < muscle gain calories, same profile otherwise", () => {
    const lose = calcTargets({ ...baseProfile, goal: "lose" });
    const recomp = calcTargets({ ...baseProfile, goal: "recomp" });
    const build = calcTargets({ ...baseProfile, goal: "build" });
    expect(lose.calories).toBeLessThan(recomp.calories);
    expect(recomp.calories).toBeLessThan(build.calories);
  });

  test("carbs never go negative even at low calories with high protein", () => {
    // Small, light person in a deep deficit — protein*4 + fat*9 could
    // plausibly exceed total calories if this weren't clamped.
    const t = calcTargets({ ...baseProfile, weightLb: 250, heightIn: 60, age: 60, activity: "sedentary", goal: "lose" });
    expect(t.carbs).toBeGreaterThanOrEqual(0);
  });

  test("higher activity level raises TDEE and calories for an identical profile otherwise", () => {
    const sedentary = calcTargets({ ...baseProfile, activity: "sedentary" });
    const active = calcTargets({ ...baseProfile, activity: "active" });
    expect(active.tdee).toBeGreaterThan(sedentary.tdee);
    expect(active.calories).toBeGreaterThan(sedentary.calories);
  });
});

describe("parseJSONLoose", () => {
  test("parses plain JSON", () => {
    expect(parseJSONLoose('{"a":1}')).toEqual({ a: 1 });
  });

  test("parses JSON wrapped in markdown fences", () => {
    expect(parseJSONLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test("parses JSON with leading/trailing prose the model sometimes adds", () => {
    expect(parseJSONLoose('Sure, here you go:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 });
  });
});

describe("filterPool", () => {
  const pool = {
    legs: ["Back Squat", "Romanian Deadlift", "Leg Curl", "Calf Raise"],
    chest: ["Barbell Bench Press", "Cable Fly"],
  };

  test("no injuries (or 'none') returns the pool unchanged", () => {
    expect(filterPool(pool, [])).toEqual(pool);
    expect(filterPool(pool, ["none"])).toEqual(pool);
  });

  test("excludes exercises matching a stated injury", () => {
    const filtered = filterPool(pool, ["knees"]);
    expect(filtered.legs).not.toContain("Back Squat");
    expect(filtered.legs.length).toBeGreaterThan(0); // never empties a group entirely
  });

  test("doesn't touch unrelated groups", () => {
    const filtered = filterPool(pool, ["knees"]);
    expect(filtered.chest).toEqual(pool.chest);
  });
});

describe("injuryDescription", () => {
  test("returns 'none' when nothing is set", () => {
    expect(injuryDescription({ injuries: ["none"], otherInjuries: "" })).toBe("none");
    expect(injuryDescription({})).toBe("none");
  });

  test("combines preset checkboxes with free-text, dropping the 'none' sentinel", () => {
    const desc = injuryDescription({ injuries: ["knees", "none"], otherInjuries: "torn labrum" });
    expect(desc).toContain("knees");
    expect(desc).toContain("torn labrum");
    expect(desc).not.toContain("none");
  });

  test("free text alone (no preset injuries) still comes through", () => {
    expect(injuryDescription({ injuries: ["none"], otherInjuries: "sciatica" })).toBe("sciatica");
  });
});

describe("tipsForExercise", () => {
  test("always returns exactly 4 tips, known or unknown exercise", () => {
    expect(tipsForExercise("Back Squat")).toHaveLength(4);
    expect(tipsForExercise("Some Completely Made Up Exercise Name")).toHaveLength(4);
  });

  test("matches by keyword regardless of equipment prefix", () => {
    // Both should hit the squat-pattern tips, not the generic default.
    expect(tipsForExercise("Back Squat")).toEqual(tipsForExercise("DB Goblet Squat"));
  });
});

describe("alternativesFor", () => {
  test("never includes the exercise itself", () => {
    const alts = alternativesFor("Barbell Bench Press", "full", []);
    expect(alts).not.toContain("Barbell Bench Press");
  });

  test("suggests exercises from the same muscle group and equipment", () => {
    const alts = alternativesFor("DB Curl", "dumbbell", []);
    expect(alts.length).toBeGreaterThan(0);
    // Every dumbbell-pool alternative for a biceps exercise should itself
    // plausibly be a dumbbell exercise (loose check: none of the barbell-only
    // full-gym staples should leak in here).
    expect(alts).not.toContain("Barbell Curl");
  });

  test("respects injury exclusions", () => {
    const alts = alternativesFor("Romanian Deadlift", "full", ["lower_back"]);
    expect(alts.every((n) => !/deadlift|row/i.test(n))).toBe(true);
  });

  test("returns an empty list rather than guessing for an unrecognizable exercise", () => {
    expect(alternativesFor("Zzyzx Nonexistent Move", "full", [])).toEqual([]);
  });
});

describe("inferMuscleGroup", () => {
  test.each([
    ["Cable Lateral Raise", "shoulders"],
    ["Seated Leg Curl", "legs"],
    ["Incline Dumbbell Press", "chest"],
    ["Wide-Grip Lat Pulldown", "back"],
    ["Cable Rope Overhead Triceps Extension", "triceps"],
    ["Weighted Cable Crunch", "core"],
  ])("infers %s as %s", (name, expected) => {
    expect(inferMuscleGroup(name)).toBe(expected);
  });

  test("returns null rather than guessing when nothing matches", () => {
    expect(inferMuscleGroup("Zzyzx Nonexistent Move")).toBeNull();
  });
});

describe("buildProgram (offline rule-based fallback)", () => {
  test("produces exactly as many days as requested", () => {
    for (const daysPerWeek of [3, 4, 5, 6]) {
      const program = buildProgram({ ...baseProfile, daysPerWeek });
      expect(program.days).toHaveLength(daysPerWeek);
    }
  });

  test("every day has at least one exercise, and every exercise has the required fields", () => {
    const program = buildProgram(baseProfile);
    for (const day of program.days) {
      expect(day.exercises.length).toBeGreaterThan(0);
      for (const ex of day.exercises) {
        expect(typeof ex.name).toBe("string");
        expect(ex.sets).toBeGreaterThan(0);
        expect(typeof ex.reps).toBe("string");
        expect(ex.rest).toBeGreaterThan(0);
      }
    }
  });

  test("works for every equipment type without throwing", () => {
    for (const equipment of ["full", "dumbbell", "bodyweight"]) {
      expect(() => buildProgram({ ...baseProfile, equipment })).not.toThrow();
    }
  });

  test("bodyweight equipment never includes an obviously barbell/dumbbell-only exercise", () => {
    const program = buildProgram({ ...baseProfile, equipment: "bodyweight" });
    const names = program.days.flatMap((d) => d.exercises.map((e) => e.name));
    expect(names.some((n) => /barbell|dumbbell|\bDB\b/i.test(n))).toBe(false);
  });
});
