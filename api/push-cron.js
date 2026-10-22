// Scheduled reminders (workout, food logging, weigh-in) and the
// forgot-to-finish nudge. Real ask: "it should be based off their time
// zone." Runs every hour and sends each reminder whose hour has come where
// the person is, on the days they picked.
//
// Vercel's free plan only runs its own crons once a day, so the hourly tick
// comes from GitHub Actions (.github/workflows/push-cron.yml). GitHub signs
// each run with a short-lived token for this repository, checked below, so no
// shared password has to be stored anywhere. Anyone else is refused.
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import crypto from "node:crypto";

export const VAPID_PUBLIC_KEY = "BK0dG_2Uk7ItbaIRe6JKXtQzhxkpSaY4QiJj8swUgTaj4AKyvQyYTso15xNBZ0KMYv0dZqXnzvHQFOK_82mp-5Y";
export const VAPID_SUBJECT = "https://www.overload-app.com";
export const config = { maxDuration: 60 };
// 6pm, their time.
export const REMINDER_HOUR = 18;
export const GITHUB_REPO = "Overload-app/Overload-app";
export const OIDC_AUDIENCE = "overload-push-cron";
const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";

// The hour (0-23) it is right now where the person is.
export function localHour(timeZone, now = new Date()) {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { timeZone: timeZone || "UTC", hour: "2-digit", hourCycle: "h23" }).format(now);
    return Number(h) % 24;
  } catch (e) {
    return now.getUTCHours();
  }
}

const b64url = (s) => Buffer.from(s, "base64url");

// A GitHub Actions run token: signed by GitHub, for this repository, meant
// for this endpoint, and not expired.
export async function verifyGithubToken(token, fetchKeys = defaultFetchKeys, nowSec = Math.floor(Date.now() / 1000)) {
  try {
    const [h, p, sig] = String(token || "").split(".");
    if (!h || !p || !sig) return false;
    const header = JSON.parse(b64url(h).toString());
    const claims = JSON.parse(b64url(p).toString());
    if (header.alg !== "RS256") return false;
    const keys = await fetchKeys();
    const jwk = (keys || []).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: "jwk" }), b64url(sig));
    if (!ok) return false;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return claims.iss === GITHUB_ISSUER && aud.includes(OIDC_AUDIENCE)
      && claims.repository === GITHUB_REPO
      && Number(claims.exp) > nowSec && Number(claims.nbf || 0) <= nowSec + 60;
  } catch (e) {
    return false;
  }
}

async function defaultFetchKeys() {
  const res = await fetch(`${GITHUB_ISSUER}/.well-known/jwks`);
  if (!res.ok) return [];
  return (await res.json()).keys || [];
}

// Today's date where the person actually is (the app saves their time zone
// when they turn reminders on), as YYYY-MM-DD.
export function localDateISO(timeZone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch (e) {
    return now.toISOString().slice(0, 10);
  }
}

// Day of the week where they are: 0 = Sunday ... 6 = Saturday.
export function localWeekday(timeZone, now = new Date()) {
  try {
    const d = new Intl.DateTimeFormat("en-US", { timeZone: timeZone || "UTC", weekday: "short" }).format(now);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(d);
  } catch (e) {
    return now.getUTCDay();
  }
}

// Real report: "I've only had 1 go off." GitHub's hourly schedule skips most
// runs (about 40 ran in 6 days instead of ~140), and a reminder only went out
// if a run landed in its exact hour. With catch-up on (the server can see
// what was already sent today — the push_sent table), a reminder goes out on
// the first run any time in its window and is recorded so it's never sent
// twice. Without that table, only the exact hour counts, as before.
export const REMINDER_WINDOW_HOURS = 5; // 6pm-10:59pm
export const WEIGH_IN_WINDOW_HOURS = 4;
function inWindow(hourNow, start, width, catchUp) {
  return catchUp ? hourNow >= start && hourNow < start + width : hourNow === start;
}

// Same rule as the app's nextDayIndexFor: the day after the one trained last.
export function nextDayIndex(days, workouts) {
  if (!days.length) return 0;
  if (!workouts.length) return 0;
  const last = [...workouts].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0))[workouts.length - 1];
  const name = String(last?.dayName || "").trim().toLowerCase();
  let idx = days.findIndex((d) => String(d.name || "").trim().toLowerCase() === name);
  if (idx === -1 && name) idx = days.findIndex((d) => { const n = String(d.name || "").trim().toLowerCase(); return n && (name.startsWith(n) || n.startsWith(name)); });
  return idx === -1 ? workouts.length % days.length : (idx + 1) % days.length;
}

