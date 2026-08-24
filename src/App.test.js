import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calcTargets,
  parseJSONLoose,
  filterPool,
  injuryDescription,
  tipsForExercise,
  alternativesFor,
  buildProgram,
  inferMuscleGroup,
  splitForDays,
  capFor,
  capForProgram,
  isUnilateral,
  fetchExerciseGif,
  withTips,
  normalizeProgramTips,
  deriveSplitName,
  overrideDayName,
  coachResponseFlags,
  coachReplyText,
  readLocalState,
  writeLocalState,
  hasPendingSync,
  setPendingSync,
  POOLS,
  INJURY_EXCLUDES,
  GOAL_SCHEME,
  secondsPerExercise,
  dateToISO,
  parseISODate,
  extractReplyOnly,
  pick,
  buildDay,
  splitDisplayName,
  isTrialActive,
  trialDaysLeft,
  monthKey,
  exerciseHistory,
  exercisePR,
  exerciseLastSession,
  mergeResumedSets,
  seedLoggedSets,
  accumulateActiveSeconds,
  formatDuration,
  recentProgressHighlights,
  detectCoachInsight,
  claudeChat,
  fetchSimilarExercises,
  OFFLINE_MESSAGE,
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

/* ============================================================
   NUTRITION MATH
============================================================ */
describe("calcTargets", () => {
  test("protein always equals bodyweight in lb, regardless of goal", () => {
    for (const goal of ["lose", "build", "recomp"]) {
      expect(calcTargets({ ...baseProfile, weightLb: 165, goal }).protein).toBe(165);
    }
  });

  test("fat loss < recomp < muscle gain calories, same profile otherwise", () => {
    const lose = calcTargets({ ...baseProfile, goal: "lose" });
    const recomp = calcTargets({ ...baseProfile, goal: "recomp" });
    const build = calcTargets({ ...baseProfile, goal: "build" });
    expect(lose.calories).toBeLessThan(recomp.calories);
    expect(recomp.calories).toBeLessThan(build.calories);
  });

  test("carbs never go negative even at low calories with high protein", () => {
    const t = calcTargets({ ...baseProfile, weightLb: 250, heightIn: 60, age: 60, activity: "sedentary", goal: "lose" });
    expect(t.carbs).toBeGreaterThanOrEqual(0);
  });

  test("higher activity level raises TDEE and calories for an identical profile otherwise", () => {
    const levels = ["sedentary", "light", "moderate", "active"];
    const results = levels.map((activity) => calcTargets({ ...baseProfile, activity }));
    for (let i = 1; i < results.length; i++) {
      expect(results[i].tdee).toBeGreaterThan(results[i - 1].tdee);
      expect(results[i].calories).toBeGreaterThan(results[i - 1].calories);
    }
  });

  test("male BMR runs higher than female at identical age/height/weight (Mifflin-St Jeor offset)", () => {
    const male = calcTargets({ ...baseProfile, sex: "male" });
    const female = calcTargets({ ...baseProfile, sex: "female" });
    expect(male.tdee).toBeGreaterThan(female.tdee);
  });

  test("older age lowers TDEE, all else equal", () => {
    const younger = calcTargets({ ...baseProfile, age: 22 });
    const older = calcTargets({ ...baseProfile, age: 65 });
    expect(older.tdee).toBeLessThan(younger.tdee);
  });

  test("heavier bodyweight raises TDEE, all else equal", () => {
    const lighter = calcTargets({ ...baseProfile, weightLb: 130 });
    const heavier = calcTargets({ ...baseProfile, weightLb: 230 });
    expect(heavier.tdee).toBeGreaterThan(lighter.tdee);
  });

  test("calories are always rounded to the nearest 5", () => {
    for (const goal of ["lose", "build", "recomp"]) {
      for (const activity of ["sedentary", "light", "moderate", "active"]) {
        const { calories } = calcTargets({ ...baseProfile, goal, activity });
        expect(calories % 5).toBe(0);
      }
    }
  });

  test("macros reconstruct back to roughly the target calorie count", () => {
    const t = calcTargets(baseProfile);
    const reconstructed = t.protein * 4 + t.carbs * 4 + t.fat * 9;
    // Rounding on each macro individually means this won't be exact, but
    // should never drift by more than a few calories worth of rounding error.
    expect(Math.abs(reconstructed - t.calories)).toBeLessThan(20);
  });
});

