import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calcTargets,
  parseJSONLoose,
  filterPool,
  injuryDescription,
  tipsForExercise,
  alternativesFor,
  excludeAlreadyInDay,
  isSameCoreExercise,
  buildProgram,
  inferMuscleGroup,
  splitForDays,
  capFor,
  capForProgram,
  enforceExerciseCeiling,
  padToMinimum,
  normalizeExerciseCount,
  isUnilateral,
  exerciseVocabularyFor,
  fetchExerciseGif,
  normalizeGifKey,
  withTips,
  stripNameQualifiers,
  normalizeProgramTips,
  deriveSplitName,
  overrideDayName,
  coachResponseFlags,
  coachReplyText,
  readLocalState,
  writeLocalState,
  hasPendingSync,
  setPendingSync,
  readLastAccount,
  writeLastAccount,
  POOLS,
  INJURY_EXCLUDES,
  GOAL_SCHEME,
  secondsPerExercise,
  rawSecondsPerExercise,
  planSetsRest,
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
  buildProgramGenSystem,
  buildCoachSystem,
  reviewPeriodStart,
  nextReviewDueAt,
  isReviewDue,
  summarizeReviewPeriod,
  buildReviewSystem,
  OFFLINE_MESSAGE,
  loadState,
  saveState,
} from "./App.jsx";
import { supabase } from "./supabaseClient.js";

vi.mock("./supabaseClient.js", () => ({ supabase: { from: vi.fn() } }));

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

