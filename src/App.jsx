import React, { useState, useEffect, useRef } from "react";
import {
  Dumbbell, Utensils, TrendingUp, User, Check, Plus, X, Flame,
  ChevronRight, ChevronLeft, Award, RotateCcw, Home as HomeIcon,
  Beef, Wheat, Droplet, Scale, Sparkles, Zap, MessageCircle,
  Send, Camera, Loader2, AlertCircle, SkipForward, PlusCircle, LogOut,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { supabase } from "./supabaseClient.js";

/* ============================================================
   DESIGN TOKENS
============================================================ */
const T = {
  ink: "#12161C",
  paper: "#EEF1EF",
  card: "#FFFFFF",
  steel: "#DADFE0",
  steelDark: "#AEB6B8",
  charge: "#4E4AF2",
  chargeDeep: "#332FD0",
  protein: "#E0483E",
  carb: "#E8A23D",
  fat: "#3E8FE0",
  good: "#1F9E6E",
  warn: "#D97706",
};

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');`;

const SHELL_CSS = `
  @keyframes pulseDot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.7); } }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .spin { animation: spin 1s linear infinite; }
  html, body, #root { height: 100%; margin: 0; }
  body { background: ${T.ink}; }
  * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
  @media (max-width: 639px) { input, select, textarea { font-size: 16px !important; } }

  .fullscreen-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; height: 100vh; height: 100dvh; }

  /* Auth-style screens (login, paywall, onboarding): always full-bleed,
     no card/frame, on every screen size — same on desktop as on mobile. */
  .auth-screen { min-height: 100vh; min-height: 100dvh; width: 100%; }
  .auth-screen-outer { min-height: 100vh; min-height: 100dvh; width: 100%; }

  /* Main app: bottom tab bar + full-bleed on phones, a real sidebar layout
     using the whole screen on anything roomier. */
  .app-shell { min-height: 100vh; min-height: 100dvh; width: 100%; background: ${T.paper}; }
  .app-main { padding-bottom: 90px; }
  .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; width: 100%; background: #fff; border-top: 1px solid ${T.steel}; display: flex; padding: 8px 4px calc(8px + env(safe-area-inset-bottom, 0px)) 4px; box-sizing: border-box; z-index: 40; }
  .sidebar-nav { display: none; }

  /* Coach tab: a fixed panel independent of any page content above it
     (banners, etc.) so the input box can never get pushed off-screen. */
  .coach-panel { position: fixed; top: 0; left: 0; right: 0; bottom: calc(64px + env(safe-area-inset-bottom, 0px)); background: ${T.paper}; z-index: 30; display: flex; flex-direction: column; }

  @media (min-width: 900px) and (min-height: 600px) {
    .app-shell { display: flex; }
    .sidebar-nav {
      display: flex; flex-direction: column; width: 240px; flex-shrink: 0;
      background: ${T.ink}; min-height: 100vh; min-height: 100dvh; padding: 28px 16px;
      position: sticky; top: 0;
    }
    .bottom-nav { display: none; }
    .app-main { flex: 1; padding-bottom: 40px; }
    .app-main-inner { max-width: 880px; margin: 0 auto; width: 100%; }
    .coach-panel { left: 240px; bottom: 0; }
  }
`;

/* ============================================================
   CLAUDE API HELPERS
============================================================ */
async function claudeChat({ system, messages }) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 2200, system, messages }),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch (e) {}
    throw new Error(detail || `API error ${res.status}`);
  }
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

function parseJSONLoose(text) {
  let clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
  // The model is instructed to return only JSON, but sometimes adds a stray
  // sentence before or after it anyway — pull out just the {...} block
  // rather than requiring the entire response to be pure JSON.
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    clean = clean.slice(start, end + 1);
  }
  return JSON.parse(clean);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* ============================================================
   EXERCISE POOLS
============================================================ */
const POOLS = {
  full: {
    chest: ["Barbell Bench Press", "Incline DB Press", "Cable Fly", "Weighted Dip"],
    back: ["Barbell Row", "Lat Pulldown", "Seated Cable Row", "Pull-Up"],
    shoulders: ["Overhead Press", "DB Lateral Raise", "Face Pull", "Rear Delt Fly"],
    legs: ["Back Squat", "Romanian Deadlift", "Leg Press", "Walking Lunge", "Leg Curl", "Leg Extension", "Calf Raise"],
    biceps: ["Barbell Curl", "Hammer Curl", "Incline DB Curl"],
    triceps: ["Tricep Pushdown", "Skull Crusher", "Overhead Cable Extension"],
    core: ["Hanging Leg Raise", "Cable Crunch", "Ab Wheel Rollout", "Plank"],
  },
  dumbbell: {
    chest: ["DB Bench Press", "DB Incline Press", "DB Fly", "DB Floor Press"],
    back: ["DB Row", "Renegade Row", "DB Pullover", "Chest-Supported Row"],
    shoulders: ["DB Shoulder Press", "DB Lateral Raise", "DB Rear Delt Fly", "Arnold Press"],
    legs: ["DB Goblet Squat", "DB Romanian Deadlift", "DB Walking Lunge", "Bulgarian Split Squat", "DB Step-Up", "DB Calf Raise"],
    biceps: ["DB Curl", "DB Hammer Curl", "Incline DB Curl"],
    triceps: ["DB Overhead Extension", "DB Kickback", "Close-Grip Floor Press"],
    core: ["DB Russian Twist", "DB Side Bend", "Plank", "Reverse Crunch"],
  },
  bodyweight: {
    chest: ["Push-Up", "Incline Push-Up", "Decline Push-Up", "Wide Push-Up"],
    back: ["Pull-Up", "Inverted Row", "Superman Hold", "Towel Row"],
    shoulders: ["Pike Push-Up", "Wall Handstand Hold", "Y-Raise", "Plank Shoulder Tap"],
    legs: ["Bodyweight Squat", "Walking Lunge", "Bulgarian Split Squat", "Glute Bridge", "Wall Sit", "Calf Raise"],
    biceps: ["Chin-Up", "Towel Curl Hold", "Doorframe Row"],
    triceps: ["Diamond Push-Up", "Bench Dip", "Tricep Push-Up"],
    core: ["Plank", "Bicycle Crunch", "Leg Raise", "Mountain Climbers"],
  },
};

const INJURY_EXCLUDES = {
  knees: ["Squat", "Lunge", "Leg Press", "Leg Extension", "Step-Up", "Split Squat", "Wall Sit"],
  shoulders: ["Overhead Press", "Lateral Raise", "Dip", "Push-Up", "Handstand", "Pike Push-Up", "Rear Delt Fly", "Y-Raise", "Arnold Press"],
  lower_back: ["Deadlift", "Row", "Good Morning"],
  wrists: ["Push-Up", "Plank", "Handstand"],
  elbows: ["Curl", "Extension", "Skull Crusher", "Kickback", "Tricep"],
};

function filterPool(pool, injuries) {
  if (!injuries || injuries.length === 0 || injuries.includes("none")) return pool;
  const terms = injuries.flatMap((i) => INJURY_EXCLUDES[i] || []).map((t) => t.toLowerCase());
  const out = {};
  Object.keys(pool).forEach((group) => {
    let list = pool[group].filter((name) => !terms.some((t) => name.toLowerCase().includes(t)));
    if (list.length === 0) list = pool[group];
    out[group] = list;
  });
  return out;
}

function pick(arr, n, offset = 0) {
  const rotated = arr.slice(offset % arr.length).concat(arr.slice(0, offset % arr.length));
  return rotated.slice(0, Math.min(n, arr.length));
}

const DAY_TEMPLATES = {
  full: [["legs", 2], ["chest", 1], ["back", 1], ["shoulders", 1], ["core", 1]],
  upper: [["chest", 2], ["back", 2], ["shoulders", 1], ["biceps", 1], ["triceps", 1]],
  lower: [["legs", 4], ["core", 2]],
  push: [["chest", 2], ["shoulders", 2], ["triceps", 2]],
  pull: [["back", 3], ["biceps", 2], ["core", 1]],
  legs: [["legs", 5], ["core", 1]],
  chestDay: [["chest", 3], ["triceps", 2]],
  backDay: [["back", 3], ["biceps", 2]],
  shouldersDay: [["shoulders", 3], ["core", 2]],
  armsDay: [["biceps", 3], ["triceps", 3]],
  coreWeakPoint: [["core", 3], ["shoulders", 1], ["legs", 1]],
};

const GOAL_SCHEME = {
  lose: { sets: 3, reps: "12-15", rest: 60, label: "Fat Loss" },
  build: { sets: 4, reps: "8-12", rest: 90, label: "Muscle Gain" },
  recomp: { sets: 3, reps: "10-12", rest: 75, label: "Lose Fat & Build Muscle" },
};

const DURATION_CAP = { 30: 4, 45: 5, 60: 6, 75: 8 };

function capFor(profile) {
  let cap = DURATION_CAP[profile.sessionLength] || 6;
  if (profile.experience === "advanced") cap += 1;
  if (profile.experience === "beginner") cap -= 1;
  return Math.max(3, cap);
}

function buildDay(kind, pool, goal, cap, offset) {
  const scheme = GOAL_SCHEME[goal];
  let exercises = [];
  DAY_TEMPLATES[kind].forEach(([group, n]) => {
    pick(pool[group], n, offset).forEach((name) => {
      exercises.push({ name, sets: scheme.sets, reps: scheme.reps, rest: scheme.rest });
    });
  });
  return exercises.slice(0, cap);
}

