// The daily workout reminder. Real ask: "it should be based off their time
// zone." Runs every hour and nudges the people for whom it's now
// REMINDER_HOUR where they are, if they have reminders on, haven't trained
// yet today, and haven't already hit their days-per-week this week.
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

// The reminder to send this person today, or null for none.
export function reminderFor(state, now = new Date()) {
  const push = state?.push;
  if (localHour(push?.tz, now) !== REMINDER_HOUR) return null;
  if (!push?.reminders || !Array.isArray(push.subscriptions) || push.subscriptions.length === 0) return null;
  const days = state?.program?.days || [];
  if (days.length === 0) return null;
  const workouts = state?.logs?.workouts || [];
  const today = localDateISO(push.tz, now);
  if (workouts.some((w) => w.date === today)) return null;
  // Already done this week's sessions (last 7 days, today included): no nag.
  const weekAgo = localDateISO(push.tz, new Date(now.getTime() - 6 * 86400000));
  const thisWeek = workouts.filter((w) => w.date >= weekAgo && w.date <= today).length;
  const perWeek = Number(state?.profile?.daysPerWeek) || days.length;
  if (thisWeek >= perWeek) return null;
  const next = days[workouts.length % days.length];
  return { kind: "reminder", title: "Time to train 💪", body: `Today's workout: ${next?.name || "your next session"}. Tap to start.`, tag: "reminder", url: "/" };
}

// Real ask: "add a weigh-in notification where you can set the time."
// Sent at the hour they picked (their time), unless they've already weighed
// in today.
export const DEFAULT_WEIGH_IN_HOUR = 8;
export function weighInFor(state, now = new Date()) {
  const push = state?.push;
  if (!push?.weighIn || !Array.isArray(push.subscriptions) || push.subscriptions.length === 0) return null;
  const hour = Number.isInteger(push.weighInHour) ? push.weighInHour : DEFAULT_WEIGH_IN_HOUR;
  if (localHour(push.tz, now) !== hour) return null;
  const today = localDateISO(push.tz, now);
  if ((state?.logs?.bodyweight || []).some((w) => w.date === today)) return null;
  return { kind: "weighin", title: "Weigh-in time ⚖️", body: "Step on the scale and log it — it keeps your plan on track.", tag: "weighin", url: "/" };
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

// Everything due for this person this hour.
export function notificationsFor(state, now = new Date()) {
  return [reminderFor(state, now), weighInFor(state, now), idleWorkoutFor(state, now)].filter(Boolean);
}

export default async function handler(req, res) {
  const auth = req.headers?.authorization || "";
  const secret = process.env.CRON_SECRET;
  const allowed = (secret && auth === `Bearer ${secret}`)
    || (auth.startsWith("Bearer ") && await verifyGithubToken(auth.slice(7)));
  if (!allowed) return res.status(401).json({ error: "Not allowed." });
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!privateKey || !supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ error: "Server is missing required environment variables." });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, privateKey);
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  let sent = 0, people = 0;
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin.from("app_state").select("user_id, state")
      .or("state->push->>reminders.eq.true,state->push->>weighIn.eq.true,state->push->>idleWorkout.eq.true")
      .range(from, from + 499);
    if (error) return res.status(500).json({ error: error.message });
    for (const row of data || []) {
      const notes = notificationsFor(row.state);
      if (notes.length === 0) continue;
      people++;
      for (const note of notes) {
        const results = await Promise.allSettled(row.state.push.subscriptions.map((sub) => webpush.sendNotification(sub, JSON.stringify(note), { TTL: 3600 })));
        sent += results.filter((r) => r.status === "fulfilled").length;
      }
    }
    if (!data || data.length < 500) break;
  }
  return res.status(200).json({ people, sent });
}