// Real report: swapping "Deadlift" offered "Leg Curl" as an alternative
// even though "Seated Leg Curl" was already elsewhere that same day — not
// a useful alternative, just a duplicate of something already programmed.
describe("excludeAlreadyInDay", () => {
  const daySets = [
    { name: "Trap Bar Deadlift" },
    { name: "Leg Press" },
    { name: "Seated Leg Curl" },
  ];

  test("filters out an alternative that matches another exercise already in the day", () => {
    const result = excludeAlreadyInDay(["Leg Curl", "Romanian Deadlift"], daySets, 0);
    expect(result).toEqual(["Romanian Deadlift"]);
  });

  test("is case-insensitive", () => {
    const result = excludeAlreadyInDay(["seated leg curl", "Romanian Deadlift"], daySets, 0);
    expect(result).toEqual(["Romanian Deadlift"]);
  });

  test("never excludes based on the exercise's own current name (swapIdx itself)", () => {
    // Swapping index 0 ("Trap Bar Deadlift") — that name shouldn't count
    // as "already used elsewhere" just because it's the one being swapped.
    const result = excludeAlreadyInDay(["Trap Bar Deadlift", "Romanian Deadlift"], daySets, 0);
    expect(result).toEqual(["Trap Bar Deadlift", "Romanian Deadlift"]);
  });

  test("leaves the list untouched when nothing overlaps", () => {
    const result = excludeAlreadyInDay(["Romanian Deadlift", "Kettlebell Swing"], daySets, 0);
    expect(result).toEqual(["Romanian Deadlift", "Kettlebell Swing"]);
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
  // These lock in that the modeled total now lands close to what the
  // person actually asked for. Uses the ADAPTED sets/rest (planSetsRest),
  // not the goal's unadapted textbook scheme — capFor() itself is now
  // built on the adapted numbers (a short build session trims sets/rest to
  // protect exercise count), so multiplying by the un-adapted
  // secondsPerExercise(goal) would compare apples to oranges.
  test("a 30-min build session's modeled total lands close to 30 minutes, not the old ~30-min-that-became-50", () => {
    const profile = { sessionLength: 30, goal: "build", experience: "intermediate" };
    const { sets, rest } = planSetsRest(profile);
    const modeledSeconds = capFor(profile) * rawSecondsPerExercise(sets, rest);
    expect(modeledSeconds / 60).toBeGreaterThanOrEqual(20);
    expect(modeledSeconds / 60).toBeLessThanOrEqual(38);
  });

  test("a 60-min recomp session's modeled total lands close to 60 minutes, not the old ~60-min-that-became-90", () => {
    const profile = { sessionLength: 60, goal: "recomp", experience: "intermediate" };
    const { sets, rest } = planSetsRest(profile);
    const modeledSeconds = capFor(profile) * rawSecondsPerExercise(sets, rest);
    expect(modeledSeconds / 60).toBeGreaterThanOrEqual(50);
    expect(modeledSeconds / 60).toBeLessThanOrEqual(70);
  });
});

// Real ask: periodic (weekly/monthly) AI reviews of training and diet,
// each independently toggleable from the quiz and Settings.
describe("periodic review scheduling and summarization", () => {
  const DAY = 86400000;

  test("the very first weekly review is due 7 days after account creation, not before", () => {
    const created = new Date("2026-08-01T00:00:00Z").toISOString();
    expect(isReviewDue({ weekly: [] }, created, "weekly", new Date("2026-08-06T00:00:00Z"))).toBe(false);
    expect(isReviewDue({ weekly: [] }, created, "weekly", new Date("2026-08-08T00:00:00Z"))).toBe(true);
  });

  test("the very first monthly review is due 30 days after account creation", () => {
    const created = new Date("2026-08-01T00:00:00Z").toISOString();
    expect(isReviewDue({ monthly: [] }, created, "monthly", new Date("2026-08-20T00:00:00Z"))).toBe(false);
    expect(isReviewDue({ monthly: [] }, created, "monthly", new Date("2026-08-31T00:00:00Z"))).toBe(true);
  });

  test("after a review has been generated, the next one is due one period after THAT one, not account creation", () => {
    const created = new Date("2026-01-01T00:00:00Z").toISOString();
    const reviews = { weekly: [{ generatedAt: new Date("2026-08-01T00:00:00Z").toISOString() }] };
    expect(isReviewDue(reviews, created, "weekly", new Date("2026-08-05T00:00:00Z"))).toBe(false);
    expect(isReviewDue(reviews, created, "weekly", new Date("2026-08-09T00:00:00Z"))).toBe(true);
  });

  test("reviewPeriodStart anchors to the last review when one exists, else account creation", () => {
    const created = new Date("2026-01-01T00:00:00Z").toISOString();
    expect(reviewPeriodStart({ weekly: [] }, created, "weekly")).toBe(new Date(created).getTime());
    const lastGen = new Date("2026-06-01T00:00:00Z").toISOString();
    expect(reviewPeriodStart({ weekly: [{ generatedAt: lastGen }] }, created, "weekly")).toBe(new Date(lastGen).getTime());
  });

  test("summarizeReviewPeriod only counts workouts/weigh-ins actually inside the period", () => {
    const logs = {
      workouts: [
        { date: "2026-07-25", durationSec: 2400 }, // before the period
        { date: "2026-08-02", durationSec: 3000 },
        { date: "2026-08-05", durationSec: 3600 },
      ],
      bodyweight: [
        { date: "2026-07-20", weight: 200 }, // before the period
        { date: "2026-08-01", weight: 180 },
        { date: "2026-08-07", weight: 178 },
      ],
    };
    const start = new Date("2026-08-01T00:00:00Z").getTime();
    const end = new Date("2026-08-08T00:00:00Z").getTime();
    const summary = summarizeReviewPeriod(logs, start, end);
    expect(summary.workoutCount).toBe(2);
    expect(summary.avgDurationSec).toBe(3300); // (3000+3600)/2
    expect(summary.weightChange).toBe(-2); // 178 - 180
  });

  test("summarizeReviewPeriod reports null weightChange with fewer than 2 weigh-ins in the period", () => {
    const logs = { workouts: [], bodyweight: [{ date: "2026-08-01", weight: 180 }] };
    const summary = summarizeReviewPeriod(logs, new Date("2026-08-01").getTime(), new Date("2026-08-08").getTime());
    expect(summary.weightChange).toBeNull();
  });

  test("buildReviewSystem includes the real logged stats and asks for honest, non-inflated feedback when nothing was logged", () => {
    const summary = { workoutCount: 0, avgDurationSec: null, weightChange: null, startWeight: null, endWeight: null };
    const system = buildReviewSystem({ goal: "build", experience: "intermediate", daysPerWeek: 4 }, "weekly", summary);
    expect(system).toContain("0 workout(s) logged");
    expect(system.toLowerCase()).toContain("nothing");
  });

  test("buildReviewSystem reports a weight trend when one exists", () => {
    const summary = { workoutCount: 3, avgDurationSec: 2700, weightChange: -2, startWeight: 180, endWeight: 178 };
    const system = buildReviewSystem({ goal: "lose", experience: "beginner", daysPerWeek: 3 }, "monthly", summary);
    expect(system).toContain("180lb to 178lb");
    expect(system).toContain("-2lb");
  });
});

// Real ask: a free-text "anything else your coach should know?" quiz step
// (preferred split, disliked exercises, missing gym equipment, etc.) that
// actually reaches both AI prompts, not just gets collected and ignored.
// Real tester report: a program from before sets/rest were ever tightened
// gave the Coach a stale, low ceiling ("the hard ceiling is 3") with no
// awareness that trimming toward the tightest sensible sets/rest for this
// session length would very likely reclaim room back to the real minimum.
describe("buildCoachSystem tells the Coach how to recover a stale, un-trimmed program's ceiling", () => {
  test("includes the tightest sensible sets/rest and trim-first guidance when the current program's ceiling is below the minimum", () => {
    const state = {
      profile: { ...baseProfile, sessionLength: 30, goal: "build", experience: "beginner" },
      program: {
        splitName: "Full Body",
        days: [{ name: "Full Body A", exercises: [{ name: "Bench Press", sets: 4, rest: 90 }, { name: "Barbell Row", sets: 4, rest: 90 }] }],
      },
      programHistory: [],
    };
    const system = buildCoachSystem(state);
    const { sets, rest } = planSetsRest(state.profile);
    expect(system).toContain(`${sets} sets x ${rest}s rest`);
    expect(system).toContain("trim EVERY exercise on the day toward those numbers");
  });
});

// Real transcript: "Hmm, I didn't quite catch that" fired on a genuinely
// ambiguous request ("make my split 5 workouts" — 5 exercises, or 5 days?)
// instead of asking what was actually unclear, and a later pushback on an
// already-explained refusal got the same explanation repeated almost
// verbatim two more times, which read as "coach is still being an idiot."
describe("buildCoachSystem: never a blank reply, and don't just repeat an explanation on pushback", () => {
  test("instructs the Coach to never leave reply blank, and to ask a specific clarifying question for ambiguous requests", () => {
    const state = { profile: baseProfile, program: null, programHistory: [] };
    const system = buildCoachSystem(state);
    expect(system).toContain('"reply" must NEVER be left blank');
    expect(system).toContain("say specifically what's unclear");
  });

  test("instructs the Coach not to just repeat itself when a user re-asserts an already-explained request", () => {
    const state = { profile: baseProfile, program: null, programHistory: [] };
    const system = buildCoachSystem(state);
    expect(system).toContain("don't just restate the same explanation again");
    expect(system).toContain("lead with the concrete next step");
  });
});

describe("profile notes reach both AI prompts", () => {
  test("buildProgramGenSystem includes the client's notes verbatim when present", () => {
    const system = buildProgramGenSystem({ ...baseProfile, notes: "Prefer an upper/lower split, no cable machine at my gym" });
    expect(system).toContain("Prefer an upper/lower split, no cable machine at my gym");
  });

  test("buildProgramGenSystem adds nothing extra when notes is empty/unset", () => {
    const withNotes = buildProgramGenSystem({ ...baseProfile, notes: "test-marker-xyz" });
    const withoutNotes = buildProgramGenSystem({ ...baseProfile, notes: "" });
    expect(withNotes).toContain("test-marker-xyz");
    expect(withoutNotes).not.toContain("test-marker-xyz");
  });

  test("buildCoachSystem includes the client's notes verbatim when present", () => {
    const system = buildCoachSystem({ profile: { ...baseProfile, notes: "Hate burpees, please avoid them" } });
    expect(system).toContain("Hate burpees, please avoid them");
  });

  test("buildCoachSystem omits the notes sentence entirely when there are none", () => {
    const system = buildCoachSystem({ profile: { ...baseProfile, notes: "" } });
    expect(system).not.toContain("Additional notes from the client");
  });
});

// Regression coverage for a real report: a short, set/rest-heavy session
// used to collapse to as few as 2 exercises — technically fit the time
// budget, but read as a "ridiculous" workout. planSetsRest() trims rest
// first, then sets, specifically to protect a real minimum exercise count
// instead of letting exercise count be the thing that gives.
describe("planSetsRest", () => {
  test("a session long enough for the goal's textbook scheme is left completely untouched", () => {
    const profile = { sessionLength: 60, goal: "recomp", experience: "intermediate" };
    expect(planSetsRest(profile)).toEqual({ sets: GOAL_SCHEME.recomp.sets, rest: GOAL_SCHEME.recomp.rest });
  });

  test("a tight session trims rest before ever touching sets", () => {
    // Just barely too tight for the textbook scheme — trimming rest a
    // little should be enough without needing to cut sets at all.
    const profile = { sessionLength: 35, goal: "lose", experience: "intermediate" };
    const { sets, rest } = planSetsRest(profile);
    expect(sets).toBe(GOAL_SCHEME.lose.sets);
    expect(rest).toBeLessThan(GOAL_SCHEME.lose.rest);
  });

  test("a very tight session trims sets too, once rest alone hits its floor", () => {
    const profile = { sessionLength: 30, goal: "build", experience: "intermediate" };
    const { sets, rest } = planSetsRest(profile);
    expect(rest).toBe(45); // rest floor reached
    expect(sets).toBeLessThan(GOAL_SCHEME.build.sets);
    expect(sets).toBeGreaterThanOrEqual(2); // never below the sets floor
  });

  test("never trims rest below 45s or sets below 2, even for an extremely short session", () => {
    const { sets, rest } = planSetsRest({ sessionLength: 15, goal: "build", experience: "intermediate" });
    expect(rest).toBeGreaterThanOrEqual(45);
    expect(sets).toBeGreaterThanOrEqual(2);
  });

  test("a 30-min build session now fits at least 4 exercises — it used to collapse to 2", () => {
    const profile = { sessionLength: 30, goal: "build", experience: "intermediate" };
    expect(capFor(profile)).toBeGreaterThanOrEqual(4);
  });

  // Real tester report: a 30-min session gave intermediate the promised 4
  // exercises but flatly refused a beginner even 4 ("the hard ceiling is
  // 3") for the IDENTICAL time budget — planSetsRest had already trimmed
  // sets/rest all the way to the floor to reach a raw count of 4, and the
  // beginner -1 adjustment then undid that work, since it was applied
  // unconditionally rather than only when there was genuine slack above
  // the target to give up.
  test("a beginner gets the same guaranteed minimum of 4 as intermediate does, for the identical session length", () => {
    for (const goal of ["lose", "build", "recomp"]) {
      const profile = { sessionLength: 30, goal, experience: "beginner" };
      expect(capFor(profile)).toBeGreaterThanOrEqual(4);
    }
  });

  test("the beginner -1 still applies once there's genuine slack above the minimum to give up", () => {
    // A long enough session that the textbook scheme alone (no trimming
    // needed) already clears the minimum with real room to spare — the -1
    // should still shave a beginner's count relative to intermediate here,
    // since protecting the guarantee doesn't mean removing the adjustment
    // outright.
    const intermediateCap = capFor({ sessionLength: 90, goal: "build", experience: "intermediate" });
    const beginnerCap = capFor({ sessionLength: 90, goal: "build", experience: "beginner" });
    expect(beginnerCap).toBe(intermediateCap - 1);
    expect(beginnerCap).toBeGreaterThanOrEqual(4);
  });

  test("a beginner still gets at least 4 exercises when the time budget has room for it — planSetsRest used to stop trimming as soon as the RAW count hit 4, before capFor's own beginner -1 adjustment dropped the final cap to 3", () => {
    // 34 min has enough headroom that trimming down to the sets/rest floor
    // reaches a raw count of 5 — old code stopped trimming the moment the
    // raw count first hit 4 (never checking the -1 adjustment beginners get
    // downstream), landing beginners on a real report of "only 3 exercises".
    const profile = { sessionLength: 34, goal: "build", experience: "beginner" };
    expect(capFor(profile)).toBeGreaterThanOrEqual(4);
  });

  test("a session too short to physically fit 4 even at the sets/rest floor honestly returns fewer, rather than trimming below the floor", () => {
    const profile = { sessionLength: 25, goal: "build", experience: "beginner" };
    const { sets, rest } = planSetsRest(profile);
    expect(sets).toBeGreaterThanOrEqual(2);
    expect(rest).toBeGreaterThanOrEqual(45);
    expect(capFor(profile)).toBeLessThan(4); // genuinely can't fit 4 at the floor — not a bug
  });

  test("the offline program builder actually bakes the adapted sets/rest into every exercise, not the textbook scheme", () => {
    const profile = { ...baseProfile, sessionLength: 30, goal: "build", experience: "intermediate", daysPerWeek: 3 };
    const program = buildProgram(profile);
    const { sets, rest } = planSetsRest(profile);
    for (const day of program.days) {
      for (const ex of day.exercises) {
        expect(ex.sets).toBe(sets);
        expect(ex.rest).toBe(rest);
      }
    }
  });
});

// Real, repeated pattern this session: an AI response violating the
// exercise-count rules it was explicitly told to follow. A prompt
// instruction is a strong nudge, never a hard guarantee — these enforce
// both the ceiling and the guaranteed minimum deterministically,
// regardless of whether the model actually complied.
describe("enforceExerciseCeiling", () => {
  const exercises = [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }];

  test("trims down to the ceiling, keeping the first N (compound/primary lifts are listed first)", () => {
    expect(enforceExerciseCeiling(exercises, 3)).toEqual([{ name: "A" }, { name: "B" }, { name: "C" }]);
  });

  test("leaves the list untouched when already at or under the ceiling", () => {
    expect(enforceExerciseCeiling(exercises, 5)).toEqual(exercises);
    expect(enforceExerciseCeiling(exercises, 10)).toEqual(exercises);
  });

  test("leaves the list untouched when there's no real ceiling to enforce", () => {
    expect(enforceExerciseCeiling(exercises, 0)).toEqual(exercises);
    expect(enforceExerciseCeiling(exercises, null)).toEqual(exercises);
  });
});

describe("padToMinimum", () => {
  test("pads a short day back up to the target using real pool exercises", () => {
    const exercises = [{ name: "Barbell Bench Press", sets: 3, reps: "8-12", rest: 90 }];
    const padded = padToMinimum(exercises, 4, "full", ["none"]);
    expect(padded.length).toBe(4);
    expect(padded[0]).toEqual(exercises[0]); // original untouched
    for (const ex of padded.slice(1)) {
      expect(ex.tips.length).toBeGreaterThan(0);
      expect(ex.sets).toBe(3); // matches the day's own scheme, not a generic default
      expect(ex.rest).toBe(90);
    }
  });

  test("never pads in a near-duplicate of something already in the day", () => {
    // "Leg Curl" (pool) would otherwise be a plausible pad candidate, but
    // "Seated Leg Curl" already covers the same core exercise.
    const exercises = [
      { name: "Trap Bar Deadlift", sets: 3, reps: "8-10", rest: 100 },
      { name: "Seated Leg Curl", sets: 3, reps: "12", rest: 75 },
    ];
    const padded = padToMinimum(exercises, 4, "full", ["none"]);
    const names = padded.map((e) => e.name.toLowerCase());
    expect(names.filter((n) => n.includes("curl")).length).toBe(1); // still just the one
  });

  test("does nothing when already at or above the target", () => {
    const exercises = [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }];
    expect(padToMinimum(exercises, 4, "full", ["none"])).toBe(exercises); // same reference, untouched
  });

  test("respects injury exclusions when choosing pad candidates", () => {
    const exercises = [{ name: "Barbell Bench Press", sets: 3, reps: "8-12", rest: 90 }];
    const padded = padToMinimum(exercises, 4, "full", ["knees"]);
    const names = padded.map((e) => e.name);
    expect(names).not.toContain("Barbell Squat");
    expect(names).not.toContain("Leg Press");
  });
});