// Split structure depends on BOTH day count and training experience — a beginner
// and an advanced lifter training the same number of days per week should not
// necessarily land on the same split. This mirrors the guidance given to the AI
// generator and is used as the offline fallback if that call ever fails.
function splitForDays(days, experience) {
  if (days <= 3) return { key: "full3", labels: ["Full Body A", "Full Body B", "Full Body C"], kinds: ["full", "full", "full"] };
  if (days === 4) return { key: "ul4", labels: ["Upper A", "Lower A", "Upper B", "Lower B"], kinds: ["upper", "lower", "upper", "lower"] };
  if (days === 5) {
    if (experience === "advanced") {
      return { key: "bodypart5", labels: ["Chest", "Back", "Legs", "Shoulders", "Arms"], kinds: ["chestDay", "backDay", "legs", "shouldersDay", "armsDay"] };
    }
    return { key: "ppl_ul5", labels: ["Push", "Pull", "Legs", "Upper", "Lower"], kinds: ["push", "pull", "legs", "upper", "lower"] };
  }
  if (experience === "advanced") {
    return { key: "bodypart6", labels: ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core & Weak Points"], kinds: ["chestDay", "backDay", "legs", "shouldersDay", "armsDay", "coreWeakPoint"] };
  }
  return { key: "ppl6", labels: ["Push A", "Pull A", "Legs A", "Push B", "Pull B", "Legs B"], kinds: ["push", "pull", "legs", "push", "pull", "legs"] };
}

function splitDisplayName(key) {
  return {
    full3: "Full Body",
    ul4: "Upper / Lower",
    ppl_ul5: "Push / Pull / Legs / Upper / Lower",
    ppl6: "Push / Pull / Legs",
    bodypart5: "Body-Part Split",
    bodypart6: "Body-Part Split",
  }[key];
}

function buildProgram(profile) {
  const basePool = POOLS[profile.equipment];
  const pool = filterPool(basePool, profile.injuries);
  const cap = capFor(profile);
  const split = splitForDays(profile.daysPerWeek, profile.experience);
  const days = split.labels.map((label, i) => ({
    name: label,
    exercises: buildDay(split.kinds[i], pool, profile.goal, cap, i >= split.labels.length / 2 ? 2 : 0),
  }));
  return { splitName: splitDisplayName(split.key), days };
}

function splitGuidanceFor(days) {
  const map = {
    3: "Full Body (every session trains all major muscle groups) is the standard, most time-efficient choice for 3 days/week.",
    4: "Multiple valid options: Upper/Lower (2 upper + 2 lower), a 4-day Full Body rotation, or an Upper/Lower/Push/Pull hybrid. Pick whichever best fits this person's experience and desired physique — do not default to Upper/Lower automatically.",
    5: "Multiple valid options: Push/Pull/Legs/Upper/Lower, a body-part split (e.g. chest, back, legs, shoulders, arms), or Upper/Lower/Push/Pull/Legs. More advanced lifters or those wanting to prioritize specific areas often do better with more day-specific splits than a generic Upper/Lower.",
    6: "Push/Pull/Legs performed twice (PPL x2) is standard, but a 6-day body-part split (e.g. chest, back, shoulders, legs, arms, weak-point/core) is equally valid, especially for intermediate/advanced lifters or a specific physique goal.",
  };
  return map[days] || "Choose a split structure appropriate to this many training days.";
}

function buildProgramGenSystem(profile) {
  return `You are a world-class evidence-based strength & physique coach designing a brand-new, fully personalized training program from scratch for a new client. Apply mainstream exercise-science consensus: progressive overload, sensible per-muscle volume landmarks, rep ranges matched to the goal, and adequate recovery between sessions hitting the same muscles.

Client details:
- Sex: ${profile.sex}, Age: ${profile.age}, Height: ${Math.floor(profile.heightIn / 12)}'${profile.heightIn % 12}", Weight: ${profile.weightLb} lb
- Goal: ${profile.goal} (${GOAL_SCHEME[profile.goal]?.label})
- Current build: ${(profile.currentPhysique || "").replace(/_/g, " ")}
- Desired physique: "${profile.desiredPhysique}"
- Specific strength/performance goals: ${profile.specificGoals ? `"${profile.specificGoals}"` : "none stated"}
- Training experience: ${profile.experience}
- Equipment available: ${profile.equipment}
- Days per week available: ${profile.daysPerWeek}
- Target session length: ~${profile.sessionLength} minutes
- Injuries / areas to train around: ${(profile.injuries || []).join(", ") || "none"}
- Daily activity level outside training: ${profile.activity}

Split structure guidance for ${profile.daysPerWeek} days/week: ${splitGuidanceFor(profile.daysPerWeek)}
IMPORTANT: Do not default to an Upper/Lower split out of habit. Actually weigh which valid structure for this day count best serves THIS person's experience level and desired physique, and choose that one — different clients with the same day count should be able to land on different splits if their goals differ. If their desired physique calls out specific areas (e.g. "bigger arms", "glutes", "wider back"), prefer a split structure that lets you dedicate real, undiluted volume to that area rather than folding it into a generic day.

Design a training split and day-by-day program tailored specifically to this person — not a generic template. Weight exercise selection and volume toward their stated desired physique while staying balanced, joint-friendly, and appropriate for their experience level. Choose sets/reps/rest per exercise suited to their goal. Keep each day's exercise count realistic for the target session length (roughly one exercise per 6-8 minutes including warm-up and rest).
${profile.specificGoals ? `If they've stated specific performance goals (e.g. a target bench/squat/deadlift number, a bodyweight-strength milestone like a pull-up, a running goal), make sure the relevant lift or movement is programmed directly — include it with a rep/set scheme that actually builds toward that outcome (lower-rep strength work for a numeric lift goal, progressive skill/strength work for a bodyweight milestone), not just buried as one of several accessory options.` : ""}

Respond ONLY with a JSON object, no markdown fences, no prose outside the JSON, in exactly this shape:
{"splitName": "<short split name, e.g. 'Push / Pull / Legs'>", "days": [{"name": "<day name, e.g. 'Push Day'>", "exercises": [{"name": "<exercise name>", "sets": <number>, "reps": "<string like 8-12>", "rest": <number, seconds>}]}]}

Rules:
- "days" must have exactly ${profile.daysPerWeek} entries.
- Only include exercises doable with this equipment: ${profile.equipment === "full" ? "a fully-equipped gym (barbells, dumbbells, machines, cables)" : profile.equipment === "dumbbell" ? "dumbbells only" : "bodyweight only, no equipment"}.
- Never include exercises that would aggravate: ${(profile.injuries || []).join(", ") || "none — no restrictions"}.
- Every exercise needs realistic sets (2-5), a rep range string, and rest in seconds (30-180).`;
}

/* ============================================================
   NUTRITION CALC
============================================================ */
function calcTargets(profile) {
  const { sex, age, heightIn, weightLb, activity, goal } = profile;
  const kg = weightLb * 0.453592;
  const cm = heightIn * 2.54;
  let bmr = 10 * kg + 6.25 * cm - 5 * age + (sex === "male" ? 5 : -161);
  const actMult = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 }[activity];
  let tdee = bmr * actMult;
  let calories = tdee;
  if (goal === "lose") calories = tdee * 0.8;
  if (goal === "build") calories = tdee * 1.1;
  if (goal === "recomp") calories = tdee * 0.97;
  calories = Math.round(calories / 5) * 5;
  const protein = Math.round(weightLb * 1.0);
  const fat = Math.round((calories * 0.25) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat, tdee: Math.round(tdee) };
}

/* ============================================================
   STORAGE (Supabase — real accounts + real database)
============================================================ */
async function loadState(userId) {
  const { data, error } = await supabase.from("app_state").select("state").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("loadState failed", error);
    return null;
  }
  return data ? data.state : null;
}
async function saveState(userId, state) {
  const { error } = await supabase.from("app_state").upsert({ user_id: userId, state, updated_at: new Date().toISOString() });
  if (error) console.error("saveState failed", error);
}
async function loadProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) {
    console.error("loadProfile failed", error);
    return null;
  }
  return data;
}

const TRIAL_DAYS = 30;
function isTrialActive(startedAt) {
  if (!startedAt) return false;
  const elapsed = Date.now() - new Date(startedAt).getTime();
  return elapsed < TRIAL_DAYS * 24 * 60 * 60 * 1000;
}
function trialDaysLeft(startedAt) {
  if (!startedAt) return 0;
  const elapsed = Date.now() - new Date(startedAt).getTime();
  return Math.max(0, Math.ceil((TRIAL_DAYS * 24 * 60 * 60 * 1000 - elapsed) / (24 * 60 * 60 * 1000)));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/* ============================================================
   SMALL UI PRIMITIVES
============================================================ */
function Ring({ value, max, size = 76, stroke = 8, color, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={T.steel} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}

function TickRule({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "22px 0 10px" }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: 1, color: T.steelDark, textTransform: "uppercase", fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: `repeating-linear-gradient(90deg, ${T.steelDark} 0 2px, transparent 2px 6px)` }} />
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: T.card, borderRadius: 14, padding: 16, boxShadow: "0 1px 2px rgba(18,22,28,0.06)", border: `1px solid ${T.steel}`, ...style }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", style, disabled }) {
  const base = {
    border: "none", borderRadius: 10, padding: "12px 16px", fontFamily: "'Inter', sans-serif",
    fontWeight: 600, fontSize: 14, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "transform 0.1s",
  };
  const variants = {
    primary: { background: T.ink, color: "#fff" },
    accent: { background: T.charge, color: "#fff" },
    ghost: { background: "transparent", color: T.ink, border: `1px solid ${T.steel}` },
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.97)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {children}
    </button>
  );
}

/* ============================================================
   LOGIN
============================================================ */
function Login({ onSignUp, onSignIn }) {
  const [mode, setMode] = useState("signup"); // "signup" | "signin"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const inputStyle = { width: "100%", padding: "14px 16px", fontSize: 15, borderRadius: 10, border: "none", marginTop: 4, boxSizing: "border-box", fontFamily: "'Inter', sans-serif", color: T.ink, background: "#fff" };

  async function submit() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) return setError("Enter a valid email.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");

    setError("");
    setBusy(true);
    let result;
    if (mode === "signup") {
      const trimmedName = name.trim();
      if (!trimmedName) { setBusy(false); return setError("Enter your name."); }
      if (password !== confirm) { setBusy(false); return setError("Passwords don't match."); }
      result = await onSignUp({ name: trimmedName, email: trimmedEmail, password });
    } else {
      result = await onSignIn({ email: trimmedEmail, password });
    }
    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="auth-screen" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 28, background: T.ink, color: "#fff" }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 30 }}>
          <Zap size={20} color={T.charge} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 2, color: T.charge, fontWeight: 600 }}>OVERLOAD</span>
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 34, lineHeight: 1.1, margin: "18px 0 8px", fontWeight: 700 }}>
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>
        <p style={{ fontFamily: "'Inter', sans-serif", color: "#B9BEC6", fontSize: 14, lineHeight: 1.5, marginBottom: 26, maxWidth: 340 }}>
          Your program, logs, and chats are saved to this account so they're here next time you open the app.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "signup" && (
            <div>
              <label style={{ fontSize: 12, color: "#B9BEC6", fontWeight: 600 }}>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" style={inputStyle} />
            </div>
          )}
          <div>
            <label style={{ fontSize: 12, color: "#B9BEC6", fontWeight: 600 }}>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "#B9BEC6", fontWeight: 600 }}>Password</label>
            <input
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" type="password"
              onKeyDown={(e) => e.key === "Enter" && mode === "signin" && submit()}
              style={inputStyle}
            />
          </div>
          {mode === "signup" && (
            <div>
              <label style={{ fontSize: 12, color: "#B9BEC6", fontWeight: 600 }}>Confirm password</label>
              <input
                value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" type="password"
                onKeyDown={(e) => e.key === "Enter" && submit()}
                style={inputStyle}
              />
            </div>
          )}
          {error && <span style={{ color: "#FF8A80", fontSize: 13 }}>{error}</span>}
          <button
            onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); }}
            style={{ background: "none", border: "none", color: T.charge, fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left", padding: 0 }}
          >
            {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
        </div>
      </div>
      <Btn variant="accent" onClick={submit} disabled={busy} style={{ width: "100%", padding: "16px" }}>
        {busy ? "One sec…" : mode === "signup" ? "Create account" : "Sign in"} <ChevronRight size={18} />
      </Btn>
    </div>
  );
}

/* ============================================================
   PAYWALL
============================================================ */
function Paywall({ account, trialUsed, onStartTrial, onRefresh, onLogout }) {
  const [plan, setPlan] = useState("monthly");
  const [loading, setLoading] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Update these to match whatever you actually set as your Stripe prices —
  // this is just display text, Stripe is the source of truth for what's charged.
  const MONTHLY_PRICE = "$7.99";
  const YEARLY_PRICE = "$59.99";
  const YEARLY_SAVE_PCT = "37%";

  async function startCheckout() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email, userId: account.id, plan }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Couldn't start checkout. Try again.");
        setLoading(false);
      }
    } catch (e) {
      setError("Couldn't start checkout. Try again.");
      setLoading(false);
    }
  }

  async function handleStartTrial() {
    setTrialLoading(true);
    await onStartTrial();
    setTrialLoading(false);
  }

  async function refresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  const FEATURES = [
    "Training program built by AI for your exact goals",
    "Personalized calorie & macro targets",
    "Workout logging with rest timers & progress charts",
    "On-demand AI coach chat, anytime you need it",
  ];

  return (
    <div className="auth-screen" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 28, background: T.ink, color: "#fff" }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 30 }}>
          <Zap size={20} color={T.charge} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 2, color: T.charge, fontWeight: 600 }}>OVERLOAD</span>
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 32, lineHeight: 1.1, margin: "18px 0 14px", fontWeight: 700 }}>
          {trialUsed ? "Your trial has ended" : "Unlock your plan"}
        </h1>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
          {FEATURES.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <Check size={16} color={T.charge} style={{ marginTop: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: "#D6D9DE", lineHeight: 1.4 }}>{f}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button
            onClick={() => setPlan("monthly")}
            style={{ flex: 1, padding: "10px 0", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, border: `2px solid ${plan === "monthly" ? T.charge : "rgba(255,255,255,0.15)"}`, background: plan === "monthly" ? "rgba(78,74,242,0.15)" : "transparent", color: "#fff" }}
          >
            Monthly
          </button>
          <button
            onClick={() => setPlan("yearly")}
            style={{ flex: 1, padding: "10px 0", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, border: `2px solid ${plan === "yearly" ? T.charge : "rgba(255,255,255,0.15)"}`, background: plan === "yearly" ? "rgba(78,74,242,0.15)" : "transparent", color: "#fff", position: "relative" }}
          >
            Yearly
            <span style={{ position: "absolute", top: -10, right: -6, background: T.good, color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6 }}>SAVE {YEARLY_SAVE_PCT}</span>
          </button>
        </div>

        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 16, padding: 20, marginBottom: 14 }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 28, fontWeight: 700 }}>
            {plan === "monthly" ? MONTHLY_PRICE : YEARLY_PRICE}
            <span style={{ fontSize: 14, color: "#B9BEC6", fontWeight: 500 }}> / {plan === "monthly" ? "month" : "year"}</span>
          </div>
          <div style={{ fontSize: 13, color: "#B9BEC6", marginTop: 6 }}>Cancel anytime.</div>
        </div>
        {error && <p style={{ color: "#FF8A80", fontSize: 13 }}>{error}</p>}
      </div>
      <div>
        <Btn variant="accent" onClick={startCheckout} disabled={loading} style={{ width: "100%", padding: 16 }}>
          {loading ? "Redirecting…" : "Subscribe now"} <ChevronRight size={18} />
        </Btn>
        {!trialUsed && (
          <Btn variant="ghost" onClick={handleStartTrial} disabled={trialLoading} style={{ width: "100%", padding: 14, marginTop: 8, color: "#fff", borderColor: "rgba(255,255,255,0.2)" }}>
            {trialLoading ? "Starting…" : "Start 30-day free trial instead"}
          </Btn>
        )}
        <div style={{ textAlign: "center", fontSize: 11, color: "#6B7280", marginTop: 10 }}>
          {trialUsed ? "🔒 Payment secured by Stripe" : "🔒 No card needed for the trial — it just ends after 30 days"}
        </div>
        <button onClick={refresh} disabled={refreshing} style={{ width: "100%", background: "none", border: "none", color: "#B9BEC6", fontSize: 13, padding: "14px 0 4px", cursor: "pointer" }}>
          {refreshing ? "Checking…" : "Already subscribed? Refresh status"}
        </button>
        <button onClick={onLogout} style={{ width: "100%", background: "none", border: "none", color: "#6B7280", fontSize: 12, padding: "4px 0", cursor: "pointer" }}>
          Log out
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   SUBSCRIBE OVERLAY (in-app upgrade page, same offer as the paywall,
   but dismissible — reached from the Profile tab once already inside the app)
============================================================ */
function SubscribeOverlay({ account, onClose }) {
  const [plan, setPlan] = useState("monthly");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const MONTHLY_PRICE = "$7.99";
  const YEARLY_PRICE = "$59.99";
  const YEARLY_SAVE_PCT = "37%";

  async function startCheckout() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email, userId: account.id, plan }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Couldn't start checkout. Try again.");
        setLoading(false);
      }
    } catch (e) {
      setError("Couldn't start checkout. Try again.");
      setLoading(false);
    }
  }

  const FEATURES = [
    "Training program built by AI for your exact goals",
    "Personalized calorie & macro targets",
    "Workout logging with rest timers & progress charts",
    "On-demand AI coach chat, anytime you need it",
  ];

  return (
    <div className="fullscreen-overlay" style={{ background: T.ink, color: "#fff", zIndex: 65, overflowY: "auto" }}>
      <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 28, maxWidth: 560, margin: "0 auto" }}>
        <div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#B9BEC6", cursor: "pointer", padding: 0, marginBottom: 20 }}><X size={24} /></button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={20} color={T.charge} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 2, color: T.charge, fontWeight: 600 }}>OVERLOAD</span>
          </div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 32, lineHeight: 1.1, margin: "18px 0 14px", fontWeight: 700 }}>
            Upgrade to Overload
          </h1>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
            {FEATURES.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <Check size={16} color={T.charge} style={{ marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 14, color: "#D6D9DE", lineHeight: 1.4 }}>{f}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button
              onClick={() => setPlan("monthly")}
              style={{ flex: 1, padding: "10px 0", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, border: `2px solid ${plan === "monthly" ? T.charge : "rgba(255,255,255,0.15)"}`, background: plan === "monthly" ? "rgba(78,74,242,0.15)" : "transparent", color: "#fff" }}
            >
              Monthly
            </button>
            <button
              onClick={() => setPlan("yearly")}
              style={{ flex: 1, padding: "10px 0", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13, border: `2px solid ${plan === "yearly" ? T.charge : "rgba(255,255,255,0.15)"}`, background: plan === "yearly" ? "rgba(78,74,242,0.15)" : "transparent", color: "#fff", position: "relative" }}
            >
              Yearly
              <span style={{ position: "absolute", top: -10, right: -6, background: T.good, color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6 }}>SAVE {YEARLY_SAVE_PCT}</span>
            </button>
          </div>

          <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 16, padding: 20, marginBottom: 14 }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 28, fontWeight: 700 }}>
              {plan === "monthly" ? MONTHLY_PRICE : YEARLY_PRICE}
              <span style={{ fontSize: 14, color: "#B9BEC6", fontWeight: 500 }}> / {plan === "monthly" ? "month" : "year"}</span>
            </div>
            <div style={{ fontSize: 13, color: "#B9BEC6", marginTop: 6 }}>Cancel anytime.</div>
          </div>
          {error && <p style={{ color: "#FF8A80", fontSize: 13 }}>{error}</p>}
        </div>
        <div>
          <Btn variant="accent" onClick={startCheckout} disabled={loading} style={{ width: "100%", padding: 16 }}>
            {loading ? "Redirecting…" : "Subscribe now"} <ChevronRight size={18} />
          </Btn>
          <div style={{ textAlign: "center", fontSize: 11, color: "#6B7280", marginTop: 10 }}>🔒 Payment secured by Stripe</div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ONBOARDING QUIZ
============================================================ */
const QUIZ_STEPS = [
  { key: "sex", q: "What's your sex?", sub: "Used for an accurate energy-need calculation.", type: "choice", options: [["male", "Male"], ["female", "Female"]] },
  { key: "age", q: "How old are you?", type: "number", placeholder: "e.g. 28", min: 13, max: 90 },
  { key: "heightIn", q: "How tall are you?", type: "height" },
  { key: "weightLb", q: "What's your current weight?", sub: "In pounds.", type: "number", placeholder: "e.g. 165", min: 60, max: 500 },
  { key: "goal", q: "What's your main goal?", type: "choice", options: [["lose", "Lose Fat"], ["build", "Build Muscle"], ["recomp", "Both — Lose Fat & Build Muscle"]] },
  { key: "currentPhysique", q: "How would you describe your build right now?", type: "choice", options: [["higher_bf", "Just starting, higher body fat"], ["average", "Average build, some muscle"], ["athletic", "Athletic, fairly lean already"], ["lean_low_muscle", "Lean but low muscle mass"]] },
  { key: "desiredPhysique", q: "Describe the physique you're working toward.", sub: "A sentence is plenty — e.g. \"lean and athletic\" or \"bigger arms and chest.\" This helps your coach fine-tune things later.", type: "text", placeholder: "e.g. Lean, athletic, defined abs" },
  { key: "specificGoals", q: "Any specific strength or performance goals?", sub: "Optional — list anything concrete, e.g. \"bench 315\", \"do a strict pull-up\", \"squat 2x bodyweight.\" Leave blank if none.", type: "text", placeholder: "e.g. Bench 315 lb, do 10 strict pull-ups" },
  { key: "experience", q: "Training experience?", type: "choice", options: [["beginner", "Beginner (0-1 yr)"], ["intermediate", "Intermediate (1-3 yr)"], ["advanced", "Advanced (3+ yr)"]] },
  { key: "equipment", q: "What equipment do you have?", type: "choice", options: [["full", "Full Gym"], ["dumbbell", "Dumbbells Only"], ["bodyweight", "Bodyweight Only"]] },
  { key: "daysPerWeek", q: "How many days a week can you train?", type: "choice", options: [[3, "3 days"], [4, "4 days"], [5, "5 days"], [6, "6 days"]] },
  { key: "sessionLength", q: "How long do you want each workout to be?", type: "choice", options: [[30, "~30 min"], [45, "~45 min"], [60, "~60 min"], [75, "75+ min"]] },
  { key: "activity", q: "How active is your day-to-day (outside training)?", type: "choice", options: [["sedentary", "Desk job, little walking"], ["light", "On my feet sometimes"], ["moderate", "Active job / lots of walking"], ["active", "Physically demanding day"]] },
  { key: "injuries", q: "Any injuries or areas we should train around?", sub: "Select all that apply — we'll avoid exercises that stress these.", type: "multi", options: [["none", "None"], ["knees", "Knees"], ["shoulders", "Shoulders"], ["lower_back", "Lower back"], ["wrists", "Wrists"], ["elbows", "Elbows"]] },
];

function Onboarding({ onComplete }) {
  const [step, setStep] = useState(-1);
  const [answers, setAnswers] = useState({});
  const [feet, setFeet] = useState(5);
  const [inches, setInches] = useState(8);
  const [building, setBuilding] = useState(false);
  const [buildNote, setBuildNote] = useState("Designing your program…");

  const cur = QUIZ_STEPS[step];
  const canNext = !cur ? true
    : cur.type === "height" ? true
    : cur.type === "multi" ? (answers[cur.key]?.length > 0)
    : cur.type === "text" ? true
    : answers[cur.key] !== undefined && answers[cur.key] !== "";

  function setAns(key, val) {
    setAnswers((a) => ({ ...a, [key]: val }));
  }

  function toggleMulti(key, val) {
    setAnswers((a) => {
      const arr = a[key] || [];
      let next;
      if (val === "none") next = ["none"];
      else if (arr.includes(val)) next = arr.filter((v) => v !== val);
      else next = [...arr.filter((v) => v !== "none"), val];
      return { ...a, [key]: next };
    });
  }

  function next() {
    if (cur.type === "height") setAns("heightIn", (Number(feet) || 5) * 12 + (Number(inches) || 0));
    if (step === QUIZ_STEPS.length - 1) finish();
    else setStep((s) => s + 1);
  }

  async function finish() {
    const profile = {
      ...answers,
      heightIn: answers.heightIn || (Number(feet) || 5) * 12 + (Number(inches) || 0),
      desiredPhysique: answers.desiredPhysique || "balanced, athletic build",
      specificGoals: answers.specificGoals || "",
      injuries: answers.injuries || ["none"],
      name: "",
    };
    const targets = calcTargets(profile);
    setBuilding(true);
    // Instant, reliable fallback in case the AI call fails or is slow.
    let program = buildProgram(profile);
    try {
      setBuildNote("Analyzing your goals and building your split…");
      const raw = await claudeChat({
        system: buildProgramGenSystem(profile),
        messages: [{ role: "user", content: "Design my personalized training program now." }],
      });
      const parsed = parseJSONLoose(raw);
      if (parsed && Array.isArray(parsed.days) && parsed.days.length > 0) {
        program = { splitName: parsed.splitName || program.splitName, days: parsed.days };
      }
    } catch (e) {
      // Fall back silently to the rule-based program below.
    }
    onComplete({ profile, program, targets });
  }

  if (building) {
    return (
      <div className="auth-screen" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, background: T.ink, color: "#fff", textAlign: "center" }}>
        <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
        <Loader2 size={36} color={T.charge} className="spin" />
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: "18px 0 6px" }}>{buildNote}</h2>
        <p style={{ color: "#B9BEC6", fontSize: 13, maxWidth: 280 }}>Weighing your goal, experience, equipment, injuries, and desired physique to build a program made for you.</p>
        <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (step === -1) {
    return (
      <div className="auth-screen" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 28, background: T.ink, color: "#fff" }}>
        <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 30 }}>
            <Zap size={20} color={T.charge} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 2, color: T.charge, fontWeight: 600 }}>EVIDENCE-BASED COACHING</span>
          </div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 42, lineHeight: 1.05, margin: "18px 0 0", fontWeight: 700 }}>

            Your plan,<br />built from<br /><span style={{ color: T.charge }}>your numbers.</span>
          </h1>
          <p style={{ fontFamily: "'Inter', sans-serif", color: "#B9BEC6", fontSize: 15, lineHeight: 1.5, marginTop: 18, maxWidth: 320 }}>
            A 13-question quiz covers your goals, injuries, physique targets, and schedule. You'll get a full program, calorie & macro targets — and an AI coach on call to fine-tune it any time.
          </p>
        </div>
        <Btn variant="accent" onClick={() => setStep(0)} style={{ width: "100%", padding: "16px" }}>
          Start the quiz <ChevronRight size={18} />
        </Btn>
      </div>
    );
  }

  return (
    <div className="auth-screen" style={{ display: "flex", flexDirection: "column", padding: 24, background: T.paper }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <div style={{ display: "flex", gap: 3, marginBottom: 24, flexWrap: "wrap" }}>
        {QUIZ_STEPS.map((_, i) => (
          <div key={i} style={{ flex: 1, minWidth: 12, height: 4, borderRadius: 2, background: i <= step ? T.charge : T.steel }} />
        ))}
      </div>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, fontWeight: 600 }}>
        {String(step + 1).padStart(2, "0")} / {String(QUIZ_STEPS.length).padStart(2, "0")}
      </span>
      <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 700, color: T.ink, margin: "8px 0 4px" }}>{cur.q}</h2>
      {cur.sub && <p style={{ color: T.steelDark, fontSize: 13, marginBottom: 10 }}>{cur.sub}</p>}

      <div style={{ marginTop: 14, flex: 1, overflowY: "auto" }}>
        {cur.type === "choice" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {cur.options.map(([val, label]) => (
              <button
                key={val}
                onClick={() => setAns(cur.key, val)}
                style={{
                  textAlign: "left", padding: "16px 18px", borderRadius: 12, cursor: "pointer",
                  border: `2px solid ${answers[cur.key] === val ? T.charge : T.steel}`,
                  background: answers[cur.key] === val ? "#EEEDFF" : T.card,
                  fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 15, color: T.ink,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {cur.type === "multi" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {cur.options.map(([val, label]) => {
              const active = (answers[cur.key] || []).includes(val);
              return (
                <button
                  key={val}
                  onClick={() => toggleMulti(cur.key, val)}
                  style={{
                    padding: "12px 16px", borderRadius: 20, cursor: "pointer",
                    border: `2px solid ${active ? T.charge : T.steel}`,
                    background: active ? "#EEEDFF" : T.card,
                    fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 14, color: T.ink,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {cur.type === "number" && (
          <input
            autoFocus type="number" placeholder={cur.placeholder} value={answers[cur.key] ?? ""}
            onChange={(e) => setAns(cur.key, e.target.value === "" ? "" : Number(e.target.value))}
            style={{ width: "100%", padding: "16px 18px", fontSize: 20, borderRadius: 12, border: `2px solid ${T.steel}`, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, boxSizing: "border-box" }}
          />
        )}
        {cur.type === "text" && (
          <textarea
            autoFocus placeholder={cur.placeholder} value={answers[cur.key] ?? ""}
            onChange={(e) => setAns(cur.key, e.target.value)}
            rows={3}
            style={{ width: "100%", padding: "16px 18px", fontSize: 16, borderRadius: 12, border: `2px solid ${T.steel}`, fontFamily: "'Inter', sans-serif", boxSizing: "border-box", resize: "none" }}
          />
        )}
        {cur.type === "height" && (
          <div style={{ display: "flex", gap: 12 }}>
            {[["ft", feet, setFeet, 3, 8], ["in", inches, setInches, 0, 11]].map(([lab, v, setV, min, max]) => (
              <div key={lab} style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: T.steelDark, fontWeight: 600 }}>{lab}</label>
                <input
                  type="number" value={v} min={min} max={max}
                  onChange={(e) => setV(e.target.value === "" ? "" : Number(e.target.value))}
                  onBlur={(e) => setV(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
                  style={{ width: "100%", padding: "16px", fontSize: 20, borderRadius: 12, border: `2px solid ${T.steel}`, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, boxSizing: "border-box", marginTop: 4 }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        {step > 0 && <Btn variant="ghost" onClick={() => setStep((s) => s - 1)}><ChevronLeft size={18} /></Btn>}
        <Btn variant="accent" onClick={next} disabled={!canNext} style={{ flex: 1 }}>
          {step === QUIZ_STEPS.length - 1 ? "Build my plan" : "Next"} <ChevronRight size={18} />
        </Btn>
      </div>
    </div>
  );
}

/* ============================================================
   REST TIMER
============================================================ */
function RestTimer({ seconds, total, onAdd, onSkip }) {
  const pct = Math.max(0, seconds / total);
  const done = seconds <= 0;
  return (
    <div className="fullscreen-overlay" style={{ background: "rgba(18,22,28,0.92)", zIndex: 60, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff" }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 2, color: done ? T.good : T.charge, fontWeight: 700 }}>
        {done ? "REST COMPLETE" : "RESTING"}
      </span>
      <div style={{ position: "relative", margin: "24px 0" }}>
        <Ring value={pct} max={1} size={200} stroke={10} color={done ? T.good : T.charge}>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 52, fontWeight: 700 }}>{Math.max(0, seconds)}</span>
        </Ring>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        {!done && <Btn variant="ghost" onClick={onAdd} style={{ color: "#fff", borderColor: "#3A4048" }}><PlusCircle size={16} /> 15s</Btn>}
        <Btn variant="accent" onClick={onSkip}>{done ? "Continue" : <>Skip <SkipForward size={16} /></>}</Btn>
      </div>
    </div>
  );
}

/* ============================================================
   WORKOUT SESSION
============================================================ */
function WorkoutSession({ day, isOverride, lastLog, onFinish, onCancel }) {
  const [sets, setSets] = useState(() =>
    day.exercises.map((ex) => ({
      name: ex.name, reps: ex.reps, rest: ex.rest,
      logged: Array.from({ length: ex.sets }, () => ({ weight: "", reps: "", done: false })),
    }))
  );
  const [rest, setRest] = useState(null); // {seconds, total}
  const [confirmExit, setConfirmExit] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (rest === null) return;
    intervalRef.current = setInterval(() => {
      setRest((r) => (r ? { ...r, seconds: r.seconds - 1 } : null));
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [rest === null]);

  function updateSet(exIdx, setIdx, field, val) {
    setSets((s) => {
      const copy = s.map((e) => ({ ...e, logged: e.logged.map((l) => ({ ...l })) }));
      copy[exIdx].logged[setIdx][field] = val;
      return copy;
    });
  }

  function toggleDone(exIdx, setIdx) {
    let willStartRest = false;
    setSets((s) => {
      const copy = s.map((e) => ({ ...e, logged: e.logged.map((l) => ({ ...l })) }));
      const newVal = !copy[exIdx].logged[setIdx].done;
      copy[exIdx].logged[setIdx].done = newVal;
      if (newVal) willStartRest = true;
      return copy;
    });
    if (willStartRest) {
      const restSeconds = sets[exIdx].rest;
      setRest({ seconds: restSeconds, total: restSeconds });
    }
  }

  function lastFor(name) {
    if (!lastLog) return null;
    const found = lastLog.exercises.find((e) => e.name === name);
    if (!found) return null;
    const best = found.logged.filter((l) => l.weight).slice(-1)[0];
    return best ? `${best.weight}lb x ${best.reps}` : null;
  }

  const totalSets = sets.reduce((a, e) => a + e.logged.length, 0);
  const doneSets = sets.reduce((a, e) => a + e.logged.filter((l) => l.done).length, 0);

  return (
    <div className="fullscreen-overlay" style={{ background: T.paper, zIndex: 50, display: "flex", flexDirection: "column" }}>
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>
      <div style={{ background: T.ink, padding: "calc(18px + env(safe-area-inset-top, 0px)) 20px 22px", color: "#fff", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => setConfirmExit(true)} style={{ background: "none", border: "none", color: "#B9BEC6", cursor: "pointer" }}><X size={22} /></button>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: T.charge, fontWeight: 700 }}>{doneSets}/{totalSets} SETS</span>
        </div>
        <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 700, margin: "10px 0 0" }}>{day.name}</h2>
        {isOverride && (
          <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(78,74,242,0.2)", color: T.charge, fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20 }}>
            <Sparkles size={12} /> SWAPPED BY COACH FOR TODAY ONLY
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {sets.map((ex, exIdx) => (
          <Card key={exIdx} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 700, margin: 0 }}>{ex.name}</h3>
              <span style={{ fontSize: 12, color: T.steelDark, fontFamily: "'JetBrains Mono', monospace" }}>{ex.reps} reps · {ex.rest}s rest</span>
            </div>
            {lastFor(ex.name) && (
              <div style={{ fontSize: 12, color: T.charge, marginTop: 4, fontWeight: 600 }}>Last time: {lastFor(ex.name)}</div>
            )}
            <div style={{ marginTop: 10 }}>
              {ex.logged.map((l, setIdx) => (
                <div key={setIdx} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ width: 16, flexShrink: 0, fontSize: 12, color: T.steelDark, fontFamily: "'JetBrains Mono', monospace" }}>{setIdx + 1}</span>
                  <input
                    type="number" placeholder="lb" value={l.weight}
                    onChange={(e) => updateSet(exIdx, setIdx, "weight", e.target.value)}
                    style={{ flex: 1, minWidth: 0, padding: "10px 6px", borderRadius: 8, border: `1.5px solid ${T.steel}`, fontFamily: "'JetBrains Mono', monospace", fontSize: 16, boxSizing: "border-box" }}
                  />
                  <input
                    type="number" placeholder="reps" value={l.reps}
                    onChange={(e) => updateSet(exIdx, setIdx, "reps", e.target.value)}
                    style={{ flex: 1, minWidth: 0, padding: "10px 6px", borderRadius: 8, border: `1.5px solid ${T.steel}`, fontFamily: "'JetBrains Mono', monospace", fontSize: 16, boxSizing: "border-box" }}
                  />
                  <button
                    onClick={() => toggleDone(exIdx, setIdx)}
                    style={{
                      width: 34, height: 34, borderRadius: 8, border: "none", flexShrink: 0,
                      background: l.done ? T.good : T.steel, color: "#fff", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Check size={18} />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <div style={{ padding: "16px 16px calc(16px + env(safe-area-inset-bottom, 0px))", background: T.paper, borderTop: `1px solid ${T.steel}`, flexShrink: 0 }}>
        <Btn variant="accent" style={{ width: "100%", padding: 16 }} onClick={() => onFinish(sets)}>
          Finish workout <Check size={18} />
        </Btn>
      </div>

      {rest !== null && (
        <RestTimer
          seconds={rest.seconds} total={rest.total}
          onAdd={() => setRest((r) => ({ ...r, seconds: r.seconds + 15, total: r.total + 15 }))}
          onSkip={() => setRest(null)}
        />
      )}

      {confirmExit && (
        <div className="fullscreen-overlay" style={{ background: "rgba(18,22,28,0.92)", zIndex: 70, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", padding: 28, textAlign: "center" }}>
          <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>Exit this workout?</h3>
          <p style={{ color: "#B9BEC6", fontSize: 14, maxWidth: 320, marginBottom: 24 }}>Your logged sets so far will be lost unless you resume.</p>
          <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 320 }}>
            <Btn variant="ghost" onClick={() => setConfirmExit(false)} style={{ flex: 1, color: "#fff", borderColor: "rgba(255,255,255,0.25)" }}>Resume</Btn>
            <Btn variant="accent" onClick={onCancel} style={{ flex: 1, background: T.protein }}>Discard</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   MAIN SCREENS: HOME / TRAIN
============================================================ */
function StatChip({ label, val, color, icon }) {
  return (
    <Card style={{ flex: 1, textAlign: "center", padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>{icon}</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15, color: T.ink }}>{val}</div>
      <div style={{ fontSize: 10, color: T.steelDark, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    </Card>
  );
}

function Home({ state, setActiveTab, startWorkout }) {
  const { program, targets, logs } = state;
  const nextIdx = logs.workouts.length % program.days.length;
  const nextDay = program.days[nextIdx];
  const today = todayISO();
  const todayMeals = (logs.nutrition.find((d) => d.date === today) || { meals: [] }).meals;
  const cals = todayMeals.reduce((a, m) => a + m.cal, 0);
  const thisWeek = logs.workouts.filter((w) => (new Date() - new Date(w.date)) / 86400000 < 7).length;

  return (
    <div style={{ padding: "20px 16px 90px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, letterSpacing: 1, fontWeight: 600 }}>TODAY</span>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "2px 0 0", color: T.ink }}>
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </h1>
        </div>
        <div style={{ background: T.ink, borderRadius: 10, padding: "8px 12px", textAlign: "center" }}>
          <div style={{ color: T.charge, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 16 }}>{thisWeek}</div>
          <div style={{ color: "#B9BEC6", fontSize: 9, fontWeight: 700 }}>THIS WK</div>
        </div>
      </div>

      <TickRule label="Next workout" />
      <Card style={{ background: T.ink, border: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ color: T.charge, fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{program.splitName.toUpperCase()}</span>
            <h3 style={{ color: "#fff", fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, margin: "4px 0 8px" }}>{nextDay.name}</h3>
            <span style={{ color: "#B9BEC6", fontSize: 13 }}>{nextDay.exercises.length} exercises</span>
          </div>
          <Dumbbell size={30} color={T.charge} />
        </div>
        <Btn variant="accent" style={{ width: "100%", marginTop: 14 }} onClick={() => startWorkout(nextIdx)}>
          Start workout <ChevronRight size={16} />
        </Btn>
      </Card>

      <TickRule label="Today's fuel" />
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 28, fontWeight: 700, color: T.ink }}>{cals}<span style={{ fontSize: 15, color: T.steelDark }}> / {targets.calories} cal</span></div>
            <div style={{ fontSize: 13, color: T.steelDark, marginTop: 2 }}>{Math.max(0, targets.calories - cals)} cal remaining</div>
          </div>
          <Ring value={cals} max={targets.calories} color={T.charge} size={64} stroke={7}>
            <Flame size={22} color={T.charge} />
          </Ring>
        </div>
        <Btn variant="ghost" style={{ width: "100%", marginTop: 14 }} onClick={() => setActiveTab("fuel")}>
          Log food <Plus size={16} />
        </Btn>
      </Card>

      <TickRule label="Your targets" />
      <div style={{ display: "flex", gap: 10 }}>
        <StatChip label="Protein" val={`${targets.protein}g`} color={T.protein} icon={<Beef size={16} color={T.protein} />} />
        <StatChip label="Carbs" val={`${targets.carbs}g`} color={T.carb} icon={<Wheat size={16} color={T.carb} />} />
        <StatChip label="Fat" val={`${targets.fat}g`} color={T.fat} icon={<Droplet size={16} color={T.fat} />} />
      </div>
    </div>
  );
}

function Train({ state, startWorkout }) {
  const { program, logs } = state;
  const nextIdx = logs.workouts.length % program.days.length;
  return (
    <div style={{ padding: "20px 16px 90px" }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, letterSpacing: 1, fontWeight: 600 }}>YOUR PROGRAM</span>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "2px 0 4px", color: T.ink }}>{program.splitName}</h1>
      <p style={{ color: T.steelDark, fontSize: 13, marginBottom: 4 }}>{program.days.length}-day rotating split · tap a day to log it</p>

      <TickRule label="Sessions" />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {program.days.map((day, i) => (
          <Card key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: i === nextIdx ? `2px solid ${T.charge}` : `1px solid ${T.steel}` }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 700, margin: 0, color: T.ink }}>{day.name}</h3>
                {i === nextIdx && <span style={{ background: "#EEEDFF", color: T.charge, fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 6 }}>NEXT</span>}
              </div>
              <div style={{ fontSize: 12, color: T.steelDark, marginTop: 3 }}>{day.exercises.map((e) => e.name).join(" · ")}</div>
            </div>
            <button onClick={() => startWorkout(i)} style={{ background: T.ink, border: "none", borderRadius: 10, width: 40, height: 40, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <ChevronRight size={18} color="#fff" />
            </button>
          </Card>
        ))}
      </div>

      <TickRule label="History" />
      {logs.workouts.length === 0 && <p style={{ color: T.steelDark, fontSize: 13 }}>No workouts logged yet.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {logs.workouts.slice().reverse().slice(0, 8).map((w, i) => (
          <Card key={i} style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>{w.dayName}</span>
              <span style={{ fontSize: 12, color: T.steelDark, fontFamily: "'JetBrains Mono', monospace" }}>{w.date}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   COACH (AI CHAT)
============================================================ */
function buildCoachSystem(state) {
  const p = state.profile;
  return `You are an evidence-based strength & nutrition coach embedded in a workout app called Overload.
User profile: goal=${p.goal}, experience=${p.experience}, equipment=${p.equipment}, days/week=${p.daysPerWeek}, session length=${p.sessionLength} min, injuries=${(p.injuries || []).join(",") || "none"}, current build="${p.currentPhysique}", desired physique="${p.desiredPhysique}", specific performance goals="${p.specificGoals || "none stated"}".
Current program JSON: ${JSON.stringify(state.program)}

The user will chat with you to adjust their training (swap exercises, change intensity, work around an injury, change split, add/remove exercises, etc.) or just ask training questions.

There are TWO different kinds of requests — telling them apart matters:
1. PERMANENT changes — the user wants their ongoing program itself changed going forward (e.g. "change my split," "my knees hurt in general, adjust my program permanently," "give me more back volume from now on"). For these, modify "program" and leave "todayOverride" null.
2. ONE-TIME / temporary swaps for just their next upcoming session — the user says "today," "this session," "just for now," or gives a clearly temporary reason (short on time right now, a passing ache, etc.), and does NOT ask for a lasting change. For these, set "program" to null (do NOT echo the current program back — it's unused and just wastes space), and instead put ONLY the substituted exercises for that one session in "todayOverride". Never rename or permanently relabel a day for a one-time request.

Worked example — user says "my knees hurt, adjust leg day for today": this is case 2. The correct response has "program" set to null, and "todayOverride" set to a short fresh list of knee-friendly leg exercises for just that one session. Nothing else. Contrast with "my knees hurt in general, please adjust my program" — that IS case 1: modify "program"'s leg day(s) directly (returning the full program) and leave "todayOverride" null.

Respond ONLY with a JSON object, no markdown fences, no prose outside the JSON, in exactly this shape. Your response must START with the { character — do not write any sentence, greeting, or summary before it, even a short one:
{"reply": "<a short, friendly 2-4 sentence explanation, written directly to the user>", "program": null or {"splitName": "<string>", "days": [{"name": "<string>", "exercises": [{"name": "<string>", "sets": <number>, "reps": "<string like 8-12>", "rest": <number seconds>}]}]}, "todayOverride": null or [{"name": "<string>", "sets": <number>, "reps": "<string like 8-12>", "rest": <number seconds>}]}

Rules:
- Only include exercises doable with their equipment (${p.equipment}).
- Never include exercises that would aggravate stated injuries.
- If the request doesn't require any change at all (e.g. a general question), set "program" to null, "todayOverride" to null, and just answer helpfully in "reply".
- Keep the same number of training days unless the user explicitly asks to change their weekly schedule.
- Keep total exercises per day reasonable for a ${p.sessionLength}-minute session.
- Exactly one of "program" or "todayOverride" should be non-null — never both, never neither (unless nothing needs to change, per the rule above).`;
}

const DEFAULT_COACH_MESSAGES = [
  { role: "assistant", text: "Hey — I'm your coach. Ask me to adjust your program: swap an exercise, work around an injury, add volume, change your split, or anything else." },
];

function Coach({ messages, loading, onSend }) {
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);
  const list = messages && messages.length > 0 ? messages : DEFAULT_COACH_MESSAGES;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    onSend(text);
  }

  return (
    <div className="coach-panel" style={{ padding: "20px 16px 0" }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, letterSpacing: 1, fontWeight: 600 }}>AI COACH</span>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "2px 0 12px", color: T.ink }}>Ask your coach</h1>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingBottom: 10 }}>
        {list.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
            <div style={{
              background: m.role === "user" ? T.charge : T.card, color: m.role === "user" ? "#fff" : T.ink,
              border: m.role === "user" ? "none" : `1px solid ${T.steel}`,
              padding: "10px 14px", borderRadius: 14,
              borderBottomRightRadius: m.role === "user" ? 4 : 14,
              borderBottomLeftRadius: m.role === "user" ? 14 : 4,
              fontSize: 14, lineHeight: 1.4,
            }}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: "flex-start", color: T.steelDark, display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <Loader2 size={14} className="spin" /> Coach is thinking…
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, padding: "10px 0 16px" }}>
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="e.g. My shoulder hurts, adjust push day"
          style={{ flex: 1, padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${T.steel}`, fontFamily: "'Inter', sans-serif", fontSize: 14, boxSizing: "border-box" }}
        />
        <Btn variant="accent" onClick={send} disabled={loading}><Send size={16} /></Btn>
      </div>
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ============================================================
   FUEL
============================================================ */
function MacroBar({ label, val, max, color }) {
  const pct = Math.min(100, (val / Math.max(1, max)) * 100);
  return (
    <div style={{ width: 130 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: T.ink, fontWeight: 600 }}>{label}</span>
        <span style={{ color: T.steelDark, fontFamily: "'JetBrains Mono', monospace" }}>{val}/{max}g</span>
      </div>
      <div style={{ height: 6, background: T.steel, borderRadius: 3 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

function Fuel({ state, addMeal, removeMeal }) {
  const { targets, logs, profile } = state;
  const today = todayISO();
  const todayLog = logs.nutrition.find((d) => d.date === today) || { date: today, meals: [] };
  const totals = todayLog.meals.reduce((a, m) => ({ cal: a.cal + m.cal, protein: a.protein + m.protein, carb: a.carb + m.carb, fat: a.fat + m.fat }), { cal: 0, protein: 0, carb: 0, fat: 0 });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", cal: "", protein: "", carb: "", fat: "" });

  const [suggestions, setSuggestions] = useState(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState(null);

  const [photoResult, setPhotoResult] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const fileInputRef = useRef(null);

  function submit() {
    if (!form.name || !form.cal) return;
    addMeal({ name: form.name, cal: Number(form.cal) || 0, protein: Number(form.protein) || 0, carb: Number(form.carb) || 0, fat: Number(form.fat) || 0 });
    setForm({ name: "", cal: "", protein: "", carb: "", fat: "" });
    setShowForm(false);
  }

  async function getSuggestions() {
    setSuggestLoading(true);
    setSuggestError(null);
    setSuggestions(null);
    try {
      const remaining = { cal: targets.calories - totals.cal, protein: targets.protein - totals.protein, carb: targets.carbs - totals.carb, fat: targets.fat - totals.fat };
      const system = `You are a nutrition coach. Given remaining macro budget for today and the user's goal, suggest exactly 3 realistic meal or snack options that fit. Respond ONLY with JSON, no markdown fences: {"suggestions": [{"name": "<string>", "cal": <number>, "protein": <number>, "carb": <number>, "fat": <number>, "note": "<short reason, under 15 words>"}]}`;
      const userMsg = `Goal: ${profile.goal}. Desired physique: ${profile.desiredPhysique}. Remaining today: ${JSON.stringify(remaining)}. Suggest meals or snacks that fit.`;
      const raw = await claudeChat({ system, messages: [{ role: "user", content: userMsg }] });
      const parsed = parseJSONLoose(raw);
      setSuggestions(parsed.suggestions || []);
    } catch (e) {
      setSuggestError("Couldn't get suggestions — try again.");
    } finally {
      setSuggestLoading(false);
    }
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoLoading(true);
    setPhotoError(null);
    setPhotoResult(null);
    try {
      const base64 = await fileToBase64(file);
      const mediaType = file.type || "image/jpeg";
      const raw = await claudeChat({
        system: "You analyze photos of meals for a fitness app. Estimate the food and its nutrition. Respond ONLY with JSON, no markdown fences: {\"name\": \"<short meal name>\", \"cal\": <number>, \"protein\": <number>, \"carb\": <number>, \"fat\": <number>, \"note\": \"<one short caveat about the estimate, under 15 words>\"}",
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: "Identify this meal and estimate its calories and macros." },
        ] }],
      });
      const parsed = parseJSONLoose(raw);
      setPhotoResult(parsed);
    } catch (err) {
      setPhotoError("Couldn't analyze that photo — try again or add manually.");
    } finally {
      setPhotoLoading(false);
      e.target.value = "";
    }
  }

  return (
    <div style={{ padding: "20px 16px 90px" }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, letterSpacing: 1, fontWeight: 600 }}>NUTRITION</span>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "2px 0 4px", color: T.ink }}>Today's Fuel</h1>

      <Card style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
          <Ring value={totals.cal} max={targets.calories} color={T.charge} size={90} stroke={9}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 17 }}>{totals.cal}</div>
              <div style={{ fontSize: 9, color: T.steelDark }}>/ {targets.calories}</div>
            </div>
          </Ring>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <MacroBar label="Protein" val={totals.protein} max={targets.protein} color={T.protein} />
            <MacroBar label="Carbs" val={totals.carb} max={targets.carbs} color={T.carb} />
            <MacroBar label="Fat" val={totals.fat} max={targets.fat} color={T.fat} />
          </div>
        </div>
      </Card>

      <TickRule label="Meals logged" />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {todayLog.meals.map((m, i) => (
          <Card key={i} style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>{m.name}</div>
              <div style={{ fontSize: 11, color: T.steelDark, fontFamily: "'JetBrains Mono', monospace" }}>{m.cal} cal · P{m.protein} C{m.carb} F{m.fat}</div>
            </div>
            <button onClick={() => removeMeal(i)} style={{ background: "none", border: "none", color: T.steelDark, cursor: "pointer" }}><X size={16} /></button>
          </Card>
        ))}
        {todayLog.meals.length === 0 && !showForm && <p style={{ color: T.steelDark, fontSize: 13 }}>Nothing logged yet today.</p>}
      </div>

      {showForm && (
        <Card style={{ marginTop: 12 }}>
          <input placeholder="Meal name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            style={{ width: "100%", padding: 12, borderRadius: 8, border: `1.5px solid ${T.steel}`, marginBottom: 8, boxSizing: "border-box", fontFamily: "'Inter', sans-serif" }} />
          <input placeholder="Calories" type="number" value={form.cal} onChange={(e) => setForm({ ...form, cal: e.target.value })}
            style={{ width: "100%", padding: 12, borderRadius: 8, border: `1.5px solid ${T.steel}`, marginBottom: 8, boxSizing: "border-box", fontFamily: "'JetBrains Mono', monospace" }} />
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input placeholder="Protein g" type="number" value={form.protein} onChange={(e) => setForm({ ...form, protein: e.target.value })}
              style={{ flex: 1, minWidth: 0, padding: "10px 6px", borderRadius: 8, border: `1.5px solid ${T.steel}`, boxSizing: "border-box", fontFamily: "'JetBrains Mono', monospace", fontSize: 16 }} />
            <input placeholder="Carbs g" type="number" value={form.carb} onChange={(e) => setForm({ ...form, carb: e.target.value })}
              style={{ flex: 1, minWidth: 0, padding: "10px 6px", borderRadius: 8, border: `1.5px solid ${T.steel}`, boxSizing: "border-box", fontFamily: "'JetBrains Mono', monospace", fontSize: 16 }} />
            <input placeholder="Fat g" type="number" value={form.fat} onChange={(e) => setForm({ ...form, fat: e.target.value })}
              style={{ flex: 1, minWidth: 0, padding: "10px 6px", borderRadius: 8, border: `1.5px solid ${T.steel}`, boxSizing: "border-box", fontFamily: "'JetBrains Mono', monospace", fontSize: 16 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" onClick={() => setShowForm(false)} style={{ flex: 1 }}>Cancel</Btn>
            <Btn variant="accent" onClick={submit} style={{ flex: 1 }}>Add meal</Btn>
          </div>
        </Card>
      )}

      {!showForm && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Btn variant="primary" style={{ flex: 1 }} onClick={() => setShowForm(true)}><Plus size={16} /> Add meal</Btn>
          <Btn variant="ghost" style={{ flex: 1 }} onClick={() => fileInputRef.current?.click()}><Camera size={16} /> Photo</Btn>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handlePhoto} />

      {photoLoading && (
        <Card style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <Loader2 size={16} className="spin" /> <span style={{ fontSize: 13, color: T.steelDark }}>Analyzing your photo…</span>
        </Card>
      )}
      {photoError && (
        <Card style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, borderColor: T.warn }}>
          <AlertCircle size={16} color={T.warn} /> <span style={{ fontSize: 13, color: T.ink }}>{photoError}</span>
        </Card>
      )}
      {photoResult && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.ink }}>{photoResult.name}</div>
          {photoResult.note && <div style={{ fontSize: 12, color: T.steelDark, marginTop: 2 }}>{photoResult.note}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "10px 0" }}>
            {[["cal", "Calories"], ["protein", "Protein (g)"], ["carb", "Carbs (g)"], ["fat", "Fat (g)"]].map(([k, lab]) => (
              <div key={k}>
                <label style={{ fontSize: 10, color: T.steelDark, fontWeight: 600 }}>{lab}</label>
                <input
                  type="number" value={photoResult[k]}
                  onChange={(e) => setPhotoResult({ ...photoResult, [k]: e.target.value === "" ? "" : Number(e.target.value) })}
                  style={{ width: "100%", marginTop: 2, padding: 10, borderRadius: 8, border: `1.5px solid ${T.steel}`, fontFamily: "'JetBrains Mono', monospace", fontSize: 16, boxSizing: "border-box" }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" style={{ flex: 1 }} onClick={() => setPhotoResult(null)}>Discard</Btn>
            <Btn variant="accent" style={{ flex: 1 }} onClick={() => { addMeal({ name: photoResult.name, cal: photoResult.cal, protein: photoResult.protein, carb: photoResult.carb, fat: photoResult.fat }); setPhotoResult(null); }}>
              Add to log
            </Btn>
          </div>
        </Card>
      )}

      <TickRule label="Need ideas?" />
      {!suggestions && !suggestLoading && (
        <Btn variant="ghost" style={{ width: "100%" }} onClick={getSuggestions}><Sparkles size={16} /> Suggest meals for what's left today</Btn>
      )}
      {suggestLoading && (
        <Card style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Loader2 size={16} className="spin" /> <span style={{ fontSize: 13, color: T.steelDark }}>Thinking of options…</span>
        </Card>
      )}
      {suggestError && <p style={{ color: T.warn, fontSize: 13 }}>{suggestError}</p>}
      {suggestions && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {suggestions.map((s, i) => (
            <Card key={i} style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: T.steelDark, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>{s.cal} cal · P{s.protein} C{s.carb} F{s.fat}</div>
                  {s.note && <div style={{ fontSize: 12, color: T.steelDark, marginTop: 4 }}>{s.note}</div>}
                </div>
                <button onClick={() => addMeal({ name: s.name, cal: s.cal, protein: s.protein, carb: s.carb, fat: s.fat })}
                  style={{ background: T.charge, border: "none", borderRadius: 8, width: 32, height: 32, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <Plus size={16} color="#fff" />
                </button>
              </div>
            </Card>
          ))}
          <Btn variant="ghost" onClick={getSuggestions}><Sparkles size={14} /> More ideas</Btn>
        </div>
      )}
      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ============================================================
   PROGRESS
============================================================ */
function monthKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function MonthlySummary({ logs }) {
  const now = new Date();
  const monthWorkouts = logs.workouts.filter((w) => monthKey(new Date(w.date)) === monthKey(now));
  const totalSets = monthWorkouts.reduce((a, w) => a + w.exercises.reduce((b, e) => b + e.logged.filter((l) => l.done).length, 0), 0);
  const totalVolume = monthWorkouts.reduce(
    (a, w) => a + w.exercises.reduce((b, e) => b + e.logged.reduce((c, l) => c + (l.done && l.weight && l.reps ? Number(l.weight) * Number(l.reps) : 0), 0), 0),
    0
  );
  const dayCounts = {};
  monthWorkouts.forEach((w) => { dayCounts[w.dayName] = (dayCounts[w.dayName] || 0) + 1; });
  const monthName = now.toLocaleDateString(undefined, { month: "long" });

  return (
    <Card>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 700, color: T.ink, marginBottom: 10 }}>{monthName} so far</div>
      <div style={{ display: "flex", gap: 8 }}>
        <StatChip label="Workouts" val={monthWorkouts.length} color={T.charge} icon={<Dumbbell size={16} color={T.charge} />} />
        <StatChip label="Sets done" val={totalSets} color={T.good} icon={<Check size={16} color={T.good} />} />
        <StatChip label="Volume (lb)" val={totalVolume.toLocaleString()} color={T.protein} icon={<TrendingUp size={16} color={T.protein} />} />
      </div>
      {Object.keys(dayCounts).length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {Object.entries(dayCounts).map(([name, count]) => (
            <span key={name} style={{ background: T.paper, border: `1px solid ${T.steel}`, borderRadius: 8, padding: "4px 9px", fontSize: 11, color: T.ink, fontWeight: 600 }}>
              {name} × {count}
            </span>
          ))}
        </div>
      )}
      {monthWorkouts.length === 0 && <p style={{ color: T.steelDark, fontSize: 13, marginTop: 8 }}>No workouts logged this month yet.</p>}
    </Card>
  );
}