// Real ask: "schedule food log reminders at certain times, and how often it
// repeats, and you should be able to make multiple. same with workout days."
// Each reminder is { id, type: "workout"|"food"|"weighin", hour, days } in
// state.push.schedules. Same as reminderSchedules() in src/App.jsx: accounts
// from before that list existed keep their one 6pm workout reminder and
// their weigh-in time, under the ids those were already sent as.
export const DEFAULT_WEIGH_IN_HOUR = 8;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export function reminderSchedules(push) {
  if (Array.isArray(push?.schedules)) return push.schedules;
  const out = [];
  if (push?.reminders) out.push({ id: "reminder", type: "workout", hour: REMINDER_HOUR, days: Array.isArray(push.reminderDays) && push.reminderDays.length > 0 ? push.reminderDays : EVERY_DAY });
  if (push?.weighIn) out.push({ id: "weighin", type: "weighin", hour: Number.isInteger(push.weighInHour) ? push.weighInHour : DEFAULT_WEIGH_IN_HOUR, days: EVERY_DAY });
  return out;
}

// How late a skipped hourly run can still send each kind. Food reminders get
// less room, since people often set several a day.
export const FOOD_WINDOW_HOURS = 2;
const WINDOW = { workout: REMINDER_WINDOW_HOURS, weighin: WEIGH_IN_WINDOW_HOURS, food: FOOD_WINDOW_HOURS };

// The message for one reminder, or null when there's no point sending it.
function reminderMessage(type, state, now) {
  const push = state.push;
  const today = localDateISO(push.tz, now);
  if (type === "workout") {
    const days = state?.program?.days || [];
    if (days.length === 0) return null;
    const workouts = state?.logs?.workouts || [];
    if (workouts.some((w) => w.date === today)) return null;
    // Already done this week's sessions (last 7 days, today included): no nag.
    const weekAgo = localDateISO(push.tz, new Date(now.getTime() - 6 * 86400000));
    const thisWeek = workouts.filter((w) => w.date >= weekAgo && w.date <= today).length;
    const perWeek = Number(state?.profile?.daysPerWeek) || days.length;
    if (thisWeek >= perWeek) return null;
    const next = days[nextDayIndex(days, workouts)];
    return { kind: "reminder", title: "Time to train 💪", body: `Today's workout: ${next?.name || "your next session"}. Tap to start.`, tag: "reminder", url: "/" };
  }
  if (type === "weighin") {
    if ((state?.logs?.bodyweight || []).some((w) => w.date === today)) return null;
    return { kind: "weighin", title: "Weigh-in time ⚖️", body: "Step on the scale and log it — it keeps your plan on track.", tag: "weighin", url: "/" };
  }
  if (type === "food") {
    const meals = (state?.logs?.nutrition || []).find((d) => d.date === today)?.meals || [];
    const cal = Math.round(meals.reduce((a, m) => a + (Number(m?.cal) || 0), 0));
    const target = Number(state?.targets?.calories) || 0;
    const body = meals.length === 0
      ? "Nothing logged yet today — add what you've eaten so far."
      : target > 0 ? `You're at ${cal} of ${target} calories today — log anything you've eaten since.` : "Log anything you've eaten since your last meal.";
    return { kind: "food", title: "Log your food 🍽️", body, tag: "food", url: "/" };
  }
  return null;
}

// The reminders to send now: { note, keys } — keys are the push_sent names
// to record, so each reminder goes out at most once a day. If a late run
// finds two of the same type due (say food at 12pm and 1pm), only one
// notification goes out and both are marked sent.
export function scheduledFor(state, now = new Date(), sentToday = null) {
  const push = state?.push;
  if (!Array.isArray(push?.subscriptions) || push.subscriptions.length === 0) return [];
  const catchUp = sentToday instanceof Set;
  const hourNow = localHour(push.tz, now);
  const weekday = localWeekday(push.tz, now);
  const byType = new Map();
  for (const r of reminderSchedules(push)) {
    if (!r || !Number.isInteger(r.hour) || !WINDOW[r.type]) continue;
    const key = String(r.id || `${r.type}-${r.hour}`);
    if (catchUp && sentToday.has(key)) continue;
    if (Array.isArray(r.days) && r.days.length > 0 && !r.days.includes(weekday)) continue;
    if (!inWindow(hourNow, r.hour, WINDOW[r.type], catchUp)) continue;
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type).push(key);
  }
  const out = [];
  for (const [type, keys] of byType) {
    const note = reminderMessage(type, state, now);
    if (note) out.push({ note, keys });
  }
  return out;
}

// Kept for the tests and anything else that asked for one kind by name.
export function reminderFor(state, now = new Date(), catchUp = false) {
  const workout = reminderSchedules(state?.push).filter((r) => r.type === "workout");
  return scheduledFor({ ...state, push: { ...state?.push, schedules: workout } }, now, catchUp ? new Set() : null)[0]?.note || null;
}
export function weighInFor(state, now = new Date(), catchUp = false) {
  const weighin = reminderSchedules(state?.push).filter((r) => r.type === "weighin");
  return scheduledFor({ ...state, push: { ...state?.push, schedules: weighin } }, now, catchUp ? new Set() : null)[0]?.note || null;
}