describe("normalizeExerciseCount", () => {
  test("trims an over-long day down to what its own sets/rest actually allow", () => {
    // 6 exercises at a scheme this generous won't fit a 30-min session.
    const exercises = Array.from({ length: 6 }, (_, i) => ({ name: `Exercise ${i}`, sets: 4, reps: "8-12", rest: 90 }));
    const result = normalizeExerciseCount(exercises, 30, "intermediate", "full", ["none"]);
    expect(result.length).toBeLessThan(6);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  test("pads a short day back up to the real minimum for the session length", () => {
    // Tight sets/rest, only 1 exercise — a 60-min session has real room
    // for more than that.
    const exercises = [{ name: "Barbell Bench Press", sets: 2, reps: "8-12", rest: 45 }];
    const result = normalizeExerciseCount(exercises, 60, "intermediate", "full", ["none"]);
    expect(result.length).toBeGreaterThanOrEqual(4);
  });

  test("leaves an already-reasonable day untouched", () => {
    const exercises = [
      { name: "Barbell Bench Press", sets: 3, reps: "8-12", rest: 90 },
      { name: "Barbell Row", sets: 3, reps: "8-12", rest: 90 },
      { name: "Overhead Press", sets: 3, reps: "8-12", rest: 90 },
      { name: "Lat Pulldown", sets: 3, reps: "8-12", rest: 90 },
    ];
    const result = normalizeExerciseCount(exercises, 60, "intermediate", "full", ["none"]);
    expect(result).toEqual(exercises);
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

describe("exerciseVocabularyFor", () => {
  test("returns a flat, deduplicated list of real exercise names for a known equipment type", () => {
    const vocab = exerciseVocabularyFor("dumbbell");
    expect(vocab.length).toBeGreaterThan(0);
    expect(vocab).toContain("Dumbbell Bench Press");
    expect(new Set(vocab).size).toBe(vocab.length); // no duplicates
  });

  test("covers all three equipment types without throwing", () => {
    for (const equipment of ["full", "dumbbell", "bodyweight"]) {
      expect(exerciseVocabularyFor(equipment).length).toBeGreaterThan(0);
    }
  });

  test("returns an empty array for an unknown equipment type rather than throwing", () => {
    expect(exerciseVocabularyFor("resistance-bands")).toEqual([]);
    expect(exerciseVocabularyFor(undefined)).toEqual([]);
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
    expect(names).not.toContain("Barbell Squat");
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

  // Real report: "(moderate depth)" was STILL part of an exercise name
  // even after the Coach explicitly claimed to have cleaned it up —
  // relying purely on the AI actually following its own naming rule
  // wasn't reliable enough. withTips is the one place every source (fresh
  // generation, a Coach edit, old saved data) already flows through, so
  // this strips it there deterministically, guaranteed, regardless of
  // what the AI actually produced.
  test("strips a qualifier off every exercise name that passes through, regardless of source", () => {
    const result = withTips([{ name: "Leg Press (Moderate Depth)", sets: 3, reps: "8-12", rest: 90 }]);
    expect(result[0].name).toBe("Leg Press");
  });
});

describe("stripNameQualifiers", () => {
  test("strips a parenthetical qualifier", () => {
    expect(stripNameQualifiers("Leg Press (Moderate Depth)")).toBe("Leg Press");
    expect(stripNameQualifiers("Romanian Deadlift (Partial Range)")).toBe("Romanian Deadlift");
  });

  test("strips a dash-separated qualifier (space on both sides of the dash)", () => {
    expect(stripNameQualifiers("Leg Press - Wide Stance")).toBe("Leg Press");
  });

  test("does NOT strip a hyphen that's part of the name itself (no surrounding space)", () => {
    expect(stripNameQualifiers("Pull-Up")).toBe("Pull-Up");
    expect(stripNameQualifiers("Step-Up")).toBe("Step-Up");
    expect(stripNameQualifiers("Single-Arm Row")).toBe("Single-Arm Row");
  });

  test("leaves an already-plain name completely untouched", () => {
    expect(stripNameQualifiers("Barbell Bench Press")).toBe("Barbell Bench Press");
  });

  test("handles a name with both a parenthetical AND a dash qualifier", () => {
    expect(stripNameQualifiers("Leg Press (Moderate Depth) - Slow Tempo")).toBe("Leg Press");
  });

  test("handles empty/missing input without throwing", () => {
    expect(stripNameQualifiers("")).toBe("");
    expect(stripNameQualifiers(null)).toBeNull();
    expect(stripNameQualifiers(undefined)).toBeUndefined();
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

  test("readLastAccount returns null before anyone has ever signed in on this device", () => {
    expect(readLastAccount()).toBeNull();
  });

  test("writeLastAccount then readLastAccount round-trips, including cached entitlement", () => {
    writeLastAccount({ id: "user-1", name: "Fred", email: "fred@example.com", subscribed: true, trialStartedAt: null });
    expect(readLastAccount()).toEqual({ id: "user-1", name: "Fred", email: "fred@example.com", subscribed: true, trialStartedAt: null });
  });

  test("readLastAccount never throws on corrupt JSON", () => {
    globalThis.localStorage.setItem("overload_last_account", "{not valid json");
    expect(() => readLastAccount()).not.toThrow();
    expect(readLastAccount()).toBeNull();
  });
});

/* ============================================================
   SYNC RACE: loadState/saveState vs. a reload/exit that beats the network
   (real reports: finished-set progress, and a Coach todayOverride swap,
   both silently vanished after a reload or app exit — loadState always
   trusted a successful server read, even when a just-finished local save's
   upsert hadn't landed yet and the server read was simply stale.)
============================================================ */
describe("loadState / saveState race with a not-yet-confirmed save", () => {
  class MemoryStorage {
    constructor() { this.store = new Map(); }
    getItem(key) { return this.store.has(key) ? this.store.get(key) : null; }
    setItem(key, value) { this.store.set(key, String(value)); }
    removeItem(key) { this.store.delete(key); }
    clear() { this.store.clear(); }
  }

  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage();
    vi.clearAllMocks();
  });

  function mockSupabase({ maybeSingle, upsert }) {
    supabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      upsert,
    }));
  }

  test("saveState marks the sync pending BEFORE the upsert resolves, so a reload mid-flight can tell local is newer", async () => {
    // Own userId — saveState serializes upserts per user (see saveQueues),
    // so sharing an id with another saveState test could queue this one
    // behind that test's leftover, already-settled chain.
    let resolveUpsert;
    const upsert = vi.fn(() => new Promise((r) => { resolveUpsert = r; }));
    mockSupabase({ maybeSingle: vi.fn(), upsert });

    const savePromise = saveState("user-pending-a", { value: "new" });
    // Still in flight — pending must already be set, not only after failure.
    expect(hasPendingSync("user-pending-a")).toBe(true);
    // saveState queues the actual upsert (see saveQueues) — even an empty
    // queue's first call is scheduled a microtask tick later, not
    // invoked synchronously, so resolveUpsert isn't assigned yet here.
    await Promise.resolve();
    resolveUpsert({ error: null });
    await savePromise;
    expect(hasPendingSync("user-pending-a")).toBe(false);
  });

  test("saveState leaves the sync pending on a genuine upsert failure", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: new Error("network down") });
    mockSupabase({ maybeSingle: vi.fn(), upsert });

    const ok = await saveState("user-pending-b", { value: "new" });
    expect(ok).toBe(false);
    expect(hasPendingSync("user-pending-b")).toBe(true);
  });

  // Real report: changes were lost specifically while switching between
  // wifi and no wifi. Two saves fired close together used to be able to
  // hit Supabase concurrently and resolve in either order — an older,
  // slower upsert finishing AFTER a newer one could clear pendingSync and
  // declare everything confirmed even though the newer write (the one
  // that actually matters) hadn't landed. Upserts for one user are now
  // strictly serialized, so this is no longer just "usually fine" — the
  // second save's upsert physically cannot even start until the first
  // one has fully settled, guaranteeing both correct arrival order at
  // Supabase and that only the truly last save gets to clear pendingSync.
  test("two saves issued back to back stay correctly ordered, and only the final one's success clears pendingSync", async () => {
    let resolveFirst;
    const upsert = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; })) // first call — resolves late
      .mockResolvedValueOnce({ error: null }); // second call — resolves once its turn comes
    mockSupabase({ maybeSingle: vi.fn(), upsert });

    const firstSave = saveState("user-pending-c", { value: "older" });
    const secondSave = saveState("user-pending-c", { value: "newer" });
    await Promise.resolve(); // let the first (and only the first) queued upsert actually fire
    // The second call's upsert can't even start yet — proves they're
    // genuinely serialized, not just racing and usually landing in order.
    expect(upsert).toHaveBeenCalledTimes(1);

    resolveFirst({ error: null });
    await firstSave;
    await secondSave;

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({ state: { value: "older" } }));
    expect(upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({ state: { value: "newer" } }));
    expect(hasPendingSync("user-pending-c")).toBe(false);
  });

  test("loadState prefers the local cache over a successful-but-stale server read when a save is still pending", async () => {
    writeLocalState("user-1", { value: "newer, saved locally" });
    setPendingSync("user-1", true);
    const maybeSingle = vi.fn().mockResolvedValue({ data: { state: { value: "stale server copy" } }, error: null });
    const upsert = vi.fn();
    mockSupabase({ maybeSingle, upsert });

    const { state, fromCache } = await loadState("user-1");
    expect(state).toEqual({ value: "newer, saved locally" });
    expect(fromCache).toBe(true);
    expect(maybeSingle).not.toHaveBeenCalled(); // never even asks the server — local is already known newer
  });

  test("loadState trusts the server as usual once nothing is pending", async () => {
    writeLocalState("user-1", { value: "old local copy" });
    setPendingSync("user-1", false);
    const maybeSingle = vi.fn().mockResolvedValue({ data: { state: { value: "confirmed server copy" } }, error: null });
    mockSupabase({ maybeSingle, upsert: vi.fn() });

    const { state, fromCache } = await loadState("user-1");
    expect(state).toEqual({ value: "confirmed server copy" });
    expect(fromCache).toBe(false);
  });

  test("loadState still falls back to local cache if pending is true but there's no local cache to trust", async () => {
    setPendingSync("user-1", true); // e.g. pending flag from a different, since-cleared browser profile
    const maybeSingle = vi.fn().mockResolvedValue({ data: { state: { value: "server copy" } }, error: null });
    mockSupabase({ maybeSingle, upsert: vi.fn() });

    const { state } = await loadState("user-1");
    expect(state).toEqual({ value: "server copy" });
    expect(maybeSingle).toHaveBeenCalled();
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

  // Real report: "some exercises don't show how much you did last time" —
  // a rename (an equipment-word fix, a stripped qualifier, a Coach edit)
  // used to sever the connection to everything logged under the old name
  // entirely, silently, with no way to know it happened.
  test("still finds history logged under a name that's since been renamed to a close variant", () => {
    const renamedLogs = { workouts: [{ date: "2026-01-01", exercises: [{ name: "Standing Calf Raise", logged: [{ weight: "90", reps: "12", done: true }] }] }] };
    const history = exerciseHistory(renamedLogs, "Calf Raise"); // program later simplified the name
    expect(history).toHaveLength(1);
    expect(history[0].weight).toBe(90);
  });
});