/* ============================================================
   AI RESPONSE PARSING
============================================================ */
describe("parseJSONLoose", () => {
  test("parses plain JSON", () => {
    expect(parseJSONLoose('{"a":1}')).toEqual({ a: 1 });
  });

  test("parses JSON wrapped in markdown fences", () => {
    expect(parseJSONLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJSONLoose('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test("parses JSON with leading/trailing prose the model sometimes adds", () => {
    expect(parseJSONLoose('Sure, here you go:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 });
  });

  test("handles nested objects and arrays", () => {
    const raw = '{"reply":"hi","program":{"splitName":"PPL","days":[{"name":"Push","exercises":[]}]}}';
    const parsed = parseJSONLoose(raw);
    expect(parsed.program.splitName).toBe("PPL");
    expect(parsed.program.days).toHaveLength(1);
  });

  test("handles unicode content (e.g. accented characters, emoji) without corruption", () => {
    const parsed = parseJSONLoose('{"reply":"Nice work \u{1F4AA} — vamos!"}');
    expect(parsed.reply).toContain("💪");
    expect(parsed.reply).toContain("vamos");
  });

  test("throws on genuinely non-JSON content rather than silently returning garbage", () => {
    expect(() => parseJSONLoose("this is not JSON at all, sorry")).toThrow();
  });
});

/* ============================================================
   INJURY HANDLING
============================================================ */
describe("filterPool", () => {
  const pool = {
    legs: ["Back Squat", "Romanian Deadlift", "Leg Curl", "Calf Raise"],
    chest: ["Barbell Bench Press", "Cable Fly"],
    shoulders: ["Overhead Press", "Face Pull"],
    biceps: ["Barbell Curl", "Hammer Curl"],
  };

  test("no injuries (or 'none') returns the pool unchanged", () => {
    expect(filterPool(pool, [])).toEqual(pool);
    expect(filterPool(pool, ["none"])).toEqual(pool);
    expect(filterPool(pool, null)).toEqual(pool);
  });

  test("excludes exercises matching a stated injury", () => {
    const filtered = filterPool(pool, ["knees"]);
    expect(filtered.legs).not.toContain("Back Squat");
  });

  test("never empties a group entirely, even if every exercise would match", () => {
    const allElbowPool = { biceps: ["Barbell Curl", "Hammer Curl"] };
    const filtered = filterPool(allElbowPool, ["elbows"]);
    expect(filtered.biceps.length).toBeGreaterThan(0);
  });

  test("doesn't touch unrelated groups", () => {
    const filtered = filterPool(pool, ["knees"]);
    expect(filtered.chest).toEqual(pool.chest);
    expect(filtered.biceps).toEqual(pool.biceps);
  });

  test("combines exclusion terms across multiple simultaneous injuries", () => {
    const filtered = filterPool(pool, ["knees", "shoulders"]);
    expect(filtered.legs).not.toContain("Back Squat");
    expect(filtered.shoulders).not.toContain("Overhead Press");
  });

  test("every INJURY_EXCLUDES entry is a non-empty array of strings", () => {
    for (const [injury, terms] of Object.entries(INJURY_EXCLUDES)) {
      expect(Array.isArray(terms)).toBe(true);
      expect(terms.length).toBeGreaterThan(0);
      for (const t of terms) expect(typeof t).toBe("string");
    }
  });
});

describe("injuryDescription", () => {
  test("returns 'none' when nothing is set", () => {
    expect(injuryDescription({ injuries: ["none"], otherInjuries: "" })).toBe("none");
    expect(injuryDescription({})).toBe("none");
  });

  test("whitespace-only free text counts as nothing", () => {
    expect(injuryDescription({ injuries: ["none"], otherInjuries: "   " })).toBe("none");
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

  test("multiple preset injuries all appear", () => {
    const desc = injuryDescription({ injuries: ["knees", "wrists", "elbows"], otherInjuries: "" });
    expect(desc).toContain("knees");
    expect(desc).toContain("wrists");
    expect(desc).toContain("elbows");
  });

  test("underscored preset keys read as words, not raw keys", () => {
    expect(injuryDescription({ injuries: ["lower_back"], otherInjuries: "" })).toContain("lower back");
  });

  test("trims surrounding whitespace off free text", () => {
    expect(injuryDescription({ injuries: ["none"], otherInjuries: "  sciatica  " })).toBe("sciatica");
  });
});

/* ============================================================
   FORM TIPS
============================================================ */
describe("tipsForExercise", () => {
  test("always returns exactly 4 tips, known or unknown exercise", () => {
    expect(tipsForExercise("Back Squat")).toHaveLength(4);
    expect(tipsForExercise("Some Completely Made Up Exercise Name")).toHaveLength(4);
  });

  test("every tip is a non-empty string", () => {
    for (const tip of tipsForExercise("Barbell Bench Press")) {
      expect(typeof tip).toBe("string");
      expect(tip.length).toBeGreaterThan(0);
    }
  });

  test("matches by keyword regardless of equipment prefix", () => {
    expect(tipsForExercise("Back Squat")).toEqual(tipsForExercise("DB Goblet Squat"));
    expect(tipsForExercise("Barbell Curl")).toEqual(tipsForExercise("DB Curl"));
  });

  test.each([
    "Back Squat", "Romanian Deadlift", "Walking Lunge", "Barbell Bench Press",
    "Overhead Press", "Barbell Row", "Cable Fly", "DB Lateral Raise",
    "Barbell Curl", "Tricep Pushdown", "Leg Curl", "Leg Press", "Calf Raise",
    "Weighted Dip", "Plank", "Cable Crunch", "Glute Bridge", "Push-Up",
  ])("recognizes a real tip pattern for %s (not the generic default)", (name) => {
    const defaultTips = tipsForExercise("Zzyzx Totally Unrecognized Move 12345");
    expect(tipsForExercise(name)).not.toEqual(defaultTips);
  });

  test("falls back to the generic default for something matching no pattern", () => {
    const a = tipsForExercise("Zzyzx Totally Unrecognized Move 12345");
    const b = tipsForExercise("Another Nonsense Movement Name");
    expect(a).toEqual(b); // both hit the same DEFAULT_TIPS
  });
});

/* ============================================================
   MUSCLE GROUP MATCHING / ALTERNATIVE EXERCISES
============================================================ */
describe("inferMuscleGroup", () => {
  test.each([
    ["Cable Lateral Raise", "shoulders"],
    ["Seated Leg Curl", "legs"],
    ["Incline Dumbbell Press", "chest"],
    ["Wide-Grip Lat Pulldown", "back"],
    ["Cable Rope Overhead Triceps Extension", "triceps"],
    ["Weighted Cable Crunch", "core"],
    ["Bulgarian Split Squat", "legs"],
    ["Standing Calf Raise", "legs"],
    ["Chin-Up", "back"],
    ["Face Pull", "shoulders"],
  ])("infers %s as %s", (name, expected) => {
    expect(inferMuscleGroup(name)).toBe(expected);
  });

  test("returns null rather than guessing when nothing matches", () => {
    expect(inferMuscleGroup("Zzyzx Nonexistent Move")).toBeNull();
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
    expect(alts).not.toContain("Barbell Curl"); // wrong equipment
  });

  test("respects injury exclusions", () => {
    const alts = alternativesFor("Romanian Deadlift", "full", ["lower_back"]);
    expect(alts.every((n) => !/deadlift|row/i.test(n))).toBe(true);
  });

  test("returns an empty list rather than guessing for an unrecognizable exercise", () => {
    expect(alternativesFor("Zzyzx Nonexistent Move", "full", [])).toEqual([]);
  });

  test("every exercise in every equipment pool resolves to alternatives from its own group (or is the sole member)", () => {
    for (const [equipment, pool] of Object.entries(POOLS)) {
      for (const [group, names] of Object.entries(pool)) {
        for (const name of names) {
          const alts = alternativesFor(name, equipment, []);
          // Should never throw, never include itself, and — since every
          // group in POOLS has more than one exercise — should always
          // suggest at least one real alternative.
          expect(alts).not.toContain(name);
          expect(alts.length).toBeGreaterThan(0);
          // Every suggested alternative should itself belong to the same
          // group's pool (no cross-group leakage).
          for (const alt of alts) expect(pool[group]).toContain(alt);
        }
      }
    }
  });
});

/* ============================================================
   PROGRAM STRUCTURE
============================================================ */
describe("POOLS structural integrity", () => {
  const groups = ["chest", "back", "shoulders", "legs", "biceps", "triceps", "core"];

  test("every equipment type defines exactly the same 7 muscle groups", () => {
    for (const pool of Object.values(POOLS)) {
      expect(Object.keys(pool).sort()).toEqual(groups.slice().sort());
    }
  });

  test("every group in every equipment pool has at least one exercise", () => {
    for (const pool of Object.values(POOLS)) {
      for (const list of Object.values(pool)) {
        expect(list.length).toBeGreaterThan(0);
      }
    }
  });

  test("no duplicate exercise names within a single equipment pool", () => {
    for (const pool of Object.values(POOLS)) {
      const allNames = Object.values(pool).flat();
      expect(new Set(allNames).size).toBe(allNames.length);
    }
  });
});

describe("splitForDays", () => {
  test("3 days or fewer is always a full-body split, any experience level", () => {
    for (const experience of ["beginner", "intermediate", "advanced"]) {
      const split = splitForDays(3, experience);
      expect(split.kinds).toEqual(["full", "full", "full"]);
      expect(split.labels).toHaveLength(3);
    }
  });

  test("4 days is upper/lower, any experience level", () => {
    for (const experience of ["beginner", "intermediate", "advanced"]) {
      const split = splitForDays(4, experience);
      expect(split.kinds).toEqual(["upper", "lower", "upper", "lower"]);
    }
  });

  test("5 days: advanced gets a body-part split, everyone else gets PPL/Upper/Lower", () => {
    expect(splitForDays(5, "advanced").key).toBe("bodypart5");
    expect(splitForDays(5, "intermediate").key).toBe("ppl_ul5");
    expect(splitForDays(5, "beginner").key).toBe("ppl_ul5");
  });

  test("6 days: advanced gets a body-part split, everyone else gets PPL x2", () => {
    expect(splitForDays(6, "advanced").key).toBe("bodypart6");
    expect(splitForDays(6, "intermediate").key).toBe("ppl6");
  });

  test("labels and kinds arrays are always the same length as the day count", () => {
    for (const days of [3, 4, 5, 6]) {
      for (const experience of ["beginner", "intermediate", "advanced"]) {
        const split = splitForDays(days, experience);
        expect(split.labels).toHaveLength(days);
        expect(split.kinds).toHaveLength(days);
      }
    }
  });
});

describe("secondsPerExercise / capFor", () => {
  // The actual bug this formula fixes, found from real beta-tester
  // feedback: a "30-minute" program taking way longer in practice, because
  // rest time BETWEEN SETS wasn't factored into how many exercises fit.
  test("a higher-volume goal (more sets, longer rest) takes meaningfully longer per exercise", () => {
    expect(secondsPerExercise("build")).toBeGreaterThan(secondsPerExercise("lose"));
  });

  test("beginners get one fewer exercise per day than the base cap for their goal", () => {
    const base = capFor({ sessionLength: 60, goal: "recomp", experience: "intermediate" });
    expect(capFor({ sessionLength: 60, goal: "recomp", experience: "beginner" })).toBe(base - 1);
  });

  test("advanced lifters get one more exercise per day than the base cap for their goal", () => {
    const base = capFor({ sessionLength: 60, goal: "recomp", experience: "intermediate" });
    expect(capFor({ sessionLength: 60, goal: "recomp", experience: "advanced" })).toBe(base + 1);
  });

  test("never drops below 2 exercises even for a short session, a beginner, and a high-volume goal", () => {
    // The floor used to be 3, but 3 exercises of a rest-heavy goal like
    // "build" cannot actually fit in a short session — forcing a 3rd
    // exercise guaranteed the exact kind of overrun real testers reported.
    // 2 focused exercises is a legitimate, honestly-timed session instead.
    expect(capFor({ sessionLength: 30, goal: "build", experience: "beginner" })).toBeGreaterThanOrEqual(2);
  });

  test("a missing goal falls back to a sensible default rather than throwing", () => {
    expect(() => capFor({ sessionLength: 60, experience: "intermediate" })).not.toThrow();
    expect(capFor({ sessionLength: 60, experience: "intermediate" })).toBeGreaterThanOrEqual(2);
  });

  test("longer sessions allow strictly more exercises than shorter ones, same goal and experience", () => {
    const short = capFor({ sessionLength: 30, goal: "recomp", experience: "intermediate" });
    const long = capFor({ sessionLength: 75, goal: "recomp", experience: "intermediate" });
    expect(long).toBeGreaterThan(short);
  });

  test("the same session length allows fewer (or equal) exercises for a higher-volume goal", () => {
    const buildCap = capFor({ sessionLength: 60, goal: "build", experience: "intermediate" });
    const loseCap = capFor({ sessionLength: 60, goal: "lose", experience: "intermediate" });
    expect(buildCap).toBeLessThanOrEqual(loseCap);
  });

  // Pins the actual real-world calibration behind the constants: two real
  // beta reports (build/30min running ~50min, and recomp/60min running
  // ~90min) showed the old formula underestimating real execution time by
  // roughly 50-70%, consistently across both a short and a long session.
  // These lock in that the modeled total (cap * secondsPerExercise) now
  // lands close to what the person actually asked for, instead of close to
  // the old, too-optimistic number.
  test("a 30-min build session's modeled total lands close to 30 minutes, not the old ~30-min-that-became-50", () => {
    const profile = { sessionLength: 30, goal: "build", experience: "intermediate" };
    const modeledSeconds = capFor(profile) * secondsPerExercise(profile.goal);
    expect(modeledSeconds / 60).toBeGreaterThanOrEqual(25);
    expect(modeledSeconds / 60).toBeLessThanOrEqual(38);
  });

  test("a 60-min recomp session's modeled total lands close to 60 minutes, not the old ~60-min-that-became-90", () => {
    const profile = { sessionLength: 60, goal: "recomp", experience: "intermediate" };
    const modeledSeconds = capFor(profile) * secondsPerExercise(profile.goal);
    expect(modeledSeconds / 60).toBeGreaterThanOrEqual(50);
    expect(modeledSeconds / 60).toBeLessThanOrEqual(70);
  });
});

// Regression coverage for a real report: a tester reduced their program's
// sets/rest specifically to fit more exercises, but the Coach kept citing
// the same exercise-count ceiling as before — because it was computed from
// profile.goal's static default sets/rest, with no way to reflect that the
// actual program had since diverged from that default.
describe("capForProgram (live ceiling from the actual current program)", () => {
  test("recognizes a real sets/rest reduction the user made — the ceiling goes up, not stays frozen", () => {
    const heavyProgram = { days: [{ name: "Day 1", exercises: [{ name: "Squat", sets: 4, rest: 90 }] }] };
    const lightProgram = { days: [{ name: "Day 1", exercises: [{ name: "Squat", sets: 2, rest: 30 }] }] };
    const heavyCap = capForProgram(heavyProgram, 30, "intermediate");
    const lightCap = capForProgram(lightProgram, 30, "intermediate");
    expect(lightCap).toBeGreaterThan(heavyCap);
  });

  test("averages sets/rest across every exercise in the program, not just the first one", () => {
    const program = {
      days: [
        { name: "Day 1", exercises: [{ name: "A", sets: 2, rest: 30 }, { name: "B", sets: 4, rest: 90 }] },
      ],
    };
    // Landed on by averaging each exercise's own computed time (2,30 and
    // 4,90), not just reading the first exercise's numbers.
    const viaAverage = capForProgram(program, 45, "intermediate");
    const uniform = capForProgram({ days: [{ name: "Day 1", exercises: [{ name: "A", sets: 3, rest: 60 }] }] }, 45, "intermediate");
    expect(viaAverage).toBe(uniform);
  });

  test("returns null when there's no program yet to read real numbers from, so callers can fall back to capFor", () => {
    expect(capForProgram(null, 30, "intermediate")).toBeNull();
    expect(capForProgram({ days: [] }, 30, "intermediate")).toBeNull();
  });

  test("still respects the experience adjustment and the 2-exercise floor", () => {
    const program = { days: [{ name: "Day 1", exercises: [{ name: "A", sets: 4, rest: 90 }] }] };
    const beginnerCap = capForProgram(program, 45, "beginner");
    const advancedCap = capForProgram(program, 45, "advanced");
    expect(advancedCap).toBeGreaterThan(beginnerCap);
    // A very short, set/rest-heavy combination still never drops below 2.
    expect(capForProgram(program, 20, "beginner")).toBeGreaterThanOrEqual(2);
  });

  // A single-arm/single-leg exercise takes roughly double the time of the
  // same sets/rest done bilaterally (both sides, one at a time) — the
  // model needs to know that or it underestimates a unilateral-heavy day.
  test("a unilateral exercise lowers the ceiling vs. the identical sets/rest done bilaterally", () => {
    const bilateral = { days: [{ name: "Day 1", exercises: [{ name: "Leg Press", sets: 3, rest: 90 }] }] };
    const unilateral = { days: [{ name: "Day 1", exercises: [{ name: "Bulgarian Split Squat", sets: 3, rest: 90 }] }] };
    expect(capForProgram(unilateral, 45, "intermediate")).toBeLessThan(capForProgram(bilateral, 45, "intermediate"));
  });
});

describe("isUnilateral", () => {
  test("recognizes common single-arm/single-leg exercise names", () => {
    for (const name of ["Bulgarian Split Squat", "Single-Arm Dumbbell Row", "Walking Lunge", "Dumbbell Step-Up", "Pistol Squat", "1-Arm Row"]) {
      expect(isUnilateral(name)).toBe(true);
    }
  });

  test("does not flag ordinary bilateral exercises, including ones with 'leg' in the name", () => {
    for (const name of ["Back Squat", "Leg Press", "Leg Curl", "Leg Extension", "Barbell Row"]) {
      expect(isUnilateral(name)).toBe(false);
    }
  });

  test("handles a missing name without throwing", () => {
    expect(isUnilateral(undefined)).toBe(false);
  });
});

describe("buildProgram (offline rule-based fallback)", () => {
  test("produces exactly as many days as requested, every days/week option", () => {
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

  test("every exercise used actually comes from that equipment's POOLS", () => {
    for (const equipment of ["full", "dumbbell", "bodyweight"]) {
      const program = buildProgram({ ...baseProfile, equipment });
      const validNames = new Set(Object.values(POOLS[equipment]).flat());
      for (const day of program.days) {
        for (const ex of day.exercises) {
          expect(validNames.has(ex.name)).toBe(true);
        }
      }
    }
  });

  test("sets/reps/rest scheme matches the stated goal", () => {
    for (const goal of ["lose", "build", "recomp"]) {
      const program = buildProgram({ ...baseProfile, goal });
      const scheme = GOAL_SCHEME[goal];
      for (const day of program.days) {
        for (const ex of day.exercises) {
          expect(ex.sets).toBe(scheme.sets);
          expect(ex.reps).toBe(scheme.reps);
          expect(ex.rest).toBe(scheme.rest);
        }
      }
    }
  });

  test("respects injury exclusions end to end", () => {
    const program = buildProgram({ ...baseProfile, injuries: ["knees"] });
    const names = program.days.flatMap((d) => d.exercises.map((e) => e.name));
    expect(names).not.toContain("Back Squat");
  });

  test("a longer session produces at least as many exercises per day as a shorter one", () => {
    const short = buildProgram({ ...baseProfile, sessionLength: 30 });
    const long = buildProgram({ ...baseProfile, sessionLength: 75 });
    const avgLen = (p) => p.days.reduce((a, d) => a + d.exercises.length, 0) / p.days.length;
    expect(avgLen(long)).toBeGreaterThanOrEqual(avgLen(short));
  });

  test("splitName is set and non-empty for every experience/day combination", () => {
    for (const daysPerWeek of [3, 4, 5, 6]) {
      for (const experience of ["beginner", "intermediate", "advanced"]) {
        const program = buildProgram({ ...baseProfile, daysPerWeek, experience });
        expect(typeof program.splitName).toBe("string");
        expect(program.splitName.length).toBeGreaterThan(0);
      }
    }
  });

  // Regression coverage for a real report: a 3-day Full Body split's "Full
  // Body A" and "Full Body B" came out with the exact same exercises. Root
  // cause was the old offset formula only producing two buckets ("first
  // half of days" vs "second half"), which collapsed to the same bucket for
  // days 0 and 1 whenever the day count was odd (3 days -> half = 1.5).
  test("two days sharing the same kind (e.g. a 3-day Full Body split) never come out with identical exercises", () => {
    for (const daysPerWeek of [3, 6]) {
      const program = buildProgram({ ...baseProfile, daysPerWeek, experience: "intermediate" });
      const namesByDay = program.days.map((d) => d.exercises.map((e) => e.name).join(","));
      const uniqueDays = new Set(namesByDay);
      expect(uniqueDays.size).toBe(namesByDay.length);
    }
  });
});

/* ============================================================
   TIPS / ALTERNATIVES BACKFILL
============================================================ */
describe("withTips", () => {
  test("fills in tips for an exercise that doesn't have any", () => {
    const result = withTips([{ name: "Back Squat", sets: 3, reps: "8-12", rest: 90 }]);
    expect(result[0].tips).toHaveLength(4);
  });

  test("never overwrites tips that are already present", () => {
    const customTips = ["a", "b", "c", "d"];
    const result = withTips([{ name: "Back Squat", tips: customTips }]);
    expect(result[0].tips).toBe(customTips); // same reference, untouched
  });

  test("treats an empty tips array as missing and fills it in", () => {
    const result = withTips([{ name: "Back Squat", tips: [] }]);
    expect(result[0].tips.length).toBeGreaterThan(0);
  });

  test("handles an empty or missing exercise list without throwing", () => {
    expect(withTips([])).toEqual([]);
    expect(withTips(undefined)).toEqual([]);
    expect(withTips(null)).toEqual([]);
  });

  test("preserves every other field on each exercise untouched", () => {
    const result = withTips([{ name: "Back Squat", sets: 5, reps: "5-5", rest: 180, alternatives: ["x"] }]);
    expect(result[0]).toMatchObject({ name: "Back Squat", sets: 5, reps: "5-5", rest: 180, alternatives: ["x"] });
  });
});

describe("normalizeProgramTips", () => {
  test("fills in tips across every exercise on every day", () => {
    const program = {
      splitName: "Test Split",
      days: [
        { name: "Day A", exercises: [{ name: "Back Squat" }, { name: "Barbell Bench Press" }] },
        { name: "Day B", exercises: [{ name: "Barbell Row" }] },
      ],
    };
    const result = normalizeProgramTips(program);
    for (const day of result.days) {
      for (const ex of day.exercises) {
        expect(ex.tips.length).toBeGreaterThan(0);
      }
    }
  });

  test("passes null through unchanged rather than throwing", () => {
    expect(normalizeProgramTips(null)).toBeNull();
  });

  test("preserves splitName and day names", () => {
    const program = { splitName: "PPL", days: [{ name: "Push", exercises: [{ name: "Overhead Press" }] }] };
    const result = normalizeProgramTips(program);
    expect(result.splitName).toBe("PPL");
    expect(result.days[0].name).toBe("Push");
  });
});

// Regression coverage for a real beta-report: the Coach chat AI edited a
// user's program across several turns (removing an exercise, renaming a day)
// and the program's own splitName field — a second, freely-written copy of
// the same fact — drifted out of sync with the actual day list, even though
// the days themselves stayed correct the whole time. The AI eventually had to
// notice and "fix" its own stale label. Deriving the label from the day names
// instead of trusting the AI's separate splitName field removes that failure
// mode entirely: there is only one source of truth, so the label can never
// disagree with the schedule.
describe("deriveSplitName", () => {
  test("collapses verbose AI-authored day names into a concise pattern, matching splitDisplayName's convention", () => {
    const days = [
      { name: "Push (Chest/Triceps/Shoulders)" },
      { name: "Pull (Back/Biceps)" },
      { name: "Legs (Knee-Friendly)" },
      { name: "Push (Shoulders/Chest Volume)" },
      { name: "Pull (Back/Biceps + Conditioning)" },
    ];
    expect(deriveSplitName(days)).toBe("Push / Pull / Legs");
  });

  test("strips the offline path's trailing day-letter suffix ('Push A' / 'Push B') the same way", () => {
    const days = [
      { name: "Push A" }, { name: "Pull A" }, { name: "Legs A" },
      { name: "Push B" }, { name: "Pull B" }, { name: "Legs B" },
    ];
    expect(deriveSplitName(days)).toBe("Push / Pull / Legs");
  });

  test("never disagrees with the actual day list, however the days get edited later", () => {
    // Simulates the exact failure from the transcript: whatever the model's
    // own free-text splitName claims, the derived label always tracks the
    // real, current days.
    const days = [{ name: "Push" }, { name: "Pull" }, { name: "Legs" }, { name: "Push" }, { name: "Pull" }];
    expect(deriveSplitName(days)).toBe("Push / Pull / Legs");
  });

  test("handles an empty or missing day list without throwing", () => {
    expect(deriveSplitName([])).toBe("");
    expect(deriveSplitName(undefined)).toBe("");
  });
});

// Regression coverage for a real report: asking Coach for a one-time leg
// session left the active workout screen's header still reading "Push"
// (the originally scheduled day) while every exercise listed was for legs
// — todayOverride has no name field of its own, so nothing updated the
// title to match what was actually swapped in.
describe("overrideDayName", () => {
  test("derives a title from what the override actually contains, not a stale scheduled-day name", () => {
    const exercises = [{ name: "Back Squat" }, { name: "Romanian Deadlift" }, { name: "Leg Press" }];
    expect(overrideDayName(exercises)).toBe("Leg Day");
  });

  test("combines up to two muscle groups when the override spans more than one", () => {
    const exercises = [{ name: "Back Squat" }, { name: "Barbell Row" }];
    expect(overrideDayName(exercises)).toBe("Leg/Back Day");
  });

  test("falls back to a generic label when nothing in the override is recognizable", () => {
    expect(overrideDayName([{ name: "Some Weird Machine" }])).toBe("Today's Session");
    expect(overrideDayName([])).toBe("Today's Session");
  });
});

// Regression coverage for a real beta report: the coach confidently said
// "Done!" after being asked to permanently remove an exercise, but the
// exercise was still there afterward. One concrete way that can happen in
// code (as opposed to the model simply generating wrong content): the parsed
// JSON response left "reply" blank/missing on a turn where nothing else in
// the response changed either — previously papered over with a hardcoded
// "Done!" regardless.
describe("coachResponseFlags / coachReplyText", () => {
  test("a response with a real program change is flagged as a change", () => {
    const parsed = { reply: "Done!", program: { splitName: "PPL", days: [{ name: "Push", exercises: [] }] }, todayOverride: null };
    const flags = coachResponseFlags(parsed);
    expect(flags.hasNewProgram).toBe(true);
    expect(flags.madeChange).toBe(true);
  });

  test("a response with nothing set (no program, override, targets, or restore) is not a change", () => {
    const parsed = { reply: "Sure, happy to help with that question.", program: null, todayOverride: null, targets: null };
    expect(coachResponseFlags(parsed).madeChange).toBe(false);
  });

  test("todayOverride takes precedence over a stray program field, matching the one-time-swap contract", () => {
    const parsed = { program: { days: [{ name: "Legs", exercises: [] }] }, todayOverride: [{ name: "Leg Extension" }] };
    const flags = coachResponseFlags(parsed);
    expect(flags.hasOverride).toBe(true);
    expect(flags.hasNewProgram).toBe(false);
  });

  test("a blank reply on a turn with a real change still falls back to a confident Done!", () => {
    const parsed = { reply: "", program: { days: [{ name: "Push", exercises: [] }] } };
    expect(coachReplyText(parsed, true)).toBe("Done!");
  });

  test("a blank reply on a no-op turn does NOT falsely claim success — this is the fix for the bug report", () => {
    const parsed = { reply: "", program: null, todayOverride: null };
    const text = coachReplyText(parsed, false);
    expect(text).not.toBe("Done!");
    expect(text.toLowerCase()).toContain("rephras");
  });

  test("a real reply from the model always wins over either fallback", () => {
    expect(coachReplyText({ reply: "Removed battle ropes from every day." }, true)).toBe("Removed battle ropes from every day.");
  });
});

/* ============================================================
   OFFLINE LOCAL-STORAGE LAYER
   (the storage layer underneath the persist() bug fixed earlier — worth
   covering directly, even though the React-timing bug itself needs a
   different kind of test than pure functions can provide.)
============================================================ */
describe("local storage layer", () => {
  // Minimal in-memory localStorage so these tests work in the plain node
  // test environment without needing jsdom.
  class MemoryStorage {
    constructor() { this.store = new Map(); }
    getItem(key) { return this.store.has(key) ? this.store.get(key) : null; }
    setItem(key, value) { this.store.set(key, String(value)); }
    removeItem(key) { this.store.delete(key); }
    clear() { this.store.clear(); }
  }

  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage();
  });

  test("read returns null when nothing has been saved yet", () => {
    expect(readLocalState("user-1")).toBeNull();
  });

  test("write then read round-trips the exact same data", () => {
    const state = { program: { splitName: "PPL" }, logs: { workouts: [] } };
    writeLocalState("user-1", state);
    expect(readLocalState("user-1")).toEqual(state);
  });

  test("different users' saved state never collide", () => {
    writeLocalState("user-1", { value: "for user 1" });
    writeLocalState("user-2", { value: "for user 2" });
    expect(readLocalState("user-1").value).toBe("for user 1");
    expect(readLocalState("user-2").value).toBe("for user 2");
  });

  test("corrupt JSON in storage returns null instead of throwing", () => {
    globalThis.localStorage.setItem("overload_state_user-1", "{not valid json");
    expect(() => readLocalState("user-1")).not.toThrow();
    expect(readLocalState("user-1")).toBeNull();
  });

  test("writeLocalState never throws even if localStorage.setItem does (e.g. quota exceeded)", () => {
    globalThis.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    expect(() => writeLocalState("user-1", { a: 1 })).not.toThrow();
  });

  test("pending-sync flag defaults to false and toggles correctly", () => {
    expect(hasPendingSync("user-1")).toBe(false);
    setPendingSync("user-1", true);
    expect(hasPendingSync("user-1")).toBe(true);
    setPendingSync("user-1", false);
    expect(hasPendingSync("user-1")).toBe(false);
  });

  test("pending-sync flags are per-user", () => {
    setPendingSync("user-1", true);
    expect(hasPendingSync("user-2")).toBe(false);
  });
});

/* ============================================================
   DATE HANDLING — a real bug found in audit: todayISO() previously used
   toISOString() (UTC), which silently shifts the day boundary by several
   hours for anyone not near UTC — a meal logged at 11pm Pacific time could
   get bucketed into "tomorrow." dateToISO/parseISODate fix this by working
   in local calendar-day components throughout.
============================================================ */
describe("dateToISO / parseISODate (local calendar day helpers)", () => {
  const originalTZ = process.env.TZ;
  beforeEach(() => { process.env.TZ = "America/Los_Angeles"; });
  afterEach(() => { process.env.TZ = originalTZ; });

  test("dateToISO returns the LOCAL calendar date, not the UTC one", () => {
    // 11:30pm Jan 15 Pacific time is 7:30am Jan 16 UTC — a toISOString()-based
    // implementation would incorrectly return "2026-01-16" here.
    const d = new Date(2026, 0, 15, 23, 30); // local components: Jan 15, 11:30pm
    expect(dateToISO(d)).toBe("2026-01-15");
  });

  test("parseISODate reconstructs the exact local calendar day, including across a month boundary", () => {
    const d = parseISODate("2026-02-01");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1); // February, zero-indexed
    expect(d.getDate()).toBe(1);
  });

  test("round-trips cleanly for dates across month and year boundaries", () => {
    for (const s of ["2026-01-01", "2026-02-28", "2026-12-31", "2026-06-15"]) {
      expect(dateToISO(parseISODate(s))).toBe(s);
    }
  });

  test("pads single-digit months and days with a leading zero", () => {
    expect(dateToISO(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

/* ============================================================
   COACH JSON RECOVERY (when a response gets cut off / doesn't fully parse)
============================================================ */
describe("extractReplyOnly", () => {
  test("pulls the reply text out of otherwise-broken JSON", () => {
    const truncated = '{"reply": "Done — your program is updated.", "program": {"splitName": "PP';
    expect(extractReplyOnly(truncated)).toBe("Done — your program is updated.");
  });

  test("handles escaped quotes inside the reply text", () => {
    // The JSON text itself (as an actual string, backslashes and all):
    // {"reply": "Here's your \"updated\" plan.", "program": null}
    const raw = '{"reply": "Here\'s your \\"updated\\" plan.", "program": null}';
    expect(extractReplyOnly(raw)).toBe('Here\'s your "updated" plan.');
  });

  test("returns null when there's no reply field to find", () => {
    expect(extractReplyOnly("not json and no reply field at all")).toBeNull();
  });
});

/* ============================================================
   PROGRAM-BUILDING INTERNALS (pick / buildDay)
============================================================ */
describe("pick", () => {
  const arr = ["a", "b", "c", "d"];

  test("returns the first n items with no offset", () => {
    expect(pick(arr, 2)).toEqual(["a", "b"]);
  });

  test("rotates by the offset before taking n items", () => {
    expect(pick(arr, 2, 1)).toEqual(["b", "c"]);
    expect(pick(arr, 2, 2)).toEqual(["c", "d"]);
  });

  test("wraps around the end of the array", () => {
    expect(pick(arr, 2, 3)).toEqual(["d", "a"]);
  });

  test("offset wraps via modulo for values larger than the array length", () => {
    expect(pick(arr, 2, 3)).toEqual(pick(arr, 2, 3 + arr.length));
  });

  test("never returns more items than the array actually has", () => {
    expect(pick(arr, 10)).toHaveLength(arr.length);
  });

  test("requesting 0 items returns an empty array", () => {
    expect(pick(arr, 0)).toEqual([]);
  });
});

describe("buildDay", () => {
  const pool = {
    legs: ["Squat", "RDL", "Leg Press", "Leg Curl", "Calf Raise"],
    chest: ["Bench Press"],
    back: ["Row"],
    shoulders: ["Overhead Press"],
    core: ["Plank"],
  };

  test("produces exercises with the sets/reps/rest for the given goal", () => {
    const day = buildDay("full", pool, "build", 10, 0);
    const scheme = GOAL_SCHEME.build;
    for (const ex of day) {
      expect(ex.sets).toBe(scheme.sets);
      expect(ex.reps).toBe(scheme.reps);
      expect(ex.rest).toBe(scheme.rest);
    }
  });

  test("never exceeds the given cap", () => {
    const day = buildDay("full", pool, "recomp", 2, 0);
    expect(day.length).toBeLessThanOrEqual(2);
  });

  test("a higher cap allows more exercises (up to what the template requests)", () => {
    const small = buildDay("full", pool, "recomp", 2, 0);
    const large = buildDay("full", pool, "recomp", 10, 0);
    expect(large.length).toBeGreaterThan(small.length);
  });
});

describe("splitDisplayName", () => {
  test("maps every real split key to a non-empty display name", () => {
    for (const key of ["full3", "ul4", "ppl_ul5", "ppl6", "bodypart5", "bodypart6"]) {
      const name = splitDisplayName(key);
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test("splitForDays always produces a key that splitDisplayName recognizes", () => {
    for (const days of [3, 4, 5, 6]) {
      for (const experience of ["beginner", "intermediate", "advanced"]) {
        const split = splitForDays(days, experience);
        expect(splitDisplayName(split.key)).toBeTruthy();
      }
    }
  });
});

/* ============================================================
   TRIAL LOGIC
============================================================ */
describe("isTrialActive / trialDaysLeft", () => {
  const DAY = 24 * 60 * 60 * 1000;

  test("no start date means no active trial and zero days left", () => {
    expect(isTrialActive(null)).toBe(false);
    expect(isTrialActive(undefined)).toBe(false);
    expect(trialDaysLeft(null)).toBe(0);
  });

  test("a trial started just now is active with ~30 days left", () => {
    const now = new Date().toISOString();
    expect(isTrialActive(now)).toBe(true);
    expect(trialDaysLeft(now)).toBe(30);
  });

  test("a trial started 29 days ago is still active with 1 day left", () => {
    const startedAt = new Date(Date.now() - 29 * DAY).toISOString();
    expect(isTrialActive(startedAt)).toBe(true);
    expect(trialDaysLeft(startedAt)).toBe(1);
  });

  test("a trial started exactly 30 days ago has ended", () => {
    const startedAt = new Date(Date.now() - 30 * DAY).toISOString();
    expect(isTrialActive(startedAt)).toBe(false);
  });

  test("a trial started 45 days ago has ended, with zero (not negative) days left", () => {
    const startedAt = new Date(Date.now() - 45 * DAY).toISOString();
    expect(isTrialActive(startedAt)).toBe(false);
    expect(trialDaysLeft(startedAt)).toBe(0);
  });
});

/* ============================================================
   PROGRESS TAB HELPERS
============================================================ */
describe("monthKey", () => {
  test("same month, different days, produces the same key", () => {
    expect(monthKey(new Date(2026, 2, 1))).toBe(monthKey(new Date(2026, 2, 28)));
  });

  test("different months produce different keys, including across a year boundary", () => {
    expect(monthKey(new Date(2026, 0, 15))).not.toBe(monthKey(new Date(2026, 1, 15)));
    expect(monthKey(new Date(2025, 11, 31))).not.toBe(monthKey(new Date(2026, 0, 1)));
  });
});

describe("exerciseHistory", () => {
  const logs = {
    workouts: [
      { date: "2026-01-01", exercises: [{ name: "Back Squat", logged: [{ weight: "135", reps: "8", done: true }, { weight: "155", reps: "5", done: true }] }] },
      { date: "2026-01-08", exercises: [{ name: "Back Squat", logged: [{ weight: "165", reps: "5", done: true }] }] },
      { date: "2026-01-08", exercises: [{ name: "Bench Press", logged: [{ weight: "", reps: "", done: false }] }] },
    ],
  };

  test("returns one entry per workout that included the exercise, in date order", () => {
    const history = exerciseHistory(logs, "Back Squat");
    expect(history).toHaveLength(2);
    expect(history[0].date).toBe("2026-01-01");
    expect(history[1].date).toBe("2026-01-08");
  });

  test("picks the heaviest logged set as that day's top set", () => {
    const history = exerciseHistory(logs, "Back Squat");
    expect(history[0].weight).toBe(155); // heavier of the two sets logged that day
  });

  test("skips workouts where the exercise was present but nothing was actually logged", () => {
    const history = exerciseHistory(logs, "Bench Press");
    expect(history).toHaveLength(0);
  });

  test("returns an empty array for an exercise never logged", () => {
    expect(exerciseHistory(logs, "Never Done This")).toEqual([]);
  });
});

// Powers the mid-workout "History & PR" view (WorkoutSession's ExerciseDetailSheet).
describe("exercisePR", () => {
  const logs = {
    workouts: [
      { date: "2026-01-01", exercises: [{ name: "Back Squat", logged: [{ weight: "135", reps: "8", done: true }, { weight: "155", reps: "5", done: true }] }] },
      { date: "2026-01-08", exercises: [{ name: "Back Squat", logged: [{ weight: "165", reps: "5", done: true }] }] },
      { date: "2026-01-15", exercises: [{ name: "Back Squat", logged: [{ weight: "165", reps: "3", done: true }] }] },
    ],
  };

  test("returns the heaviest set ever logged, across all workouts, not just the most recent", () => {
    expect(exercisePR(logs, "Back Squat")).toEqual({ date: "2026-01-08", dateLabel: "01-08", weight: 165, reps: 5 });
  });

  test("ties on weight are broken by more reps — that's the harder set to have actually beaten", () => {
    // Both 2026-01-08 and 2026-01-15 hit 165lb; 01-08's 5 reps beats 01-15's 3.
    const pr = exercisePR(logs, "Back Squat");
    expect(pr.reps).toBe(5);
  });

  test("returns null for an exercise with no logged history", () => {
    expect(exercisePR(logs, "Never Done This")).toBeNull();
  });
});

describe("exerciseLastSession", () => {
  const logs = {
    workouts: [
      { date: "2026-01-01", exercises: [{ name: "Back Squat", logged: [{ weight: "135", reps: "8", done: true }] }] },
      { date: "2026-01-15", exercises: [{ name: "Back Squat", logged: [{ weight: "165", reps: "5", done: true }, { weight: "175", reps: "3", done: true }] }] },
      { date: "2026-01-08", exercises: [{ name: "Back Squat", logged: [{ weight: "150", reps: "6", done: true }] }] },
    ],
  };

  test("uses the most recent date, not array order, and returns every logged set from it", () => {
    const last = exerciseLastSession(logs, "Back Squat");
    expect(last.date).toBe("2026-01-15");
    expect(last.sets).toEqual([{ weight: 165, reps: 5 }, { weight: 175, reps: 3 }]);
  });

  test("returns null for an exercise never logged", () => {
    expect(exerciseLastSession(logs, "Never Done This")).toBeNull();
  });
});

// Regression coverage for a real report: a user asked Coach to swap an
// exercise while their workout sat saved-and-exited mid-session; resuming
// kept showing the OLD exercise no matter how many times Coach "applied"
// the change, because the saved snapshot fully overrode the current
// exercise list instead of being merged with it.
describe("mergeResumedSets", () => {
  const savedSets = [
    { name: "Trap Bar Deadlift", reps: "6-8", rest: 120, tips: ["a"], logged: [{ weight: "225", reps: "6", done: true }] },
    { name: "Leg Press", reps: "8-10", rest: 100, tips: ["b"], logged: [{ weight: "", reps: "", done: false }] },
  ];

  test("an exercise swapped in since saving (e.g. via Coach todayOverride) replaces the old one, not the reverse", () => {
    const freshExercises = [
      { name: "Barbell Hip Thrust", sets: 1, reps: "6-8", rest: 120 }, // swapped in place of Trap Bar Deadlift
      { name: "Leg Press", sets: 1, reps: "8-10", rest: 100 },
    ];
    const merged = mergeResumedSets(freshExercises, savedSets);
    const names = merged.map((e) => e.name);
    expect(names).toEqual(["Barbell Hip Thrust", "Leg Press"]);
    expect(names).not.toContain("Trap Bar Deadlift");
  });

  test("the swapped-in exercise starts with blank logged sets, not leftover data from the exercise it replaced", () => {
    const freshExercises = [{ name: "Barbell Hip Thrust", sets: 1, reps: "6-8", rest: 120 }];
    const merged = mergeResumedSets(freshExercises, savedSets);
    expect(merged[0].logged).toEqual([{ weight: "", reps: "", done: false }]);
  });

  test("an exercise that's still there by name keeps its already-logged progress", () => {
    const freshExercises = [
      { name: "Trap Bar Deadlift", sets: 1, reps: "6-8", rest: 120 },
      { name: "Leg Press", sets: 1, reps: "8-10", rest: 100 },
    ];
    const merged = mergeResumedSets(freshExercises, savedSets);
    expect(merged[0].logged).toEqual([{ weight: "225", reps: "6", done: true }]);
  });

  test("returns null (so the caller falls back to a fresh build) when there's no saved snapshot", () => {
    expect(mergeResumedSets([{ name: "Squat", sets: 3, reps: "8-12", rest: 90 }], null)).toBeNull();
  });
});

describe("seedLoggedSets", () => {
  const logs = {
    workouts: [
      { date: "2026-08-01", exercises: [{ name: "Bench Press", logged: [{ weight: "135", reps: "8", done: true }, { weight: "145", reps: "6", done: true }] }] },
    ],
  };

  test("pre-fills weight/reps from the last time this exercise was logged, matched by set position", () => {
    const seeded = seedLoggedSets({ name: "Bench Press", sets: 2 }, logs);
    expect(seeded).toEqual([
      { weight: "135", reps: "8", done: false },
      { weight: "145", reps: "6", done: false },
    ]);
  });

  test("leaves a set slot blank when last time had fewer sets than today's plan", () => {
    const seeded = seedLoggedSets({ name: "Bench Press", sets: 3 }, logs);
    expect(seeded[2]).toEqual({ weight: "", reps: "", done: false });
  });

  test("falls back to blank sets for an exercise with no history at all", () => {
    const seeded = seedLoggedSets({ name: "Never Done This", sets: 2 }, logs);
    expect(seeded).toEqual([{ weight: "", reps: "", done: false }, { weight: "", reps: "", done: false }]);
  });

  test("falls back to blank sets when logs isn't available (e.g. offline)", () => {
    expect(seedLoggedSets({ name: "Bench Press", sets: 1 }, null)).toEqual([{ weight: "", reps: "", done: false }]);
  });
});

describe("accumulateActiveSeconds", () => {
  test("adds this stretch's elapsed time to whatever was already accumulated", () => {
    const resumedAt = 1000;
    const now = 1000 + 42_000; // 42 real seconds later
    expect(accumulateActiveSeconds(100, resumedAt, now)).toBe(142);
  });

  test("a save-and-resume gap of days does not get counted — only time since resumedAt does", () => {
    const resumedAt = Date.now();
    const now = resumedAt + 30_000; // 30s of actual active time just now
    // Even though "prior" already reflects an earlier active stretch from
    // days ago, the gap itself (the days in between) was never accumulated
    // in the first place — it was never part of any active stretch.
    expect(accumulateActiveSeconds(600, resumedAt, now)).toBe(630);
  });

  test("treats a missing prior value as zero rather than NaN", () => {
    expect(accumulateActiveSeconds(undefined, 1000, 5000)).toBe(4);
  });

  test("never goes negative even if clocks are weird", () => {
    expect(accumulateActiveSeconds(10, 5000, 1000)).toBe(10);
  });
});

describe("formatDuration", () => {
  test("formats under an hour as minutes", () => {
    expect(formatDuration(42 * 60)).toBe("42 min");
  });

  test("formats an hour or more as h/m", () => {
    expect(formatDuration(72 * 60)).toBe("1h 12m");
  });

  test("omits minutes when it's an exact hour", () => {
    expect(formatDuration(60 * 60)).toBe("1h");
  });

  test("rounds a sub-minute duration up to 1 min rather than showing 0", () => {
    expect(formatDuration(20)).toBe("1 min");
  });

  test("returns null for zero/missing duration rather than a misleading '0 min'", () => {
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
  });
});

describe("recentProgressHighlights", () => {
  test("reports an exercise from the last workout whose weight went up since the time before", () => {
    const logs = {
      workouts: [
        { date: "2026-08-01", exercises: [{ name: "Bench Press", logged: [{ weight: "135", reps: "8", done: true }] }] },
        { date: "2026-08-08", exercises: [{ name: "Bench Press", logged: [{ weight: "145", reps: "8", done: true }] }] },
      ],
    };
    const highlights = recentProgressHighlights(logs);
    expect(highlights).toEqual([{ name: "Bench Press", delta: 10, weight: 145, reps: 8 }]);
  });

  test("says nothing about an exercise that went down or stayed flat — never reports a decline", () => {
    const logs = {
      workouts: [
        { date: "2026-08-01", exercises: [{ name: "Bench Press", logged: [{ weight: "145", reps: "8", done: true }] }] },
        { date: "2026-08-08", exercises: [{ name: "Bench Press", logged: [{ weight: "135", reps: "8", done: true }] }] },
      ],
    };
    expect(recentProgressHighlights(logs)).toEqual([]);
  });

  test("ignores an exercise only logged once — nothing to compare against yet", () => {
    const logs = { workouts: [{ date: "2026-08-01", exercises: [{ name: "Bench Press", logged: [{ weight: "135", reps: "8", done: true }] }] }] };
    expect(recentProgressHighlights(logs)).toEqual([]);
  });

  test("only looks at exercises from the MOST RECENT workout, sorted biggest jump first, capped at the limit", () => {
    const logs = {
      workouts: [
        { date: "2026-08-01", exercises: [
          { name: "Bench Press", logged: [{ weight: "135", reps: "8", done: true }] },
          { name: "Squat", logged: [{ weight: "185", reps: "5", done: true }] },
          { name: "Row", logged: [{ weight: "95", reps: "10", done: true }] },
        ] },
        { date: "2026-08-08", exercises: [
          { name: "Bench Press", logged: [{ weight: "140", reps: "8", done: true }] }, // +5
          { name: "Squat", logged: [{ weight: "205", reps: "5", done: true }] }, // +20
          { name: "Row", logged: [{ weight: "100", reps: "10", done: true }] }, // +5
        ] },
      ],
    };
    const highlights = recentProgressHighlights(logs, 2);
    expect(highlights).toHaveLength(2);
    expect(highlights[0].name).toBe("Squat"); // biggest jump first
  });

  test("returns an empty array when there are no workouts logged yet", () => {
    expect(recentProgressHighlights({ workouts: [] })).toEqual([]);
  });
});

describe("detectCoachInsight", () => {
  function daysAgo(n) {
    return dateToISO(new Date(Date.now() - n * 86400000));
  }

  test("returns null with no logs/profile at all", () => {
    expect(detectCoachInsight({})).toBeNull();
    expect(detectCoachInsight(null)).toBeNull();
  });

  test("returns null for a healthy state — good adherence, on-time duration, no stalled lift", () => {
    const state = {
      profile: { daysPerWeek: 3, sessionLength: 45 },
      program: { days: [{ name: "Day 1", exercises: [{ name: "Bench Press" }] }] },
      logs: {
        workouts: [
          { date: daysAgo(1), dayName: "Day 1", exercises: [{ name: "Bench Press", logged: [{ weight: "135", reps: "8", done: true }] }], durationSec: 2600 },
          { date: daysAgo(3), dayName: "Day 1", exercises: [{ name: "Bench Press", logged: [{ weight: "130", reps: "8", done: true }] }], durationSec: 2500 },
          { date: daysAgo(5), dayName: "Day 1", exercises: [{ name: "Bench Press", logged: [{ weight: "125", reps: "8", done: true }] }], durationSec: 2500 },
        ],
      },
    };
    expect(detectCoachInsight(state)).toBeNull();
  });

  test("flags low adherence once there's enough history to mean something", () => {
    const state = {
      profile: { daysPerWeek: 4 },
      logs: {
        workouts: [
          { date: daysAgo(1), exercises: [] }, // only 1 done this week
          { date: daysAgo(20), exercises: [] },
          { date: daysAgo(25), exercises: [] },
        ],
      },
    };
    const insight = detectCoachInsight(state);
    expect(insight.type).toBe("adherence");
    expect(insight.message).toContain("1/4");
  });

  test("does not flag adherence in week one — not enough history logged yet", () => {
    const state = { profile: { daysPerWeek: 4 }, logs: { workouts: [{ date: daysAgo(0), exercises: [] }] } };
    expect(detectCoachInsight(state)).toBeNull();
  });

  test("flags a consistent duration overrun across the last few timed sessions", () => {
    const state = {
      profile: { sessionLength: 30 }, // no daysPerWeek — isolates this from the adherence branch
      logs: {
        workouts: [
          { date: daysAgo(1), exercises: [], durationSec: 2700 }, // 45 min
          { date: daysAgo(8), exercises: [], durationSec: 2700 },
          { date: daysAgo(15), exercises: [], durationSec: 2700 },
        ],
      },
    };
    const insight = detectCoachInsight(state);
    expect(insight.type).toBe("duration");
    expect(insight.message).toContain("15 min"); // 45 actual - 30 target
  });

  test("does not flag duration from a single unusually long session", () => {
    const state = {
      profile: { sessionLength: 30 },
      logs: { workouts: [{ date: daysAgo(1), exercises: [], durationSec: 5400 }] }, // only one timed session
    };
    expect(detectCoachInsight(state)).toBeNull();
  });

  test("flags a lift that's held the exact same weight for 3 sessions in a row", () => {
    const state = {
      profile: {},
      program: { days: [{ name: "Day 1", exercises: [{ name: "Bench Press" }] }] },
      logs: {
        workouts: [
          { date: daysAgo(1), exercises: [{ name: "Bench Press", logged: [{ weight: "135", reps: "8", done: true }] }] },
          { date: daysAgo(8), exercises: [{ name: "Bench Press", logged: [{ weight: "135", reps: "8", done: true }] }] },
          { date: daysAgo(15), exercises: [{ name: "Bench Press", logged: [{ weight: "135", reps: "8", done: true }] }] },
        ],
      },
    };
    const insight = detectCoachInsight(state);
    expect(insight.type).toBe("stalled");
    expect(insight.message).toContain("Bench Press");
    expect(insight.message).toContain("135lb");
  });

  test("does not flag a lift that's still progressing", () => {
    const state = {
      profile: {},
      program: { days: [{ name: "Day 1", exercises: [{ name: "Bench Press" }] }] },
      logs: {
        workouts: [
          { date: daysAgo(1), exercises: [{ name: "Bench Press", logged: [{ weight: "145", reps: "8", done: true }] }] },
          { date: daysAgo(8), exercises: [{ name: "Bench Press", logged: [{ weight: "140", reps: "8", done: true }] }] },
          { date: daysAgo(15), exercises: [{ name: "Bench Press", logged: [{ weight: "135", reps: "8", done: true }] }] },
        ],
      },
    };
    expect(detectCoachInsight(state)).toBeNull();
  });

  test("prioritizes adherence over a duration overrun when both would apply", () => {
    const state = {
      profile: { daysPerWeek: 4, sessionLength: 30 },
      logs: {
        workouts: [
          { date: daysAgo(1), exercises: [], durationSec: 2700 },
          { date: daysAgo(20), exercises: [], durationSec: 2700 },
          { date: daysAgo(25), exercises: [], durationSec: 2700 },
        ],
      },
    };
    expect(detectCoachInsight(state).type).toBe("adherence");
  });

  // Every insight hands back a ready-to-send Coach message so the "Ask
  // Coach" button can close the loop into a real, reviewable conversation
  // rather than the app silently changing anything on its own.
  test("every insight includes a non-empty coachPrompt to actually send", () => {
    const state = {
      profile: { sessionLength: 30 },
      logs: { workouts: [{ date: daysAgo(1), exercises: [], durationSec: 2700 }, { date: daysAgo(8), exercises: [], durationSec: 2700 }] },
    };
    const insight = detectCoachInsight(state);
    expect(typeof insight.coachPrompt).toBe("string");
    expect(insight.coachPrompt.length).toBeGreaterThan(0);
  });
});

/* ============================================================
   claudeChat — offline detection (the mechanism every AI feature in the
   app relies on: Coach, meal suggestions/photos, program generation,
   "find similar exercises"). Mocks navigator/fetch to test all three
   real-world paths without hitting the network.
============================================================ */
describe("claudeChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("fails fast with an offline error when navigator.onLine is false — never calls fetch", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(claudeChat({ system: "s", messages: [] })).rejects.toMatchObject({ offline: true, message: OFFLINE_MESSAGE });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("treats a fetch()-level failure (DNS, connection refused) as offline too, even if navigator.onLine lied", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(claudeChat({ system: "s", messages: [] })).rejects.toMatchObject({ offline: true });
  });

  test("a real HTTP error from the server is NOT treated as an offline error", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Internal server error" } }),
    }));

    let caught;
    try {
      await claudeChat({ system: "s", messages: [] });
    } catch (e) {
      caught = e;
    }
    expect(caught.offline).toBeUndefined();
    expect(caught.message).toBe("Internal server error");
  });

  test("on success, joins only the text content blocks from the response", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "hello" }, { type: "tool_use" }, { type: "text", text: "world" }] }),
    }));

    const result = await claudeChat({ system: "s", messages: [] });
    expect(result).toBe("hello\nworld");
  });
});