// Real ask: "a notification if numbers haven't been logged in a while,
// asking if you're done with your workout." A workout left open with nothing
// logged for 40-100 minutes gets one nudge. The job runs hourly, so exactly
// one run lands in that 60-minute window — no double nudges, and nothing
// needs to be written back to their account to remember it.
export const IDLE_FROM_MIN = 40;
export const IDLE_TO_MIN = 100;
export function idleWorkoutFor(state, now = new Date()) {
  const push = state?.push;
  const open = state?.inProgressWorkout;
  if (!push?.idleWorkout || !open || !Array.isArray(push.subscriptions) || push.subscriptions.length === 0) return null;
  const last = new Date(open.savedAt || "").getTime();
  if (!Number.isFinite(last)) return null;
  const idleMin = (now.getTime() - last) / 60000;
  if (idleMin < IDLE_FROM_MIN || idleMin >= IDLE_TO_MIN) return null;
  const day = state?.program?.days?.[open.dayIdx]?.name || "your workout";
  return { kind: "idle", title: "Still working out?", body: `Nothing's been logged on ${day} for a while — tap to finish it or keep going.`, tag: "idle", url: "/" };
}

// Everything due for this person now, as { note, keys }. sentToday: the
// push_sent names already sent today (a Set) when that table is there —
// which switches on catch-up; null when it isn't. The idle nudge is recorded
// per paused workout, since checks every few minutes would otherwise send
// it again on each one inside its 40-100 minute window.
export function dueFor(state, now = new Date(), sentToday = null) {
  const idle = idleWorkoutFor(state, now);
  const idleKey = idle ? `idle:${state.inProgressWorkout.savedAt}` : null;
  const idleDue = idle && !(sentToday instanceof Set && sentToday.has(idleKey));
  return [...scheduledFor(state, now, sentToday), ...(idleDue ? [{ note: idle, keys: [idleKey] }] : [])];
}
export function notificationsFor(state, now = new Date(), sentToday = null) {
  return dueFor(state, now, sentToday).map((d) => d.note);
}

// Real report: "log food reminder didn't work today at 5." GitHub's
// "hourly" schedule was only running about every 5 hours (the 5pm check
// came at 4:59:48pm). The reliable tick is the database's own scheduler
// (pg_cron, supabase-migration-reminder-ticks.sql), every 5 minutes. Each
// tick first writes a random one-time ticket into cron_ticks — a table only
// the server can read — and sends it here; using it up proves the call came
// from the database, with no shared password stored anywhere.
export const TICK_MAX_AGE_MS = 10 * 60 * 1000;
export async function useTick(supabaseAdmin, ticket) {
  if (!ticket || typeof ticket !== "string" || ticket.length > 100) return false;
  const since = new Date(Date.now() - TICK_MAX_AGE_MS).toISOString();
  const { data, error } = await supabaseAdmin.from("cron_ticks").delete().eq("nonce", ticket).gte("created_at", since).select("nonce");
  return !error && Array.isArray(data) && data.length === 1;
}

export default async function handler(req, res) {
  const auth = req.headers?.authorization || "";
  const ticket = req.headers?.["x-cron-tick"];
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.CRON_SECRET;
  const viaSecretOrGithub = (secret && auth === `Bearer ${secret}`)
    || (auth.startsWith("Bearer ") && await verifyGithubToken(auth.slice(7)));
  if (!viaSecretOrGithub && !ticket) return res.status(401).json({ error: "Not allowed." });
  if (!privateKey || !supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Server is missing required environment variables." });
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const viaTick = !viaSecretOrGithub && await useTick(supabaseAdmin, ticket);
  if (!viaSecretOrGithub && !viaTick) return res.status(401).json({ error: "Not allowed." });
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, privateKey);
  let sent = 0, people = 0;
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin.from("app_state").select("user_id, state")
      .or("state->push->>reminders.eq.true,state->push->>weighIn.eq.true,state->push->>idleWorkout.eq.true,state->push->>schedules.not.is.null")
      .range(from, from + 499);
    if (error) return res.status(500).json({ error: error.message });
    for (const row of data || []) {
      const day = localDateISO(row.state?.push?.tz);
      // What's already gone out today (null if the push_sent table isn't set up).
      let sentToday = null;
      const { data: sentRows, error: sentError } = await supabaseAdmin.from("push_sent").select("kind").eq("user_id", row.user_id).eq("day", day);
      if (!sentError) sentToday = new Set((sentRows || []).map((r) => r.kind));
      // Ticks come every few minutes, so without the sent list every check
      // in a reminder's hour would send it again. Skip until it's there.
      else if (viaTick) continue;
      const due = dueFor(row.state, new Date(), sentToday);
      if (due.length === 0) continue;
      people++;
      for (const { note, keys } of due) {
        const results = await Promise.allSettled(row.state.push.subscriptions.map((sub) => webpush.sendNotification(sub, JSON.stringify(note), { TTL: 3600 })));
        const ok = results.filter((r) => r.status === "fulfilled").length;
        sent += ok;
        if (ok > 0 && sentToday && keys.length > 0) {
          await supabaseAdmin.from("push_sent").upsert(keys.map((kind) => ({ user_id: row.user_id, kind, day })), { onConflict: "user_id,kind,day", ignoreDuplicates: true });
        }
      }
    }
    if (!data || data.length < 500) break;
  }
  return res.status(200).json({ people, sent });
}
