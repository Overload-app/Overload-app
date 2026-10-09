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
    const { data, error } = await supabaseAdmin.from("app_state").select("user_id, state").eq("state->push->>reminders", "true").range(from, from + 499);
    if (error) return res.status(500).json({ error: error.message });
    for (const row of data || []) {
      const note = reminderFor(row.state);
      if (!note) continue;
      people++;
      const results = await Promise.allSettled(row.state.push.subscriptions.map((sub) => webpush.sendNotification(sub, JSON.stringify(note), { TTL: 3600 })));
      sent += results.filter((r) => r.status === "fulfilled").length;
    }
    if (!data || data.length < 500) break;
  }
  return res.status(200).json({ people, sent });
}