function exerciseHistory(logs, name) {
  return logs.workouts
    .filter((w) => w.exercises.some((e) => e.name === name))
    .map((w) => {
      const ex = w.exercises.find((e) => e.name === name);
      const withWeight = ex.logged.filter((l) => l.weight && l.reps);
      if (withWeight.length === 0) return null;
      const top = withWeight.reduce((max, l) => (Number(l.weight) > Number(max.weight) ? l : max), withWeight[0]);
      return { date: w.date, dateLabel: w.date.slice(5), weight: Number(top.weight), reps: Number(top.reps) };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date > b.date ? 1 : -1));
}

function ExerciseProgress({ logs }) {
  const names = Array.from(new Set(logs.workouts.flatMap((w) => w.exercises.map((e) => e.name)))).sort();
  const [selected, setSelected] = useState(names[0] || "");
  useEffect(() => { if (!selected && names[0]) setSelected(names[0]); }, [names.length]);

  if (names.length === 0) {
    return <Card><p style={{ color: T.steelDark, fontSize: 13, margin: 0 }}>Log a workout to start tracking exercise progress.</p></Card>;
  }

  const history = exerciseHistory(logs, selected);
  const first = history[0];
  const latest = history[history.length - 1];
  const delta = first && latest ? latest.weight - first.weight : 0;

  return (
    <Card>
      <select
        value={selected} onChange={(e) => setSelected(e.target.value)}
        style={{ width: "100%", padding: 12, borderRadius: 8, border: `1.5px solid ${T.steel}`, fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 14, color: T.ink, boxSizing: "border-box", marginBottom: 10 }}
      >
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      {history.length > 1 ? (
        <>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={history}>
              <CartesianGrid stroke={T.steel} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="dateLabel" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke={T.steelDark} />
              <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke={T.steelDark} domain={["dataMin - 5", "dataMax + 5"]} />
              <Tooltip contentStyle={{ fontFamily: "Inter", fontSize: 12, borderRadius: 8 }} formatter={(v, k, p) => [`${v} lb × ${p.payload.reps}`, "Top set"]} />
              <Line type="monotone" dataKey="weight" stroke={T.charge} strokeWidth={3} dot={{ r: 3, fill: T.charge }} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: T.steelDark }}>
            <span>First: {first.weight}lb × {first.reps}</span>
            <span style={{ color: delta > 0 ? T.good : delta < 0 ? T.warn : T.steelDark, fontWeight: 700 }}>
              {delta > 0 ? "+" : ""}{delta}lb since first log
            </span>
            <span>Latest: {latest.weight}lb × {latest.reps}</span>
          </div>
        </>
      ) : (
        <p style={{ color: T.steelDark, fontSize: 13, textAlign: "center", padding: "10px 0" }}>Log this exercise at least twice to see a trend.</p>
      )}
    </Card>
  );
}