describe("isSameCoreExercise", () => {
  test("treats a name as the same exercise as a longer version of itself", () => {
    expect(isSameCoreExercise("Leg Curl", "Seated Leg Curl")).toBe(true);
    expect(isSameCoreExercise("Back Squat", "Barbell Squat")).toBe(false); // "back" and "barbell" are genuinely different words, not a subset relation
  });

  test("is order-independent", () => {
    expect(isSameCoreExercise("Seated Leg Curl", "Leg Curl")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isSameCoreExercise("leg curl", "SEATED LEG CURL")).toBe(true);
  });

  test("does not treat two different exercises sharing only a generic word as the same", () => {
    expect(isSameCoreExercise("Machine Chest Press", "Machine Shoulder Press")).toBe(false);
  });

  test("handles empty/missing input without throwing", () => {
    expect(isSameCoreExercise("", "Leg Curl")).toBe(false);
    expect(isSameCoreExercise(null, "Leg Curl")).toBe(false);
    expect(isSameCoreExercise(undefined, undefined)).toBe(false);
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

  test("still finds the last session logged under a name that's since been renamed to a close variant", () => {
    const renamedLogs = { workouts: [{ date: "2026-01-01", exercises: [{ name: "Standing Calf Raise", logged: [{ weight: "90", reps: "12", done: true }] }] }] };
    expect(exerciseLastSession(renamedLogs, "Calf Raise")).toEqual({ date: "2026-01-01", sets: [{ weight: 90, reps: 12 }] });
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

  // Real bug found investigating a test failure: the swapped-in-exercise
  // fallback branch never copied over the AI's own baked-in "alternatives"
  // for that exercise — meaning "Find alternative" always skipped past
  // perfectly good, already-generated alternatives and went straight to a
  // live/offline lookup instead, every single time, for every exercise.
  test("a swapped-in exercise still carries its own baked-in alternatives through", () => {
    const freshExercises = [{ name: "Barbell Hip Thrust", sets: 1, reps: "6-8", rest: 120, alternatives: ["Cable Pull-Through", "Glute Bridge"] }];
    const merged = mergeResumedSets(freshExercises, savedSets);
    expect(merged[0].alternatives).toEqual(["Cable Pull-Through", "Glute Bridge"]);
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

  test("returns null for a healthy state — on-time duration, no stalled lift", () => {
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

  // No adherence/schedule nudge at all, regardless of how little was
  // logged this week — explicit user preference ("Don't want coach giving
  // advice about schedule"), and it used to misfire early in a fresh week
  // besides (a trailing-7-day window can't distinguish "behind" from
  // "just early" without knowing which days are actually left to train).
  test("never flags low weekly volume, no matter how far under the target", () => {
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
    expect(detectCoachInsight(state)).toBeNull();
  });

  test("flags a consistent duration overrun across the last few timed sessions", () => {
    const state = {
      profile: { sessionLength: 30 },
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

  test("still flags a duration overrun even for someone far under their weekly volume target", () => {
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
    expect(detectCoachInsight(state).type).toBe("duration");
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

  test("still calls fetch and succeeds even when navigator.onLine falsely reports offline — real report: a genuinely online user got a false 'no internet' error", async () => {
    // navigator.onLine is a flaky browser flag, not a real connectivity
    // check (known to misreport, especially on mobile/PWA) — it must never
    // gate the request. Only an actual fetch failure means offline.
    vi.stubGlobal("navigator", { onLine: false });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "hi" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(claudeChat({ system: "s", messages: [] })).resolves.toBe("hi");
    expect(fetchSpy).toHaveBeenCalled();
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

  // Real usage data: a Barbell Bench Press lookup that failed once (before
  // the API key was fully wired up) got permanently cached as "no GIF" —
  // because the old code cached ANY result, confirmed or not. "confirmed"
  // is what the caller uses to decide whether a result is safe to
  // permanently cache; these pin exactly which outcomes are which.
  //
  // navigator.onLine is deliberately never trusted as a gate here (same
  // reasoning as claudeChat) — every test below stubs it to whatever value
  // makes the case realistic, but the actual fetch() outcome is what
  // decides "offline" (a real ask: the failure message should say WHY it
  // can't load a demo, which needs this to be trustworthy, not a flaky
  // browser flag).
  test("a successful lookup with a match: confirmed, returns the real gifUrl", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gifUrl: "https://api.workoutxapp.com/v1/gifs/0201.gif", matchCount: 1 }) }));
    expect(await fetchExerciseGif("Back Squat")).toEqual({ gifUrl: "https://api.workoutxapp.com/v1/gifs/0201.gif", confirmed: true, offline: false });
  });

  test("a successful lookup with genuinely no match: confirmed, gifUrl null", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gifUrl: null, matchCount: 0 }) }));
    expect(await fetchExerciseGif("Some Made-Up Exercise")).toEqual({ gifUrl: null, confirmed: true, offline: false });
  });

  test("a non-200 response (bad key, quota, upstream error): unconfirmed, not offline, not a throw", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "unauthorized" }) }));
    expect(await fetchExerciseGif("Back Squat")).toEqual({ gifUrl: null, confirmed: false, offline: false });
  });

  test("fetch itself rejecting (a genuine connectivity failure): unconfirmed AND offline", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await fetchExerciseGif("Back Squat")).toEqual({ gifUrl: null, confirmed: false, offline: true });
  });

  test("still tries the real request even when navigator.onLine falsely reports offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gifUrl: "https://api.workoutxapp.com/v1/gifs/0201.gif", matchCount: 1 }) });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await fetchExerciseGif("Back Squat")).toEqual({ gifUrl: "https://api.workoutxapp.com/v1/gifs/0201.gif", confirmed: true, offline: false });
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("normalizeGifKey", () => {
  test("lowercases and trims so different casing/whitespace hit the same cache entry", () => {
    expect(normalizeGifKey("Barbell Bench Press")).toBe("barbell bench press");
    expect(normalizeGifKey("  Barbell Bench Press  ")).toBe("barbell bench press");
    expect(normalizeGifKey("BARBELL BENCH PRESS")).toBe("barbell bench press");
  });

  test("handles a missing name without throwing", () => {
    expect(normalizeGifKey(undefined)).toBe("");
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
    // navigator.onLine is deliberately no longer trusted as a gate (see
    // claudeChat tests) — a genuine connectivity failure is what actually
    // makes fetch() itself reject, so that's what real offline looks like.
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(fetchSimilarExercises("Back Squat", "full", [])).rejects.toMatchObject({ offline: true });
  });
});
