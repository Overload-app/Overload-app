import { describe, test, expect, beforeEach, afterEach } from "vitest";
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
  withTips,
  normalizeProgramTips,
  readLocalState,
  writeLocalState,
  hasPendingSync,
  setPendingSync,
  POOLS,
  INJURY_EXCLUDES,
  GOAL_SCHEME,
  DURATION_CAP,
  dateToISO,
  parseISODate,
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

describe("capFor", () => {
  test("beginners get one fewer exercise per day than the base duration cap", () => {
    expect(capFor({ sessionLength: 60, experience: "beginner" })).toBe(DURATION_CAP[60] - 1);
  });

  test("advanced lifters get one more exercise per day than the base duration cap", () => {
    expect(capFor({ sessionLength: 60, experience: "advanced" })).toBe(DURATION_CAP[60] + 1);
  });

  test("intermediate uses the base duration cap unmodified", () => {
    expect(capFor({ sessionLength: 60, experience: "intermediate" })).toBe(DURATION_CAP[60]);
  });

  test("never drops below 3 exercises even for a short session and a beginner", () => {
    expect(capFor({ sessionLength: 30, experience: "beginner" })).toBeGreaterThanOrEqual(3);
  });

  test("unknown session length falls back to a default of 6 (before experience adjustment)", () => {
    expect(capFor({ sessionLength: 9999, experience: "intermediate" })).toBe(6);
  });

  test("longer sessions allow strictly more exercises than shorter ones, same experience", () => {
    const short = capFor({ sessionLength: 30, experience: "intermediate" });
    const long = capFor({ sessionLength: 75, experience: "intermediate" });
    expect(long).toBeGreaterThan(short);
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