function Progress({ state, addWeight }) {
  const { logs, profile } = state;
  const [entry, setEntry] = useState("");
  const chartData = logs.bodyweight.map((w) => ({ date: w.date.slice(5), weight: w.weight }));
  const totalWorkouts = logs.workouts.length;
  const streak = (() => {
    const dates = new Set(logs.workouts.map((w) => w.date));
    let s = 0, d = new Date();
    for (;;) {
      const iso = d.toISOString().slice(0, 10);
      if (dates.has(iso)) { s++; d.setDate(d.getDate() - 1); } else break;
    }
    return s;
  })();

  return (
    <div style={{ padding: "20px 16px 90px" }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, letterSpacing: 1, fontWeight: 600 }}>PROGRESS</span>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "2px 0 4px", color: T.ink }}>Your Trend</h1>

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <StatChip label="Workouts logged" val={totalWorkouts} color={T.charge} icon={<Award size={16} color={T.charge} />} />
        <StatChip label="Day streak" val={streak} color={T.good} icon={<Sparkles size={16} color={T.good} />} />
      </div>

      <TickRule label="This month" />
      <MonthlySummary logs={logs} />

      <TickRule label="Exercise progress" />
      <ExerciseProgress logs={logs} />

      <TickRule label="Bodyweight" />
      <Card>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid stroke={T.steel} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke={T.steelDark} />
              <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} stroke={T.steelDark} domain={["dataMin - 3", "dataMax + 3"]} />
              <Tooltip contentStyle={{ fontFamily: "Inter", fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey="weight" stroke={T.charge} strokeWidth={3} dot={{ r: 3, fill: T.charge }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p style={{ color: T.steelDark, fontSize: 13, textAlign: "center", padding: "20px 0" }}>Log at least 2 weigh-ins to see your trend.</p>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input
            placeholder={`Weight (lb) — last: ${profile.weightLb}`} type="number" value={entry}
            onChange={(e) => setEntry(e.target.value)}
            style={{ flex: 1, padding: 12, borderRadius: 8, border: `1.5px solid ${T.steel}`, boxSizing: "border-box", fontFamily: "'JetBrains Mono', monospace" }}
          />
          <Btn variant="accent" onClick={() => { if (entry) { addWeight(Number(entry)); setEntry(""); } }}>
            <Scale size={16} /> Log
          </Btn>
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
   PROFILE
============================================================ */
function ProfileTab({ state, resetAll, account, onLogout, subscribed, trialActive, trialDaysLeftCount, onOpenSubscribe }) {
  const { profile, targets } = state;
  const rows = [
    ["Goal", GOAL_SCHEME[profile.goal]?.label],
    ["Current build", (profile.currentPhysique || "").replace(/_/g, " ")],
    ["Target physique", profile.desiredPhysique],
    ["Specific goals", profile.specificGoals || "None stated"],
    ["Experience", profile.experience],
    ["Equipment", profile.equipment === "full" ? "Full Gym" : profile.equipment === "dumbbell" ? "Dumbbells" : "Bodyweight"],
    ["Training days/wk", profile.daysPerWeek],
    ["Session length", `~${profile.sessionLength} min`],
    ["Injuries noted", (profile.injuries || ["none"]).join(", ").replace(/_/g, " ")],
    ["Height", `${Math.floor(profile.heightIn / 12)}'${profile.heightIn % 12}"`],
    ["Weight on file", `${profile.weightLb} lb`],
    ["Maintenance (TDEE)", `${targets.tdee} cal`],
  ];
  return (
    <div style={{ padding: "20px 16px 90px" }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.steelDark, letterSpacing: 1, fontWeight: 600 }}>PROFILE</span>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "2px 0 4px", color: T.ink }}>Your Setup</h1>

      <TickRule label="Account" />
      <Card style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.ink }}>{account?.name}</div>
          <div style={{ fontSize: 12, color: T.steelDark }}>{account?.email}</div>
        </div>
        <Btn variant="ghost" onClick={onLogout}>Log out</Btn>
      </Card>

      <TickRule label="Subscription" />
      <Card>
        {subscribed ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.good, fontWeight: 700, fontSize: 14 }}>
            <Check size={16} /> Active subscription
          </div>
        ) : trialActive ? (
          <>
            <div style={{ fontSize: 14, color: T.ink, fontWeight: 700, marginBottom: 4 }}>Free trial — {trialDaysLeftCount} day{trialDaysLeftCount === 1 ? "" : "s"} left</div>
            <p style={{ fontSize: 13, color: T.steelDark, margin: "0 0 12px" }}>Subscribe now to keep access after your trial ends.</p>
            <Btn variant="accent" onClick={onOpenSubscribe} style={{ width: "100%" }}>Subscribe</Btn>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: T.steelDark, margin: "0 0 12px" }}>You're not currently subscribed.</p>
            <Btn variant="accent" onClick={onOpenSubscribe} style={{ width: "100%" }}>Subscribe</Btn>
          </>
        )}
      </Card>

      <TickRule label="Details" />
      <Card>
        {rows.map(([label, val], i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: i < rows.length - 1 ? `1px solid ${T.steel}` : "none", gap: 12 }}>
            <span style={{ color: T.steelDark, fontSize: 13, flexShrink: 0 }}>{label}</span>
            <span style={{ fontWeight: 600, fontSize: 13, color: T.ink, textTransform: "capitalize", textAlign: "right" }}>{val}</span>
          </div>
        ))}
      </Card>

      <TickRule label="Reset" />
      <Card>
        <p style={{ fontSize: 13, color: T.steelDark, marginTop: 0 }}>Retake the quiz to regenerate your program and macro targets from scratch. This clears all logged history for this account.</p>
        <Btn variant="ghost" onClick={resetAll} style={{ width: "100%" }}><RotateCcw size={16} /> Retake quiz & reset</Btn>
      </Card>
    </div>
  );
}

