// Every realistic quiz combination, run through the app's own program builder
// and nutrition math. Free (no AI), fast, and exhaustive — written while
// preparing for launch, and it found real bugs on its first run:
//   - injured users given exercises that hit their injury (6,296 cases)
//   - empty workout days once those were removed (360)
//   - 450g/day protein targets that pushed carbs to zero
//   - different exercises (Push-Up vs Pike Push-Up) treated as the same one
// The program builder here is the fallback every user gets whenever AI
// generation fails or they're offline, so it has to be right on its own.
import { describe, test, expect } from "vitest";
import {
  buildProgram, normalizeProgramTips, calcTargets, INJURY_EXCLUDES, exerciseVocabularyFor,
  isSameCoreExercise, findLoggedExercise, fillShortDay,
} from "./App.jsx";

const GOALS = ["lose", "build", "recomp"];
const EXPERIENCE = ["beginner", "intermediate", "advanced"];
const EQUIPMENT = ["full", "dumbbell", "bodyweight"];
const DAYS = [3, 4, 5, 6];
const LENGTHS = [30, 45, 60, 75];
const INJURIES = [
  ["none"], ["knees"], ["shoulders"], ["lower_back"], ["wrists"], ["elbows"],
  ["knees", "shoulders"], ["shoulders", "wrists", "elbows"], ["knees", "shoulders", "lower_back", "wrists", "elbows"],
];
const NEEDS_GYM = { dumbbell: /barbell|cable|machine|lat pulldown|leg press|leg extension|leg curl|smith|pec deck/i, bodyweight: /barbell|dumbbell|cable|machine|kettlebell|lat pulldown|leg press|smith/i };

function everyProgram(fn) {
  for (const goal of GOALS) for (const experience of EXPERIENCE) for (const equipment of EQUIPMENT)
  for (const daysPerWeek of DAYS) for (const sessionLength of LENGTHS) for (const injuries of INJURIES) {
    const profile = { sex: "male", age: 28, heightIn: 70, weightLb: 170, activity: "light", goal, experience, equipment, daysPerWeek, sessionLength, injuries, otherInjuries: "" };
    fn(profile, normalizeProgramTips(buildProgram(profile)));
  }
}

describe("every program the app can build on its own", () => {
  const failures = [];
  const fail = (why, detail) => { if (failures.length < 20) failures.push(`${why}: ${JSON.stringify(detail)}`); };
  let count = 0;
  everyProgram((profile, program) => {
    count++;
    const tag = `${profile.equipment}/${profile.daysPerWeek}d/${profile.sessionLength}m/${profile.experience}/${profile.injuries.join("+")}`;
    if (program.days.length !== profile.daysPerWeek) fail("wrong number of days", { tag, days: program.days.length });
    const terms = profile.injuries.flatMap((i) => INJURY_EXCLUDES[i] || []).map((t) => t.toLowerCase());
    const vocab = new Set(exerciseVocabularyFor(profile.equipment));
    for (const day of program.days) {
      if (day.exercises.length === 0) fail("empty day", { tag, day: day.name });
      for (const e of day.exercises) {
        if (terms.some((t) => e.name.toLowerCase().includes(t))) fail("hits a stated injury", { tag, day: day.name, exercise: e.name });
        if (NEEDS_GYM[profile.equipment]?.test(e.name)) fail("needs equipment they don't have", { tag, exercise: e.name });
        if (!vocab.has(e.name)) fail("outside the video-backed exercise list", { tag, exercise: e.name });
        if (!Array.isArray(e.tips) || e.tips.length === 0) fail("no form tips", { tag, exercise: e.name });
      }
      day.exercises.forEach((a, i) => day.exercises.slice(i + 1).forEach((b) => {
        if (isSameCoreExercise(a.name, b.name)) fail("same exercise twice in one day", { tag, day: day.name, a: a.name, b: b.name });
      }));
    }
  });

  test("covers thousands of combinations", () => {
    expect(count).toBeGreaterThan(3000);
  });

  test("none of them breaks a rule", () => {
    expect(failures).toEqual([]);
  });
});