describe("fetchExerciseGif", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("returns null and never calls fetch when offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await fetchExerciseGif("Back Squat")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("returns the gifUrl on a successful lookup", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gifUrl: "https://api.workoutxapp.com/v1/gifs/0201.gif" }) }));
    expect(await fetchExerciseGif("Back Squat")).toBe("https://api.workoutxapp.com/v1/gifs/0201.gif");
  });

  test("returns null (not a throw) for a non-200 response — quota exhausted, not found, etc.", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await fetchExerciseGif("Some Made-Up Exercise")).toBeNull();
  });

  test("returns null (not a throw) if fetch itself rejects", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await fetchExerciseGif("Back Squat")).toBeNull();
  });
});

describe("fetchSimilarExercises", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("extracts the alternatives array from a well-formed response", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: '{"alternatives": ["Leg Press", "Hack Squat", "Goblet Squat"]}' }] }),
    }));

    const alts = await fetchSimilarExercises("Back Squat", "full", []);
    expect(alts).toEqual(["Leg Press", "Hack Squat", "Goblet Squat"]);
  });

  test("returns an empty array rather than throwing if the response is missing the field", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: '{"somethingElse": true}' }] }),
    }));

    expect(await fetchSimilarExercises("Back Squat", "full", [])).toEqual([]);
  });

  test("propagates the offline error when there's no connection, for the caller to fall back on", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("fetch", vi.fn());

    await expect(fetchSimilarExercises("Back Squat", "full", [])).rejects.toMatchObject({ offline: true });
  });
});