/* ============================================================
   ROOT APP
============================================================ */
export default function App() {
  const [account, setAccount] = useState(null);
  const [subscribed, setSubscribed] = useState(false);
  const [trialStartedAt, setTrialStartedAt] = useState(null);
  const [showSubscribeOverlay, setShowSubscribeOverlay] = useState(false);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("home");
  const [session, setSession] = useState(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    (async () => {
      const { data: { session: sbSession } } = await supabase.auth.getSession();
      if (sbSession?.user) {
        await hydrateAccount(sbSession.user);
      }
      setLoading(false);
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setAccount(null);
        setState(null);
        setSubscribed(false);
        setTrialStartedAt(null);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function hydrateAccount(user) {
    const profileRow = await loadProfile(user.id);
    setAccount({ id: user.id, name: profileRow?.name || user.user_metadata?.name || "", email: user.email });
    setSubscribed(!!profileRow?.subscribed);
    setTrialStartedAt(profileRow?.trial_started_at || null);
    const loaded = await loadState(user.id);
    setState(loaded);
  }

  async function checkSubscription() {
    if (!account) return;
    const profileRow = await loadProfile(account.id);
    setSubscribed(!!profileRow?.subscribed);
    setTrialStartedAt(profileRow?.trial_started_at || null);
  }

  // Cardless 30-day trial: just a timestamp on the user's own profile row,
  // no Stripe/payment info involved at all.
  async function startFreeTrial() {
    if (!account) return;
    const startedAt = new Date().toISOString();
    const { error } = await supabase.from("profiles").update({ trial_started_at: startedAt }).eq("id", account.id);
    if (!error) setTrialStartedAt(startedAt);
  }

  // The Stripe webhook updates the database asynchronously, so when we land
  // back on the app after checkout, poll briefly instead of assuming it's
  // already reflected.
  useEffect(() => {
    if (!account || subscribed) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      const profileRow = await loadProfile(account.id);
      if (profileRow?.subscribed) {
        setSubscribed(true);
        clearInterval(interval);
      } else if (attempts >= 6) {
        clearInterval(interval);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [account, subscribed]);

  async function persist(updater) {
    setState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveState(account.id, next);
      return next;
    });
  }

  // Lives at the App level (not inside the Coach tab component) so an in-flight
  // request keeps running — and its reply gets saved — even if the person
  // switches to Train, Fuel, etc. while waiting on it.
  async function sendCoachMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || coachLoading) return;
    const baseList = stateRef.current.coachChat && stateRef.current.coachChat.length ? stateRef.current.coachChat : DEFAULT_COACH_MESSAGES;
    const withUser = [...baseList, { role: "user", text: trimmed }];
    persist((prev) => ({ ...prev, coachChat: withUser }));
    setCoachLoading(true);
    try {
      const system = buildCoachSystem(stateRef.current);
      // The API requires the conversation to start with a "user" turn — drop the
      // assistant's opening greeting bubble (and anything before the first user message).
      const firstUserIdx = withUser.findIndex((m) => m.role === "user");
      const apiMessages = withUser.slice(firstUserIdx).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      const raw = await claudeChat({ system, messages: apiMessages });
      let parsed;
      try {
        parsed = parseJSONLoose(raw);
      } catch (parseErr) {
        parsed = { reply: raw.replace(/```json/g, "").replace(/```/g, "").trim() || "Got it.", program: null };
      }
      const withReply = [...withUser, { role: "assistant", text: parsed.reply }];
      const hasOverride = Array.isArray(parsed.todayOverride) && parsed.todayOverride.length > 0;
      persist((prev) => ({
        ...prev,
        coachChat: withReply,
        program: parsed.program && Array.isArray(parsed.program.days) && !hasOverride
          ? { splitName: parsed.program.splitName || prev.program.splitName, days: parsed.program.days }
          : prev.program,
        todayOverride: hasOverride ? parsed.todayOverride : prev.todayOverride,
      }));
    } catch (e) {
      console.error("Coach send failed:", e);
      persist((prev) => ({ ...prev, coachChat: [...withUser, { role: "assistant", text: "Sorry, I couldn't reach the coach just now. Please try sending that again in a moment." }] }));
    } finally {
      setCoachLoading(false);
    }
  }

  async function handleSignUp({ name, email, password }) {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { name } },
    });
    if (error) return { ok: false, error: error.message };
    if (!data.session) {
      // Email confirmation is required by the Supabase project settings —
      // there's no session yet until they click the link in their inbox.
      return { ok: false, error: "Account created! Check your email to confirm it, then sign in." };
    }
    await hydrateAccount(data.user);
    return { ok: true };
  }

  async function handleSignIn({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    await hydrateAccount(data.user);
    return { ok: true };
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setAccount(null);
    setState(null);
    setSubscribed(false);
    setActiveTab("home");
  }

  function handleOnboarded({ profile, program, targets }) {
    const fresh = {
      profile, program, targets,
      logs: { workouts: [], nutrition: [], bodyweight: [{ date: todayISO(), weight: profile.weightLb }] },
      coachChat: DEFAULT_COACH_MESSAGES,
      todayOverride: null,
    };
    persist(fresh);
  }

  function startWorkout(dayIdx) {
    setSession({ dayIdx });
  }

  function finishWorkout(sets) {
    const day = state.program.days[session.dayIdx];
    const entry = { date: todayISO(), dayName: day.name, exercises: sets };
    persist((prev) => ({ ...prev, logs: { ...prev.logs, workouts: [...prev.logs.workouts, entry] }, todayOverride: null }));
    setSession(null);
    setActiveTab("train");
  }

  function lastLogFor(dayName) {
    return state.logs.workouts.slice().reverse().find((w) => w.dayName === dayName) || null;
  }

  function addMeal(meal) {
    const today = todayISO();
    persist((prev) => {
      const nutrition = [...prev.logs.nutrition];
      const idx = nutrition.findIndex((d) => d.date === today);
      if (idx === -1) nutrition.push({ date: today, meals: [meal] });
      else nutrition[idx] = { ...nutrition[idx], meals: [...nutrition[idx].meals, meal] };
      return { ...prev, logs: { ...prev.logs, nutrition } };
    });
  }

  function removeMeal(mealIdx) {
    const today = todayISO();
    persist((prev) => {
      const nutrition = prev.logs.nutrition.map((d) => (d.date === today ? { ...d, meals: d.meals.filter((_, i) => i !== mealIdx) } : d));
      return { ...prev, logs: { ...prev.logs, nutrition } };
    });
  }

  function addWeight(weight) {
    persist((prev) => ({ ...prev, logs: { ...prev.logs, bodyweight: [...prev.logs.bodyweight, { date: todayISO(), weight }] } }));
  }

  function resetAll() {
    persist(null);
  }

  if (loading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: T.paper }}><style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style></div>;
  }

  if (!account) {
    return (
      <div className="auth-screen-outer">
        <style>{FONT_IMPORT}</style>
        <style>{SHELL_CSS}</style>
        <Login onSignUp={handleSignUp} onSignIn={handleSignIn} />
      </div>
    );
  }

  const trialActive = isTrialActive(trialStartedAt);

  if (!state) {
    return (
      <div className="auth-screen-outer">
        <style>{FONT_IMPORT}</style>
        <style>{SHELL_CSS}</style>
        <Onboarding onComplete={handleOnboarded} />
      </div>
    );
  }

  if (!subscribed && !trialActive) {
    return (
      <div className="auth-screen-outer">
        <style>{FONT_IMPORT}</style>
        <style>{SHELL_CSS}</style>
        <Paywall
          account={account}
          trialUsed={!!trialStartedAt}
          onStartTrial={startFreeTrial}
          onRefresh={checkSubscription}
          onLogout={handleLogout}
        />
      </div>
    );
  }

  const TABS = [
    { key: "home", label: "Home", icon: HomeIcon },
    { key: "train", label: "Train", icon: Dumbbell },
    { key: "coach", label: "Coach", icon: MessageCircle },
    { key: "fuel", label: "Fuel", icon: Utensils },
    { key: "progress", label: "Progress", icon: TrendingUp },
    { key: "profile", label: "You", icon: User },
  ];

  return (
    <div className="app-shell">
      <style>{FONT_IMPORT}</style>
      <style>{SHELL_CSS}</style>

      <div className="sidebar-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", marginBottom: 36 }}>
          <Zap size={20} color={T.charge} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: 2, color: T.charge, fontWeight: 700 }}>OVERLOAD</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 10, border: "none", cursor: "pointer", background: active ? "rgba(78,74,242,0.18)" : "transparent", color: active ? "#fff" : "#9CA3AF", fontWeight: active ? 700 : 500, fontSize: 14, textAlign: "left", position: "relative" }}
              >
                {t.key === "coach" && coachLoading && !active && (
                  <span style={{ position: "absolute", top: 8, left: 30, width: 7, height: 7, borderRadius: "50%", background: T.charge, animation: "pulseDot 1s ease-in-out infinite" }} />
                )}
                <Icon size={19} strokeWidth={active ? 2.5 : 2} color={active ? T.charge : "#9CA3AF"} />
                {t.label}
              </button>
            );
          })}
        </div>
        <button onClick={handleLogout} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 10, border: "none", cursor: "pointer", background: "transparent", color: "#6B7280", fontSize: 13, textAlign: "left" }}>
          <LogOut size={17} /> Log out
        </button>
      </div>

      <div className="app-main" style={{ fontFamily: "'Inter', sans-serif" }}>
        {!subscribed && trialActive && (
          <div style={{ background: T.charge, color: "#fff", fontSize: 12, fontWeight: 600, textAlign: "center", padding: "9px 16px" }}>
            {trialDaysLeft(trialStartedAt)} day{trialDaysLeft(trialStartedAt) === 1 ? "" : "s"} left in your free trial — <button onClick={() => setActiveTab("profile")} style={{ background: "none", border: "none", color: "#fff", textDecoration: "underline", cursor: "pointer", fontWeight: 700, fontSize: 12, padding: 0 }}>subscribe anytime</button>
          </div>
        )}
        <div className="app-main-inner">
          {activeTab === "home" && <Home state={state} setActiveTab={setActiveTab} startWorkout={startWorkout} />}
          {activeTab === "train" && <Train state={state} startWorkout={startWorkout} />}
          {activeTab === "coach" && <Coach messages={state.coachChat} loading={coachLoading} onSend={sendCoachMessage} />}
          {activeTab === "fuel" && <Fuel state={state} addMeal={addMeal} removeMeal={removeMeal} />}
          {activeTab === "progress" && <Progress state={state} addWeight={addWeight} />}
          {activeTab === "profile" && <ProfileTab state={state} resetAll={resetAll} account={account} onLogout={handleLogout} subscribed={subscribed} trialActive={trialActive} trialDaysLeftCount={trialDaysLeft(trialStartedAt)} onOpenSubscribe={() => setShowSubscribeOverlay(true)} />}
        </div>

        <div className="bottom-nav">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 0", color: active ? T.charge : T.steelDark, position: "relative" }}
              >
                {t.key === "coach" && coachLoading && !active && (
                  <span style={{ position: "absolute", top: 3, right: "calc(50% - 14px)", width: 7, height: 7, borderRadius: "50%", background: T.charge, animation: "pulseDot 1s ease-in-out infinite" }} />
                )}
                <Icon size={19} strokeWidth={active ? 2.5 : 2} />
                <span style={{ fontSize: 9, fontWeight: active ? 700 : 500 }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {session && (
        <WorkoutSession
          day={
            Array.isArray(state.todayOverride) && state.todayOverride.length > 0
              ? { ...state.program.days[session.dayIdx], exercises: state.todayOverride }
              : state.program.days[session.dayIdx]
          }
          isOverride={Array.isArray(state.todayOverride) && state.todayOverride.length > 0}
          lastLog={lastLogFor(state.program.days[session.dayIdx].name)}
          onFinish={finishWorkout}
          onCancel={() => setSession(null)}
        />
      )}

      {showSubscribeOverlay && (
        <SubscribeOverlay account={account} onClose={() => setShowSubscribeOverlay(false)} />
      )}
    </div>
  );
}