describe("every nutrition target the app can calculate", () => {
  const failures = [];
  const fail = (why, detail) => { if (failures.length < 20) failures.push(`${why}: ${JSON.stringify(detail)}`); };
  for (const sex of ["male", "female"]) for (const age of [13, 16, 25, 45, 70, 90])
  for (const heightIn of [54, 64, 70, 78, 84]) for (const weightLb of [80, 110, 165, 230, 320, 450])
  for (const activity of ["sedentary", "light", "moderate", "active"]) for (const goal of GOALS) {
    const p = { sex, age, heightIn, weightLb, activity, goal };
    const t = calcTargets(p);
    if (![t.calories, t.protein, t.carbs, t.fat].every(Number.isFinite)) fail("not a number", { p, t });
    if (t.calories < (sex === "male" ? 1500 : 1200)) fail("below the safe calorie floor", { p, t });
    if (Math.abs(t.protein * 4 + t.carbs * 4 + t.fat * 9 - t.calories) > 40) fail("macros don't add up to calories", { p, t });
    if (t.carbs <= 0) fail("zero carbs", { p, t });
    if (t.protein * 4 > t.calories * 0.36) fail("protein over the 35% cap", { p, t });
  }

  test("none of them breaks a rule", () => {
    expect(failures).toEqual([]);
  });

  test("the protein cap only affects heavier bodies — a typical lifter still gets 1g per lb", () => {
    expect(calcTargets({ sex: "male", age: 28, heightIn: 70, weightLb: 170, activity: "light", goal: "build" }).protein).toBe(170);
    expect(calcTargets({ sex: "female", age: 30, heightIn: 65, weightLb: 140, activity: "moderate", goal: "recomp" }).protein).toBe(140);
  });

  test("a very heavy user gets a sane protein target instead of their bodyweight in grams", () => {
    const t = calcTargets({ sex: "male", age: 40, heightIn: 70, weightLb: 450, activity: "sedentary", goal: "lose" });
    expect(t.protein).toBeLessThan(300);
    expect(t.carbs).toBeGreaterThan(0);
  });
});

describe("telling exercises apart", () => {
  test("variations that change the movement are different exercises", () => {
    expect(isSameCoreExercise("Push-Up", "Pike Push-Up")).toBe(false);
    expect(isSameCoreExercise("Push-Up", "Incline Push-Up")).toBe(false);
    expect(isSameCoreExercise("Dumbbell Curl", "Dumbbell Hammer Curl")).toBe(false);
    expect(isSameCoreExercise("Dumbbell Fly", "Dumbbell Rear Delt Fly")).toBe(false);
    expect(isSameCoreExercise("Squat", "Bulgarian Split Squat")).toBe(false);
    expect(isSameCoreExercise("Deadlift", "Romanian Deadlift")).toBe(false);
    expect(isSameCoreExercise("Plank", "Plank Shoulder Tap")).toBe(false);
  });

  test("a more specific label for the same lift still matches, so renames keep their history", () => {
    expect(isSameCoreExercise("Leg Curl", "Seated Leg Curl")).toBe(true);
    expect(isSameCoreExercise("Bench Press", "Barbell Bench Press")).toBe(true);
    expect(isSameCoreExercise("Squat", "Barbell Squat")).toBe(true);
  });

  test("within one workout the exact name wins over a looser match", () => {
    const workout = { exercises: [{ name: "Seated Leg Curl", logged: [] }, { name: "Leg Curl", logged: [] }] };
    expect(findLoggedExercise(workout, "Leg Curl").name).toBe("Leg Curl");
    expect(findLoggedExercise(workout, "Seated Leg Curl").name).toBe("Seated Leg Curl");
  });

  test("a curl's last-time numbers never come from a hammer curl logged alongside it", () => {
    const workout = { exercises: [{ name: "Dumbbell Hammer Curl", logged: [] }, { name: "Dumbbell Curl", logged: [] }] };
    expect(findLoggedExercise(workout, "Dumbbell Curl").name).toBe("Dumbbell Curl");
  });
});

describe("fillShortDay", () => {
  test("tops a short day up from what's safe, core first", () => {
    const pool = { core: ["Dead Bug", "Bird Dog"], legs: ["Glute Bridge"] };
    const out = fillShortDay([{ name: "Glute Bridge" }], pool, 3, { sets: 3, reps: "10", rest: 60 });
    expect(out.map((e) => e.name)).toEqual(["Glute Bridge", "Dead Bug", "Bird Dog"]);
  });

  test("leaves a day that's already long enough alone", () => {
    const day = [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }];
    expect(fillShortDay(day, { core: ["Plank"] }, 4)).toBe(day);
  });
});
